/**
 * AI 草稿助手（定稿 §7）
 *
 * 定位：AI 只产出「草稿」，人确认后才写入协议。永远不静默改配置。
 * 两条路径：
 *  1) 本地确定性抽取（无需 Key、无需联网）：C 结构体 / 字段表格 / 样例帧 → PDL 草稿
 *  2) 远程模型（OpenAI 兼容）：把文档丢给模型，要求返回同构 JSON，再走同一套校验器
 * 无论走哪条，产物都要过 Validator：字段连续性、长度自洽、样例帧 round-trip、校验算法穷举。
 */
import { roundTrip, detectChecksum, encodeMessage, detectMessage } from "./codec";
import { BINARY_PROTOCOL, CRANE_PROTOCOL, messageLength, type PdlField, type PdlMessage, type PdlProtocol } from "./pdl";
import { parseHex, toHex } from "./bytes";
import type { ChecksumAlgorithm } from "./crc";

export interface DraftIssue {
  level: "info" | "warn" | "error";
  text: string;
}

export interface DraftResult {
  protocol: PdlProtocol;
  sample: number[];
  roundTripOk: boolean;
  diffIndexes: number[];
  checksumCandidates: { alg: string; ok: boolean }[];
  issues: DraftIssue[];
  source: "local" | "remote";
  usedChecksum: ChecksumAlgorithm;
}

/* ---------------- 输入预处理 ---------------- */

const C_TYPE_MAP: Record<string, { type: PdlField["type"]; size: number; byteOrder?: PdlField["byteOrder"] }> = {
  uint8_t: { type: "uint", size: 1 },
  u8: { type: "uint", size: 1 },
  uint16_t: { type: "uint", size: 2, byteOrder: "ABCD" },
  u16: { type: "uint", size: 2, byteOrder: "ABCD" },
  uint32_t: { type: "uint", size: 4, byteOrder: "ABCD" },
  u32: { type: "uint", size: 4, byteOrder: "ABCD" },
  int8_t: { type: "int", size: 1 },
  int16_t: { type: "int", size: 2, byteOrder: "ABCD" },
  int32_t: { type: "int", size: 4, byteOrder: "ABCD" },
  float: { type: "float", size: 4, byteOrder: "ABCD" },
  double: { type: "float", size: 8 },
};

function extractSample(text: string): number[] {
  // 找最长的一串十六进制字节
  const matches = text.match(/(?:0x)?[0-9A-Fa-f]{2}(?:[\s,]+(?:0x)?[0-9A-Fa-f]{2}){3,}/g) ?? [];
  let best: number[] = [];
  for (const m of matches) {
    const bytes = parseHex(m);
    if (bytes.length > best.length) best = bytes;
  }
  return best;
}

function extractCStruct(text: string): PdlField[] | null {
  const structMatch = text.match(/(?:typedef\s+)?struct\s*\{([\s\S]{20,2000}?)\}\s*(\w+)?\s*;/);
  if (!structMatch) return null;
  const body = structMatch[1];
  const re = /(uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|float|double|u8|u16|u32)\s+(\w+)\s*(?:\[(\d+)\])?\s*;/g;
  const fields: PdlField[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const [, ctype, name, arr] = m;
    const base = C_TYPE_MAP[ctype];
    if (!base) continue;
    const count = arr ? Number(arr) : 1;
    fields.push({
      id: name,
      name,
      type: count > 1 ? "bytes" : base.type,
      size: base.size * count,
      offset: 0,
      byteOrder: base.byteOrder,
      value: 0,
      desc: `来自 C 结构体 ${ctype}${count > 1 ? `[${count}]` : ""}`,
    });
  }
  return fields.length >= 2 ? fields : null;
}

function extractTable(text: string): PdlField[] | null {
  const fields: PdlField[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // 形如： 0  addr  uint8  1  从站地址   或   0 | addr | 1 | 从站地址
    const cells = line.split(/[|,\t]+|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const off = Number(cells[0]);
    if (!Number.isFinite(off) || off < 0 || off > 512) continue;
    const name = cells[1];
    if (!/^[A-Za-z_][\w]*$/.test(name)) continue;
    // 类型/长度：找 uint8/uint16/1/2/4
    let size = 0;
    let type: PdlField["type"] = "uint";
    for (const c of cells.slice(2)) {
      const t = c.toLowerCase();
      if (/^uint8|^u8$/.test(t)) {
        size = 1;
        type = "uint";
      } else if (/^uint16|^u16$/.test(t)) {
        size = 2;
        type = "uint";
      } else if (/^uint32|^u32$/.test(t)) {
        size = 4;
        type = "uint";
      } else if (/^int16/.test(t)) {
        size = 2;
        type = "int";
      } else if (/^enum/.test(t)) {
        size = size || 1;
        type = "enum";
      } else if (/^crc|校验/.test(t)) {
        size = 2;
        type = "crc";
      } else if (/^(1|2|4|8)$/.test(t) && !size) {
        size = Number(t);
      }
      if (size) break;
    }
    if (!size) continue;
    const desc = cells[cells.length - 1];
    fields.push({
      id: name,
      name,
      type,
      size,
      offset: off,
      byteOrder: size > 1 ? "ABCD" : undefined,
      value: 0,
      desc: desc && desc !== name && !/^\d+$/.test(desc) ? desc : undefined,
    });
  }
  return fields.length >= 3 ? fields : null;
}

function normalizeOffsets(fields: PdlField[]): PdlField[] {
  const sorted = fields.slice().sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  return sorted.map((f) => {
    const offset = f.offset >= cursor ? f.offset : cursor;
    cursor = offset + f.size;
    return { ...f, offset };
  });
}

/* ---------------- 校验器（定稿 §7.5） ---------------- */

export function validateDraft(protocol: PdlProtocol, sample: number[]): DraftResult {
  const issues: DraftIssue[] = [];
  const msg: PdlMessage = protocol.messages[0];

  // 1. 字段连续性
  const sorted = msg.fields.filter((f) => f.offset >= 0).slice().sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.offset > cursor) issues.push({ level: "warn", text: `offset ${cursor}~${f.offset - 1} 存在空洞，已按 reserved 处理` });
    if (f.offset < cursor) issues.push({ level: "error", text: `字段 ${f.name} 与前一字段重叠` });
    cursor = Math.max(cursor, f.offset + f.size);
  }

  // 2. 长度自洽
  const len = messageLength(msg);
  if (sample.length && len !== sample.length) {
    issues.push({ level: "warn", text: `声明帧长 ${len}B 与样例帧 ${sample.length}B 不一致` });
  }

  // 3. 校验算法穷举（这是算得出来的，不问模型）
  let usedChecksum: ChecksumAlgorithm = protocol.checksum.algorithm;
  let checksumCandidates: { alg: string; ok: boolean }[] = [];
  if (sample.length) {
    checksumCandidates = detectChecksum(protocol, sample);
    const hit = checksumCandidates.filter((c) => c.ok);
    if (hit.length === 1) {
      usedChecksum = hit[0].alg as ChecksumAlgorithm;
      issues.push({ level: "info", text: `样例帧唯一命中校验算法：${usedChecksum}（已自动采用）` });
    } else if (hit.length > 1) {
      issues.push({ level: "warn", text: `样例帧命中多个校验算法（${hit.map((h) => h.alg).join(" / ")}），需人工确认` });
    } else if (checksumCandidates.length) {
      issues.push({ level: "error", text: "样例帧未命中任何内置校验算法，可能是自定义算法或校验范围不同" });
    }
  }

  // 4. round-trip
  let roundTripOk = false;
  let diffIndexes: number[] = [];
  if (sample.length) {
    try {
      const rt = roundTrip({ ...protocol, checksum: { ...protocol.checksum, algorithm: usedChecksum } }, sample, msg.id);
      roundTripOk = rt.ok;
      diffIndexes = rt.diffIndexes;
      if (!rt.ok) issues.push({ level: "error", text: `round-trip 失败：${diffIndexes.length} 个字节差异` });
      else issues.push({ level: "info", text: "round-trip 逐字节一致" });
    } catch (e) {
      issues.push({ level: "error", text: `round-trip 异常：${(e as Error).message}` });
    }
  } else {
    issues.push({ level: "warn", text: "未提供样例帧，无法做 round-trip 与校验算法判定" });
  }

  return {
    protocol: { ...protocol, checksum: { ...protocol.checksum, algorithm: usedChecksum } },
    sample,
    roundTripOk,
    diffIndexes,
    checksumCandidates,
    issues,
    source: "local",
    usedChecksum,
  };
}

/* ---------------- 本地确定性抽取 ---------------- */

export function localDraft(text: string): DraftResult {
  const sample = extractSample(text);
  let fields = extractCStruct(text) ?? extractTable(text);

  if (!fields || fields.length < 2) {
    // 完全无法抽取时，给出可编辑的骨架，而不是瞎编字段
    fields = [
      { id: "header", name: "header", type: "uint", size: 2, offset: 0, value: 0xaa55, expect: 0xaa55, desc: "帧头（待确认）" },
      { id: "len", name: "len", type: "uint", size: 1, offset: 2, value: sample.length || 8, desc: "帧长度（待确认）" },
      { id: "cmd", name: "cmd", type: "uint", size: 1, offset: 3, value: 1, desc: "命令字（待确认）" },
      { id: "data", name: "data", type: "bytes", size: 0, offset: 4, sizeExpr: "len - 5", desc: "数据域（变长，待确认）" },
      { id: "sum", name: "sum", type: "crc", size: 1, offset: 0, offsetExpr: "len - 1", desc: "校验（待确认）" },
    ];
  } else {
    fields = normalizeOffsets(fields);
    // 若样例帧存在且末尾 2 字节像校验，补一个 crc 字段
    const hasCrc = fields.some((f) => f.type === "crc");
    const len = fields.reduce((a, f) => Math.max(a, f.offset + f.size), 0);
    if (!hasCrc && sample.length && len === sample.length) {
      // 最后一字段当校验
      const last = fields[fields.length - 1];
      if (last.size === 2 || last.size === 1) {
        fields[fields.length - 1] = { ...last, type: "crc", name: "crc16", byteOrder: "BADC", desc: "校验（由样例帧推断）" };
      }
    }
  }

  const msg: PdlMessage = { id: "status", name: "状态上报", fields };
  const protocol: PdlProtocol = {
    ...BINARY_PROTOCOL,
    id: `draft-${Date.now()}`,
    name: "AI 草稿协议",
    version: "v1",
    checksum: { algorithm: "CRC16/MODBUS", from: 0, to: "len-2", endian: "little" },
    messages: [msg],
    sampleFrame: sample.length ? toHex(sample) : "",
    updatedAt: "刚刚",
  };

  const result = validateDraft(protocol, sample);
  const issues = [...result.issues];
  if (!extractCStruct(text) && !extractTable(text)) {
    issues.unshift({ level: "warn", text: "未能从文本中识别出字段表或 C 结构体，已给出骨架，请手动补全" });
  }
  return { ...result, issues };
}

/* ---------------- 远程模型（OpenAI 兼容） ---------------- */

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const CFG_KEY = "serialmind.ai";

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return JSON.parse(raw) as AiConfig;
  } catch {
    /* ignore */
  }
  return { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" };
}

export function saveAiConfig(c: AiConfig): void {
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
}

/** 测试连接：发一条最小请求，验证 baseUrl / API Key / 模型名是否可用 */
export async function testAiConfig(cfg: AiConfig): Promise<{ ok: boolean; message: string; ms: number }> {
  const t0 = performance.now();
  if (!cfg.apiKey.trim()) return { ok: false, message: "还没填 API Key", ms: 0 };
  if (!cfg.baseUrl.trim()) return { ok: false, message: "还没填 Base URL", ms: 0 };
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}：${(await res.text()).slice(0, 160)}`, ms };
    const data = (await res.json()) as { model?: string };
    return { ok: true, message: `连通 · ${data.model ?? cfg.model} · ${ms}ms`, ms };
  } catch (e) {
    return { ok: false, message: `网络错误：${String((e as Error).message ?? e)}`, ms: Math.round(performance.now() - t0) };
  }
}

const SYSTEM_PROMPT = `你是串口协议抽取器。只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。
JSON 结构：
{"fields":[{"name":"字段名","type":"uint|int|float|bool|enum|bytes|crc|reserved","size":字节数,"offset":偏移,"byteOrder":"ABCD|BADC|CDAB|DCBA","desc":"说明","confidence":0~1,"sourceSpan":"原文出处"}],"checksum":{"algorithm":"CRC16/MODBUS|CRC16/CCITT|SUM8|XOR8|LRC|null","confidence":0~1},"unresolved":["未确定项"]}
规则：
1. 文档没写清的校验算法，algorithm 必须为 null，不要猜。
2. 每个字段必须给 sourceSpan 与 confidence。
3. 字段偏移不得重叠，必须覆盖整帧。`;

export async function remoteDraft(text: string, cfg: AiConfig): Promise<DraftResult> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 12000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`模型调用失败 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonText = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(jsonText) as {
    fields?: { name: string; type: string; size: number; offset?: number; byteOrder?: string; desc?: string; confidence?: number }[];
    checksum?: { algorithm?: string | null };
    unresolved?: string[];
  };

  const sample = extractSample(text);
  const rawFields: PdlField[] = (parsed.fields ?? []).map((f, i) => ({
    id: f.name,
    name: f.name,
    type: (["uint", "int", "float", "bool", "enum", "bytes", "crc", "reserved"].includes(f.type) ? f.type : "uint") as PdlField["type"],
    size: Number(f.size) || 1,
    offset: typeof f.offset === "number" ? f.offset : i,
    byteOrder: (f.byteOrder as PdlField["byteOrder"]) ?? undefined,
    value: 0,
    desc: f.desc,
  }));

  const fields = normalizeOffsets(rawFields.length ? rawFields : [{ id: "payload", name: "payload", type: "bytes", size: Math.max(1, sample.length), offset: 0 }]);
  const protocol: PdlProtocol = {
    ...BINARY_PROTOCOL,
    id: `draft-${Date.now()}`,
    name: "AI 草稿协议（远程）",
    version: "v1",
    checksum: { algorithm: (parsed.checksum?.algorithm as ChecksumAlgorithm) ?? "CRC16/MODBUS", from: 0, to: "len-2", endian: "little" },
    messages: [{ id: "status", name: "状态上报", fields }],
    sampleFrame: sample.length ? toHex(sample) : "",
    updatedAt: "刚刚",
  };

  const result = validateDraft(protocol, sample);
  const issues = [...result.issues];
  if (parsed.checksum?.algorithm === null || parsed.checksum?.algorithm === undefined) {
    issues.unshift({ level: "warn", text: "模型未给出校验算法（符合约定：不猜），已用样例帧穷举判定" });
  }
  for (const u of parsed.unresolved ?? []) issues.push({ level: "warn", text: `待确认：${u}` });
  return { ...result, issues, source: "remote" };
}

/** 把草稿应用到指定产品（返回可写库的协议对象） */
export function draftToProtocol(d: DraftResult, productId: string, name: string): PdlProtocol {
  return {
    ...d.protocol,
    id: `proto-${Date.now()}`,
    name,
    version: "v1",
    productId,
    messages: d.protocol.messages.map((m) => ({
      ...m,
      fields: m.fields.map((f) => ({ ...f })),
    })),
  };
}

/** 供 UI 预览：用草稿协议组包一次 */
export function previewBytes(d: DraftResult): string {
  try {
    const msg = d.protocol.messages[0];
    const bytes = encodeMessage(d.protocol, msg, {});
    return toHex(bytes);
  } catch {
    return "—";
  }
}

export { detectMessage };

/* ================= 自动化测试用例与产品 AI 生成（支持 DeepSeek） ================= */

export interface GeneratedCaseAction {
  protocolId: string;
  protocolName: string;
  intervalMs: number;
  fields: { fieldName: string; step: number; customInit?: number }[];
}

export interface GeneratedCaseDraft {
  name: string;
  intervalMs: number;
  repeat: number;
  actions: GeneratedCaseAction[];
  assertions: { expectHex?: string; fieldName?: string; op: string; val: string | number }[];
  explanation: string;
}

export interface GeneratedProductDraft {
  productName: string;
  subProductName: string;
  protocols: {
    name: string;
    fields: PdlField[];
    checksumAlg: ChecksumAlgorithm;
    sampleFrame?: string;
  }[];
  caseName: string;
  caseActions: {
    protocolIndex: number;
    intervalMs: number;
    fields: { fieldName: string; step: number; customInit?: number }[];
  }[];
  explanation: string;
}

/** 本地规则推演生成测试用例（离线无需 Key） */
export function localGenerateCaseDraft(userPrompt: string, protocols: PdlProtocol[]): GeneratedCaseDraft {
  const actions: GeneratedCaseAction[] = [];
  const text = userPrompt.toLowerCase();

  // 1. 尝试匹配心跳
  const hasHeartbeat = text.includes("心跳") || text.includes("heartbeat") || text.includes("ping");
  const hbProto = protocols.find((p) => p.name.includes("心跳") || p.name.toLowerCase().includes("heartbeat")) ?? protocols[0];

  if (hasHeartbeat && hbProto) {
    actions.push({
      protocolId: hbProto.id,
      protocolName: hbProto.name,
      intervalMs: 1000,
      fields: [],
    });
  }

  // 2. 尝试匹配业务协议（得分、行走、状态）
  const statusProto = protocols.find((p) => p.id !== hbProto?.id) ?? hbProto ?? protocols[0];
  if (statusProto) {
    const fieldsRules: { fieldName: string; step: number; customInit?: number }[] = [];
    const fields = statusProto.messages[0]?.fields.filter((f) => f.type !== "crc" && f.offset >= 0) ?? [];

    for (const f of fields) {
      const fn = f.name.toLowerCase();
      // 得分 +1
      if ((fn.includes("分") || fn.includes("score")) && (text.includes("分") || text.includes("+1") || text.includes("1"))) {
        fieldsRules.push({ fieldName: f.name, step: 1, customInit: 0 });
      }
      // 行走 +10
      else if ((fn.includes("走") || fn.includes("距") || fn.includes("distance") || fn.includes("pos")) && (text.includes("走") || text.includes("距") || text.includes("+10") || text.includes("10"))) {
        fieldsRules.push({ fieldName: f.name, step: 10, customInit: 0 });
      }
      // 速度 +5
      else if ((fn.includes("速") || fn.includes("speed")) && text.includes("速")) {
        fieldsRules.push({ fieldName: f.name, step: 5, customInit: 0 });
      }
    }

    // 如果没命中具体名字，但用户提到了数字增量，为前两个数值字段绑定步长
    if (fieldsRules.length === 0 && fields.length > 0) {
      const numericFields = fields.filter((f) => f.type === "uint" || f.type === "int");
      if (numericFields[0]) fieldsRules.push({ fieldName: numericFields[0].name, step: 1, customInit: 0 });
      if (numericFields[1]) fieldsRules.push({ fieldName: numericFields[1].name, step: 10, customInit: 0 });
    }

    actions.push({
      protocolId: statusProto.id,
      protocolName: statusProto.name,
      intervalMs: 1000,
      fields: fieldsRules,
    });
  }

  return {
    name: userPrompt.length > 20 ? userPrompt.slice(0, 18) + "…" : userPrompt || "自动化自增测试",
    intervalMs: 1000,
    repeat: 100,
    actions: actions.length > 0 ? actions : (statusProto ? [{ protocolId: statusProto.id, protocolName: statusProto.name, intervalMs: 1000, fields: [] }] : []),
    assertions: [],
    explanation: "本地离线引擎：已自动匹配协议并为得分/行走字段绑定自增步长（无需联网）。",
  };
}

/** 调用 DeepSeek / OpenAI 模型生成自动化测试用例 */
export async function remoteGenerateCaseDraft(userPrompt: string, protocols: PdlProtocol[], cfg: AiConfig): Promise<GeneratedCaseDraft> {
  const protoDescriptions = protocols.map((p, i) => {
    const flds = p.messages[0]?.fields.filter((f) => f.type !== "crc" && f.offset >= 0).map((f) => `${f.name}(${f.type},初始${f.value ?? 0})`).join(", ");
    return `${i + 1}. 协议名称: "${p.name}", id: "${p.id}", 可用字段: [${flds}]`;
  }).join("\n");

  const system = `你是嵌入式串口自动化专家。在串口自动化测试中，“变量”永远都是通信协议里的字段数据。
现有通信协议列表：
${protoDescriptions}

用户需求：${userPrompt}

请根据用户需求，从已有协议列表中挑出需要执行的协议，并为其中的字段配置步长（step：每次自增/自减多少）和初始值（customInit）。
要求：只输出标准 JSON 格式，不要 Markdown 代码块，不要额外文字说明。
JSON 格式示例：
{
  "name": "用例名称",
  "intervalMs": 1000,
  "repeat": 100,
  "actions": [
    {
      "protocolId": "协议ID",
      "protocolName": "协议名称",
      "intervalMs": 1000,
      "fields": [
        { "fieldName": "字段名", "step": 1, "customInit": 0 }
      ]
    }
  ],
  "assertions": [],
  "explanation": "简短设计意图"
}`;

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `请根据需求编排用例：${userPrompt}` },
      ],
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek 响应异常 ${res.status}：${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const rawContent = data.choices?.[0]?.message?.content ?? "";
  const jsonText = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(jsonText) as GeneratedCaseDraft;

  // 校验补齐协议 ID
  const fixedActions: GeneratedCaseAction[] = (parsed.actions ?? []).map((act) => {
    const matchedProto = protocols.find((p) => p.id === act.protocolId || p.name === act.protocolName) ?? protocols[0];
    return {
      protocolId: matchedProto?.id ?? act.protocolId,
      protocolName: matchedProto?.name ?? act.protocolName,
      intervalMs: Number(act.intervalMs) || 1000,
      fields: (act.fields ?? []).map((f) => ({
        fieldName: f.fieldName,
        step: Number(f.step) || 0,
        customInit: f.customInit !== undefined ? Number(f.customInit) : undefined,
      })),
    };
  });

  return {
    name: parsed.name || "AI 编排自动化用例",
    intervalMs: Number(parsed.intervalMs) || 1000,
    repeat: Number(parsed.repeat) || 100,
    actions: fixedActions,
    assertions: parsed.assertions ?? [],
    explanation: parsed.explanation || "由 DeepSeek 模型智能编排生成。",
  };
}

/** 本地生成整套产品与测试（离线无需 Key） */
export function localGenerateProductDraft(userPrompt: string): GeneratedProductDraft {
  const prodName = userPrompt.trim() || "智能车载控制终端";
  return {
    productName: prodName,
    subProductName: "主控制器MCU",
    protocols: [
      {
        name: "心跳保活帧",
        checksumAlg: "ADD8",
        fields: [
          { id: "h1", name: "帧头", type: "uint", size: 1, offset: 0, value: 0x7e, hex: "7E", desc: "固定起始符" },
          { id: "h2", name: "功能码", type: "uint", size: 1, offset: 1, value: 0x01, desc: "01=心跳" },
          { id: "h3", name: "心跳计数", type: "uint", size: 2, offset: 2, value: 0, desc: "序列号" },
          { id: "h4", name: "校验和", type: "crc", size: 1, offset: 4, desc: "SUM8校验" },
          { id: "h5", name: "帧尾", type: "uint", size: 1, offset: 5, value: 0x7e, hex: "7E", desc: "固定结束符" },
        ],
        sampleFrame: "7E 01 00 00 7F 7E",
      },
      {
        name: "车辆状态上报帧",
        checksumAlg: "CRC16/MODBUS",
        fields: [
          { id: "v1", name: "帧头", type: "uint", size: 1, offset: 0, value: 0xaa, hex: "AA", desc: "固定起始符" },
          { id: "v2", name: "命令字", type: "uint", size: 1, offset: 1, value: 0x02, desc: "02=状态" },
          { id: "v3", name: "车辆得分", type: "uint", size: 2, offset: 2, value: 0, desc: "实时比赛得分" },
          { id: "v4", name: "行走距离", type: "uint", size: 4, offset: 4, value: 0, desc: "行驶距离(米)" },
          { id: "v5", name: "当前车速", type: "uint", size: 2, offset: 8, value: 20, desc: "速度(km/h)" },
          { id: "v6", name: "CRC校验", type: "crc", size: 2, offset: 10, desc: "CRC16低字节先" },
          { id: "v7", name: "帧尾", type: "uint", size: 1, offset: 12, value: 0x55, hex: "55", desc: "固定结束符" },
        ],
        sampleFrame: "AA 02 00 00 00 00 00 00 00 14 38 F7 55",
      },
    ],
    caseName: `${prodName} 自动化自增测试`,
    caseActions: [
      {
        protocolIndex: 0,
        intervalMs: 1000,
        fields: [{ fieldName: "心跳计数", step: 1, customInit: 0 }],
      },
      {
        protocolIndex: 1,
        intervalMs: 1000,
        fields: [
          { fieldName: "车辆得分", step: 1, customInit: 0 },
          { fieldName: "行走距离", step: 10, customInit: 0 },
        ],
      },
    ],
    explanation: "本地离线生成：包含标准心跳保活帧与车辆状态上报帧，并预置了每秒得分+1与行走+10米的自动化测试用例。",
  };
}

/** 远程 DeepSeek 生成整套产品与测试 */
export async function remoteGenerateProductDraft(userPrompt: string, cfg: AiConfig): Promise<GeneratedProductDraft> {
  const system = `你是嵌入式软硬件架构专家。请根据用户的一句话产品设想，设计该产品的完整串口通信方案。
方案必须包含：
1. 产品名称与子产品模块名称
2. 2个通信协议（通常为心跳保活帧和状态交互帧，必须包含清晰的字段名、类型uint/int/bytes/crc、字节大小size、偏移offset、默认值value）
3. 1个全自动测试用例（引用生成的协议，并在关键字段上配置每秒递增步长step）
必须只返回纯 JSON，严禁输出任何 Markdown 标记或多余文字。
JSON 格式：
{
  "productName": "产品名称",
  "subProductName": "主模块MCU",
  "protocols": [
    {
      "name": "协议名称",
      "checksumAlg": "CRC16/MODBUS",
      "fields": [
        { "name": "帧头", "type": "uint", "size": 1, "offset": 0, "value": 126, "hex": "7E", "desc": "说明" },
        { "name": "校验码", "type": "crc", "size": 2, "offset": 5, "desc": "CRC" }
      ]
    }
  ],
  "caseName": "自动化测试用例名称",
  "caseActions": [
    {
      "protocolIndex": 1,
      "intervalMs": 1000,
      "fields": [{ "fieldName": "字段名", "step": 10, "customInit": 0 }]
    }
  ],
  "explanation": "设计意图"
}`;

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `请设计产品：${userPrompt}` },
      ],
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek 响应异常 ${res.status}：${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const rawContent = data.choices?.[0]?.message?.content ?? "";
  const jsonText = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(jsonText) as GeneratedProductDraft;

  // 格式化字段
  const formattedProtocols = (parsed.protocols ?? []).map((p, pIdx) => {
    let curOff = 0;
    const flds: PdlField[] = (p.fields ?? []).map((f, fIdx) => {
      const size = Number(f.size) || 1;
      const off = typeof f.offset === "number" ? f.offset : curOff;
      curOff = off + size;
      return {
        id: `f_${pIdx}_${fIdx}_${Date.now()}`,
        name: f.name,
        type: (["uint", "int", "float", "bool", "enum", "bytes", "crc", "reserved"].includes(f.type) ? f.type : "uint") as PdlField["type"],
        size,
        offset: off,
        value: f.value ?? 0,
        hex: f.hex,
        desc: f.desc,
      };
    });
    return {
      name: p.name,
      checksumAlg: (p.checksumAlg as ChecksumAlgorithm) || "CRC16/MODBUS",
      fields: flds,
      sampleFrame: p.sampleFrame,
    };
  });

  return {
    productName: parsed.productName || userPrompt,
    subProductName: parsed.subProductName || "主控制器",
    protocols: formattedProtocols,
    caseName: parsed.caseName || `${parsed.productName} 自动化测试`,
    caseActions: parsed.caseActions ?? [],
    explanation: parsed.explanation || "由 DeepSeek 模型智能架构生成。",
  };
}
