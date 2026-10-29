/**
 * 测试执行引擎（真跑，支持类似 Apifox 的接口变量提取与断言体系）
 *
 * - 步骤真驱动串口链路：发 HEX / 发文本、参数占位符替换 ${name}
 * - 后置变量提取 (Extract)：从回包中通过 正则 / 字节范围 / 协议字段 提取变量
 * - 可视化断言 (Assert)：文本包含、正则匹配、HEX 通配符匹配 (??)、数值/范围比较
 * - 复杂流程控制：支持 if 分支、while 循环、重试、延时
 */
import { appendChecksum, decodeFrame, encodeMessage, hasChecksum, type DecodedField } from "./codec";
import { parseHex, toHex, stringToBytes, bytesToString, matchHexPattern } from "./bytes";
import type { PdlProtocol } from "./pdl";
import type { CaseItem, CaseStep, Frame, RunResult, StepResult } from "./types";

export interface RunnerHost {
  getProtocol: () => PdlProtocol;
  getAllProtocols?: () => PdlProtocol[];
  getFrames: () => Frame[];
  pushFrame: (f: Omit<Frame, "id" | "time" | "ts" | "no">) => void;
  write: (bytes: number[]) => Promise<void>;
  isLinkOpen: () => boolean;
  autoChecksum?: () => boolean;
  shouldStop?: () => boolean;
  onStep?: (caseId: string, stepIndex: number, result: StepResult) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function nowTime(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/* ---------------- 断言求值 ---------------- */

type Op = {
  kind: "equals" | "range" | "in" | "greater" | "less" | "gte" | "lte" | "neq" | "exists" | "notexists";
  values: number[];
};

function parseOp(raw: string): Op | null {
  const s = raw.trim().toLowerCase();
  if (s === "exists") return { kind: "exists", values: [] };
  if (s === "notexists" || s === "not exists") return { kind: "notexists", values: [] };
  let m = s.match(/^==?\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "equals", values: [Number(m[1])] };
  m = s.match(/^equals\s+(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "equals", values: [Number(m[1])] };
  m = s.match(/^!=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "neq", values: [Number(m[1])] };
  m = s.match(/^range\s+(-?\d+(?:\.\d+)?)\s*(?:\.\.|~|-)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "range", values: [Number(m[1]), Number(m[2])] };
  m = s.match(/^in\s+([-\d.,\s]+)$/);
  if (m) return { kind: "in", values: m[1].split(/[,\s]+/).filter(Boolean).map(Number) };
  m = s.match(/^>=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "gte", values: [Number(m[1])] };
  m = s.match(/^<=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "lte", values: [Number(m[1])] };
  m = s.match(/^>\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "greater", values: [Number(m[1])] };
  m = s.match(/^<\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: "less", values: [Number(m[1])] };
  return null;
}

function evalOp(value: number, op: Op): boolean {
  switch (op.kind) {
    case "equals":
      return Math.abs(value - op.values[0]) < 1e-9;
    case "neq":
      return Math.abs(value - op.values[0]) >= 1e-9;
    case "range":
      return value >= op.values[0] && value <= op.values[1];
    case "in":
      return op.values.some((v) => Math.abs(value - v) < 1e-9);
    case "greater":
      return value > op.values[0];
    case "less":
      return value < op.values[0];
    case "gte":
      return value >= op.values[0];
    case "lte":
      return value <= op.values[0];
    case "exists":
      return true;
    case "notexists":
      return false;
  }
}

function fieldNumber(fields: DecodedField[] | undefined, name: string): number | null {
  const f = fields?.find((x) => x.field.name === name);
  if (!f) return null;
  if (typeof f.value === "boolean") return f.value ? 1 : 0;
  if (typeof f.value === "number") return f.value;
  const n = Number(f.value);
  return Number.isFinite(n) ? n : null;
}

function parseTimeout(raw: string | undefined, fallback = 3000): number {
  if (!raw) return fallback;
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(ms|s|m)?/i);
  if (!m) return fallback;
  const v = Number(m[1]);
  const unit = (m[2] ?? "ms").toLowerCase();
  if (unit === "s") return v * 1000;
  if (unit === "m") return v * 60000;
  return v;
}

/* ---------------- 变量与参数替换 ---------------- */

type Ctrl = "ok" | "fail" | "break" | "continue";

interface RunCtx {
  startFrameIndex: number;
  linkOpen: boolean;
  vars: Record<string, string | number>;
  depth: number;
  retries: number;
  abortOnFail: boolean;
}

const MAX_DEPTH = 6;

function substText(s: string | undefined, vars: Record<string, string | number>): string | undefined {
  if (!s) return s;
  return s.replace(/\$\{([^}]+)\}/g, (m, k) => {
    const v = vars[String(k).trim()];
    return v === undefined ? m : String(v);
  });
}

function substStep(step: CaseStep, vars: Record<string, string | number>): CaseStep {
  if (!Object.keys(vars).length) return step;
  return {
    ...step,
    detail: substText(step.detail, vars),
    cond: substText(step.cond, vars),
    timeout: substText(step.timeout, vars),
    targetVar: substText(step.targetVar, vars),
    extractRule: substText(step.extractRule, vars),
    fields: step.fields?.map((f) => ({ label: f.label, value: substText(f.value, vars) ?? "" })),
  };
}

/** 取条件左边的值：先查变量，再查最近回包 */
function condValue(host: RunnerHost, name: string, ctx: RunCtx): number | null {
  if (ctx.vars[name] !== undefined) {
    const n = Number(ctx.vars[name]);
    return Number.isFinite(n) ? n : null;
  }
  const frames = host
    .getFrames()
    .slice(ctx.startFrameIndex)
    .filter((f) => f.dir === "rx" && f.crcOk);
  const last = frames[frames.length - 1];
  return last ? fieldNumber(last.fields, name) : null;
}

function evalCond(host: RunnerHost, cond: string | undefined, ctx: RunCtx): { ok: boolean; detail: string } {
  const raw = (cond ?? "").trim();
  if (!raw) return { ok: false, detail: "条件为空" };
  const m = raw.match(/^([A-Za-z_]\w*)\s*(>=|<=|==|!=|=|>|<)?\s*(.*)$/);
  if (!m) return { ok: false, detail: `条件格式无法识别：${raw}` };
  const name = m[1];
  const sym = m[2];
  const rest = (m[3] ?? "").trim();
  const opStr = sym ? `${sym} ${rest}`.trim() : rest;
  const op = parseOp(opStr);
  if (!op) return { ok: false, detail: `无法识别比较符：${raw}` };
  const v = condValue(host, name, ctx);
  if (op.kind === "exists" || op.kind === "notexists") {
    const has = v !== null;
    const ok = op.kind === "exists" ? has : !has;
    return { ok, detail: `${name} ${op.kind === "exists" ? "存在" : "不存在"}` };
  }
  if (v === null) return { ok: false, detail: `${name} 当前未获取到数值` };
  const ok = evalOp(v, op);
  return { ok, detail: `${name}=${v} ${opStr} → ${ok ? "成立" : "不成立"}` };
}

function evalExpr(expr: string, vars: Record<string, string | number>): number | null {
  const s = expr.trim().replace(/^=\s*/, "");
  const m = s.match(/^([A-Za-z_]\w*|-?\d+(?:\.\d+)?)\s*(?:([+\-*/])\s*([A-Za-z_]\w*|-?\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const pick = (t: string): number => {
    const v = vars[t];
    return v !== undefined ? Number(v) : Number(t);
  };
  const a = pick(m[1]);
  if (!Number.isFinite(a)) return null;
  if (!m[2]) return a;
  const b = m[3] ? pick(m[3]) : 0;
  if (!Number.isFinite(b)) return null;
  switch (m[2]) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? null : a / b;
  }
  return null;
}

const mkResult = (
  step: CaseStep,
  status: StepResult["status"],
  extra: Partial<StepResult> = {},
): StepResult => ({
  stepId: step.id,
  kind: step.kind,
  text: step.text,
  status,
  startedAt: nowTime(),
  durationMs: 0,
  ...extra,
});

/* ---------------- 步骤列表递归执行 ---------------- */

async function runList(
  host: RunnerHost,
  steps: CaseStep[],
  ctx: RunCtx,
  out: StepResult[],
  tag: string,
): Promise<Ctrl> {
  let hadFail = false;
  if (ctx.depth > MAX_DEPTH) {
    out.push(
      mkResult({ id: "depth", kind: "if", text: "嵌套" } as CaseStep, "fail", {
        error: `嵌套超过 ${MAX_DEPTH} 层，已停止`,
      }),
    );
    return "fail";
  }

  for (const raw of steps) {
    if (host.shouldStop?.()) return "break";
    const step = substStep(raw, ctx.vars);

    if (step.kind === "break") {
      out.push({ ...mkResult(step, "pass"), text: `${tag}break`, actual: "跳出循环" });
      return "break";
    }
    if (step.kind === "continue") {
      out.push({ ...mkResult(step, "pass"), text: `${tag}continue`, actual: "进入下一轮" });
      return "continue";
    }

    if (step.kind === "if") {
      const c = evalCond(host, step.cond, ctx);
      out.push({
        ...mkResult(step, "pass"),
        text: `${tag}if ${step.cond ?? ""}`,
        expected: step.cond,
        actual: `${c.detail} → 走 ${c.ok ? "then" : "else"}`,
      });
      const branch = c.ok ? step.children ?? [] : step.elseChildren ?? [];
      if (branch.length) {
        const r = await runList(host, branch, { ...ctx, depth: ctx.depth + 1 }, out, `${tag}  `);
        if (r === "fail") return "fail";
        if (r === "break") return "break";
      }
      continue;
    }

    if (step.kind === "while") {
      const maxRaw = step.timeout?.match(/\d+/)?.[0];
      const maxIter = Math.min(Math.max(1, maxRaw ? Number(maxRaw) : 100), 10000);
      let n = 0;
      let c = evalCond(host, step.cond, ctx);
      while (c.ok && n < maxIter) {
        const r = await runList(host, step.children ?? [], { ...ctx, depth: ctx.depth + 1 }, out, `${tag}  `);
        n++;
        if (r === "fail") return "fail";
        if (r === "break") break;
        c = evalCond(host, step.cond, ctx);
      }
      out.push({
        ...mkResult(step, "pass"),
        text: `${tag}while ${step.cond ?? ""}`,
        expected: `最多 ${maxIter} 次`,
        actual: `执行 ${n} 次后条件${c.ok ? "到上限" : "结束"}`,
      });
      continue;
    }

    let res = await runStep(host, step, ctx);
    for (let k = 0; k < ctx.retries && res.status === "fail"; k++) {
      out.push({ ...res, text: `${tag}[重试${k + 1}] ${res.text}` });
      res = await runStep(host, step, ctx);
    }
    out.push({ ...res, text: `${tag}${res.text}` });
    if (res.status === "fail") {
      if (ctx.abortOnFail) return "fail";
      hadFail = true;
    }
  }
  return hadFail ? "fail" : "ok";
}

/* ---------------- 步骤单步执行 ---------------- */

async function runStep(host: RunnerHost, step: CaseStep, ctx: RunCtx): Promise<StepResult> {
  const startedAt = nowTime();
  const t0 = performance.now();
  const base: Omit<StepResult, "status" | "durationMs" | "startedAt"> = {
    stepId: step.id,
    kind: step.kind,
    text: step.text,
  };

  const finish = (status: StepResult["status"], extra: Partial<StepResult> = {}): StepResult => ({
    ...base,
    status,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    ...extra,
  });

  const proto = host.getProtocol();
  const sendBytes = async (bytes: number[], source: Frame["source"]) => {
    host.pushFrame({ dir: "tx", source, bytes, crcOk: decodeFrame(proto, bytes).crcOk });
    if (host.isLinkOpen()) {
      try {
        await host.write(bytes);
      } catch (e) {
        throw new Error(`写串口失败：${(e as Error).message}`);
      }
    }
  };

  try {
    switch (step.kind) {
      /* ------------ 发送指令 (支持纯文本与 HEX，支持占位符) ------------ */
      case "send": {
        const rawContent = step.detail ?? "";
        let bytes: number[] = [];
        const stripped = rawContent.replace(/0x/gi, "").replace(/[\s,;:_-]/g, "");
        const hasNonHexChars = /[^0-9a-fA-F]/.test(stripped);
        const isText = step.sendMode === "text" || rawContent.startsWith("TEXT:") || hasNonHexChars || /[\r\n]/.test(rawContent);
        const cleanContent = rawContent.startsWith("TEXT:") ? rawContent.slice(5) : rawContent;

        if (isText) {
          bytes = stringToBytes(cleanContent, true);
        } else {
          bytes = parseHex(cleanContent);
        }

        if (!bytes.length) {
          return finish("fail", { error: "发送内容为空或无效十六进制" });
        }

        // 自动追加校验和
        if (host.autoChecksum?.() && !isText) {
          if (hasChecksum(proto)) {
            const probe = decodeFrame(proto, bytes);
            if (!(probe.matched && probe.crcOk)) bytes = appendChecksum(proto, bytes);
          }
        }

        await sendBytes(bytes, "case");
        return finish("pass", {
          expected: isText ? `[文本] ${cleanContent}` : `[HEX] ${toHex(bytes)}`,
          actual: `已发送 ${bytes.length} 字节`,
          frameHex: toHex(bytes),
        });
      }

      /* ------------ 后置提取变量 (Apifox 核心机制) ------------ */
      case "extract": {
        const varName = (step.targetVar || step.fields?.[0]?.label || "val").trim();
        const extractType = step.extractType || "regex";
        const rule = step.extractRule || step.fields?.[0]?.value || "";
        const timeout = parseTimeout(step.timeout, 2000);
        const deadline = performance.now() + timeout;

        let extractedValue: string | number | null = null;
        let lastHex = "";

        while (performance.now() < deadline) {
          const frames = host.getFrames().slice(ctx.startFrameIndex).filter((f) => f.dir === "rx");
          for (const fr of frames) {
            lastHex = toHex(fr.bytes);
            if (extractType === "regex") {
              const text = bytesToString(fr.bytes);
              try {
                const regex = new RegExp(rule);
                const m = text.match(regex);
                if (m) {
                  extractedValue = m[1] !== undefined ? m[1] : m[0];
                  break;
                }
              } catch {}
            } else if (extractType === "slice") {
              const parts = rule.split(/[:,-]/).map((x) => Number(x.trim()));
              const start = parts[0] || 0;
              const end = parts.length > 1 ? parts[1] : start + 1;
              const sliceBytes = fr.bytes.slice(start, end);
              if (sliceBytes.length) {
                extractedValue = toHex(sliceBytes);
                break;
              }
            } else if (extractType === "field") {
              const num = fieldNumber(fr.fields, rule);
              if (num !== null) {
                extractedValue = num;
                break;
              }
            }
          }
          if (extractedValue !== null) break;
          await sleep(20);
        }

        if (extractedValue !== null) {
          ctx.vars[varName] = extractedValue;
          return finish("pass", {
            expected: `提取 ${varName}`,
            actual: `${varName} = "${extractedValue}"`,
            extractedVars: { [varName]: extractedValue },
            frameHex: lastHex,
          });
        }
        return finish("fail", {
          expected: `在 ${timeout}ms 内提取 ${varName} (规则: ${rule})`,
          actual: lastHex ? "回包内容未匹配提取规则" : "超时未收到任何回包",
          frameHex: lastHex || undefined,
        });
      }

      /* ------------ Apifox 风格断言 (文本包含 / 正则 / HEX通配 / 数值) ------------ */
      case "assert":
      case "expect": {
        const timeout = parseTimeout(step.timeout);
        const deadline = performance.now() + timeout;
        const f0 = step.fields?.[0];
        const assertType = f0?.label || "contains";
        const expectedVal = f0?.value || step.detail || "";

        let matchFound = false;
        let lastObserved = "";
        let lastHex = "";

        while (performance.now() < deadline) {
          const frames = host.getFrames().slice(ctx.startFrameIndex).filter((x) => x.dir === "rx");
          for (const fr of frames) {
            const text = bytesToString(fr.bytes);
            lastHex = toHex(fr.bytes);

            if (assertType === "contains" || assertType === "文本包含") {
              if (text.includes(expectedVal)) {
                matchFound = true;
                lastObserved = text;
                break;
              }
            } else if (assertType === "regex" || assertType === "正则匹配") {
              try {
                if (new RegExp(expectedVal).test(text)) {
                  matchFound = true;
                  lastObserved = text;
                  break;
                }
              } catch {
                /* invalid regex */
              }
            } else if (assertType === "hex" || assertType === "HEX通配") {
              if (matchHexPattern(expectedVal, fr.bytes)) {
                matchFound = true;
                lastObserved = toHex(fr.bytes);
                break;
              }
            } else {
              // 字段数值断言，如 position equals 3000
              const op = parseOp(expectedVal);
              const num = fieldNumber(fr.fields, assertType);
              if (num !== null && op && evalOp(num, op)) {
                matchFound = true;
                lastObserved = `${assertType}=${num}`;
                break;
              }
            }
          }

          if (matchFound) break;
          await sleep(30);
        }

        if (matchFound) {
          return finish("pass", {
            expected: `${assertType}: ${expectedVal}`,
            actual: `断言通过（${lastObserved}）`,
            frameHex: lastHex,
          });
        }

        return finish("fail", {
          expected: `${assertType}: ${expectedVal}（在 ${timeout}ms 内）`,
          actual: ctx.linkOpen ? (lastHex ? `收到回包 ${lastHex}，断言不符` : "窗口内未收到任何回包") : "串口未连接",
          frameHex: lastHex || undefined,
        });
      }

      /* ------------ 组包修改并发送 (针对配置了结构化协议) ------------ */
      case "set": {
        const f = step.fields?.[0];
        if (!f) return finish("fail", { error: "set 步骤缺少字段" });
        const raw = f.value.replace(/^=\s*/, "");
        const num = Number(raw);
        const msg = proto.messages.find((m) => m.id === "status") ?? proto.messages[0];
        if (!msg) return finish("fail", { error: "协议中没有可发送的报文定义" });
        const values: Record<string, number> = {};
        for (const fld of msg.fields) {
          if (fld.type === "crc" || fld.offset < 0) continue;
          values[fld.name] = Number(fld.value ?? 0);
        }
        values[f.label] = Number.isFinite(num) ? num : 0;
        const bytes = encodeMessage(proto, msg, values);
        await sendBytes(bytes, "case");
        return finish("pass", {
          expected: `${f.label} = ${values[f.label]}`,
          actual: toHex(bytes),
          frameHex: toHex(bytes),
        });
      }

      /* ------------ 窗口内无异常断言 ------------ */
      case "assertNo": {
        const frames = host.getFrames().slice(ctx.startFrameIndex);
        const checks = step.fields?.map((x) => x.label) ?? [];
        const problems: string[] = [];
        if (checks.includes("crc_error")) {
          const bad = frames.filter((x) => x.dir === "rx" && !x.crcOk);
          if (bad.length) problems.push(`${bad.length} 帧 CRC 校验失败`);
        }
        if (checks.includes("unexpected_frame")) {
          const rx = frames.filter((x) => x.dir === "rx");
          if (rx.length > 1) problems.push(`收到 ${rx.length} 帧，期望 1 帧`);
        }
        return problems.length
          ? finish("fail", { expected: checks.join(" / ") + " 无异常", actual: problems.join("；") })
          : finish("pass", { expected: checks.join(" / ") + " 无异常", actual: "无异常" });
      }

      /* ------------ 延时 ------------ */
      case "delay": {
        const ms = parseTimeout(step.detail, 200);
        await sleep(Math.min(ms, 30000));
        return finish("pass", { actual: `等待 ${ms}ms` });
      }

      case "loop": {
        const n = parseTimeout(step.detail, 1);
        const count = Math.min(Math.max(1, Math.round(n)), 1000);
        for (let i = 0; i < count; i++) await sleep(10);
        return finish("pass", { actual: `循环 ${count} 次` });
      }

      case "parallel": {
        const msg = proto.messages.find((m) => m.id === "status") ?? proto.messages[0];
        if (!msg) return finish("fail", { error: "未找到报文定义" });
        const values: Record<string, number> = {};
        for (const fld of msg.fields) {
          if (fld.type === "crc" || fld.offset < 0) continue;
          values[fld.name] = Number(fld.value ?? 0);
        }
        for (const f of step.fields ?? []) {
          const num = Number(f.value.replace(/^=\s*/, ""));
          if (Number.isFinite(num)) values[f.label] = num;
        }
        const bytes = encodeMessage(proto, msg, values);
        await sendBytes(bytes, "case");
        return finish("pass", { actual: toHex(bytes), frameHex: toHex(bytes) });
      }

      /* ------------ 变量直接赋值与运算 ------------ */
      case "setVar": {
        const f = step.fields?.[0];
        const name = (f?.label ?? step.detail ?? "").trim();
        const expr = f?.value ?? "";
        if (!name) return finish("fail", { error: "setVar 缺少变量名" });
        const val = evalExpr(expr, ctx.vars);
        if (val === null) {
          // 如果不是算术运算，直接赋值文本
          ctx.vars[name] = expr.trim();
          return finish("pass", { expected: `${name} = ${expr}`, actual: `${name} = "${expr.trim()}"` });
        }
        ctx.vars[name] = val;
        return finish("pass", { expected: `${name} = ${expr}`, actual: `${name} = ${val}` });
      }

      default:
        return finish("skip", { error: `步骤类型 ${step.kind} 暂未启用` });
    }
  } catch (e) {
    return finish("fail", { error: (e as Error).message });
  }
}

/* ---------------- 数据驱动（CSV） ---------------- */

export function parseCsv(text?: string): Record<string, string>[] {
  if (!text || !text.trim()) return [];
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

function applyRow(item: CaseItem, row: Record<string, string>): CaseItem {
  const sub = (s?: string): string | undefined => {
    if (!s) return s;
    return s.replace(/\$\{([^}]+)\}/g, (_, k) => row[String(k).trim()] ?? "");
  };
  const walk = (steps: CaseStep[]): CaseStep[] =>
    steps.map((st) => ({
      ...st,
      detail: sub(st.detail),
      timeout: sub(st.timeout),
      cond: sub(st.cond),
      targetVar: sub(st.targetVar),
      extractRule: sub(st.extractRule),
      fields: st.fields?.map((f) => ({ label: f.label, value: sub(f.value) ?? "" })),
      children: st.children ? walk(st.children) : undefined,
      elseChildren: st.elseChildren ? walk(st.elseChildren) : undefined,
    }));
  return { ...item, steps: walk(item.steps) };
}

/* ---------------- 执行入口 ---------------- */

async function runOnce(
  host: RunnerHost,
  item: CaseItem,
  suiteName: string,
  onStep?: RunnerHost["onStep"],
): Promise<RunResult> {
  const startedAt = nowTime();
  const t0 = performance.now();
  const ctx = { startFrameIndex: host.getFrames().length, linkOpen: host.isLinkOpen() };
  const items: StepResult[] = [];

  const hasActions = !!(item.actions && item.actions.length > 0);
  const hasFieldRules = !!(item.fieldRules && item.fieldRules.length > 0);
  if (!item.steps.length && !hasFieldRules && !hasActions) {
    return {
      id: `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      caseId: item.id,
      caseName: item.name,
      suite: suiteName,
      startedAt,
      durationMs: 0,
      status: "fail",
      items: [],
      reason: "该用例还没有步骤，无法执行",
    };
  }

  let failed = false;
  const runStart = ctx.startFrameIndex;
  const rounds = item.repeat === 0 ? Infinity : Math.min(Math.max(1, Math.round(item.repeat ?? 1)), 99999);
  const gap = Math.max(0, Number(item.intervalMs ?? 0));
  const retries = Math.min(Math.max(0, Number(item.retries ?? 0)), 20);
  const vars = item.vars ?? [];
  const stopOnFail = item.stopOnFail !== false;
  const maxDuration = Math.max(0, Number(item.maxDurationMs ?? 0));
  const deadline = maxDuration > 0 ? t0 + maxDuration : Infinity;
  const outOfTime = () => performance.now() >= deadline;
  let timedOut = false;

  for (let r = 0; r < rounds; r++) {
    if (host.shouldStop?.()) break;
    if (outOfTime()) {
      timedOut = true;
      break;
    }
    if (failed && stopOnFail) break;
    if (r > 0 && gap > 0) await new Promise((res) => setTimeout(res, gap));

    const row: Record<string, string> = {};
    const runtimeVars: Record<string, string | number> = {};
    for (const v of vars) {
      const val = v.init + v.step * r;
      row[v.name] = String(val);
      runtimeVars[v.name] = val;
    }
    const steps = vars.length ? applyRow(item, row).steps : item.steps;
    const tag = rounds === Infinity ? `[#${r + 1}] ` : rounds > 1 ? `[第${r + 1}轮] ` : "";

    // 多协议任务图形化下发（支持从用户添加的协议中选：心跳协议、车辆行走协议等）
    if (item.actions && item.actions.length > 0) {
      const allProtocols = host.getAllProtocols ? host.getAllProtocols() : [host.getProtocol()];
      for (const act of item.actions) {
        if (act.enabled === false) continue;
        const proto = (act.protocolId ? allProtocols.find((p) => p.id === act.protocolId) : null) ?? allProtocols[0] ?? host.getProtocol();
        const msg = (act.messageId ? proto.messages.find((m) => m.id === act.messageId) : null) ?? proto.messages[0];
        if (!msg) continue;

        // 协议字段是第一真相来源：基准值 100% 动态读取协议当前的最新定义
        const values: Record<string, number | string | boolean> = {};
        for (const fld of msg.fields) {
          if (fld.type === "crc" || fld.offset < 0) continue;
          values[fld.name] = Number(fld.value ?? 0);
        }

        // 应用用例中针对字段配置的增量与覆盖（只有协议中当前存在的字段才应用）
        for (const fr of act.fields ?? []) {
          const fld = msg.fields.find((f) => f.name === fr.fieldName);
          if (!fld) continue;
          const base = fr.customInit !== undefined
            ? fr.customInit
            : (fr.initValue !== undefined && fr.initValue !== null ? fr.initValue : Number(fld.value ?? 0));
          const step = fr.step ?? 0;
          const curVal = base + (step * r);
          values[fr.fieldName] = curVal;
          runtimeVars[fr.fieldName] = curVal;
          row[fr.fieldName] = String(curVal);
        }

        const bytes = encodeMessage(proto, msg, values);
        host.pushFrame({
          dir: "tx",
          source: "case",
          bytes,
          crcOk: decodeFrame(proto, bytes).crcOk,
          protocolName: proto.name,
          protocolId: proto.id,
        });
        if (host.isLinkOpen()) {
          try {
            await host.write(bytes);
          } catch {
            failed = true;
          }
        }
        const displayVals = msg.fields
          .filter((f) => f.type !== "crc" && f.offset >= 0)
          .map((f) => `${f.name}=${values[f.name]}`)
          .join(", ");
        const stepRes: StepResult = {
          stepId: `${act.id}_r${r}`,
          kind: "send",
          text: `${tag}下发「${proto.name}」`,
          status: failed ? "fail" : "pass",
          startedAt: nowTime(),
          durationMs: 0,
          expected: displayVals ? `字段: ${displayVals}` : "固定协议帧",
          actual: host.isLinkOpen() ? `已发送 ${bytes.length} 字节 [${toHex(bytes)}]` : `串口未连接(模拟) [${toHex(bytes)}]`,
          frameHex: toHex(bytes),
        };
        items.push(stepRes);
        host.onStep?.(item.id, items.length - 1, stepRes);
      }
    }

    // 协议字段驱动：每一轮按协议定义自动编码并发送
    if (item.fieldRules && item.fieldRules.length > 0) {
      const proto = host.getProtocol();
      const msg = (item.targetMessageId ? proto.messages.find((m) => m.id === item.targetMessageId) : null) ?? proto.messages[0];
      if (msg) {
        const values: Record<string, number | string | boolean> = {};
        for (const fld of msg.fields) {
          if (fld.type === "crc" || fld.offset < 0) continue;
          values[fld.name] = Number(fld.value ?? 0);
        }
        for (const fr of item.fieldRules) {
          const curVal = fr.initValue + (fr.step * r);
          values[fr.fieldName] = curVal;
          runtimeVars[fr.fieldName] = curVal;
          row[fr.fieldName] = String(curVal);
        }
        const bytes = encodeMessage(proto, msg, values);
        host.pushFrame({ dir: "tx", source: "case", bytes, crcOk: decodeFrame(proto, bytes).crcOk });
        if (host.isLinkOpen()) {
          try {
            await host.write(bytes);
          } catch (e) {
            failed = true;
          }
        }
        const displayVals = item.fieldRules.map((fr) => `${fr.fieldName}=${values[fr.fieldName]}`).join(", ");
        items.push({
          stepId: `proto_round_${r}`,
          kind: "send",
          text: `${tag}协议组包下发「${msg.name}」`,
          status: "pass",
          startedAt: nowTime(),
          durationMs: 0,
          expected: `字段值: ${displayVals}`,
          actual: `已发送 ${bytes.length} 字节 [${toHex(bytes)}]`,
          frameHex: toHex(bytes),
        });
      }
    }

    const rctx: RunCtx = {
      startFrameIndex: host.getFrames().length,
      linkOpen: ctx.linkOpen,
      vars: runtimeVars,
      depth: 0,
      retries,
      abortOnFail: stopOnFail,
    };

    const before = items.length;
    const ctrl = steps.length ? await runList(host, steps, rctx, items, tag) : "ok";
    for (let i = before; i < items.length; i++) onStep?.(item.id, i - before, items[i]);
    if (ctrl === "fail") {
      failed = true;
      if (stopOnFail) break;
    }
    if (timedOut) break;
    if (failed && stopOnFail) break;
    if (items.length > 50000) break;
  }

  const runFrames = host.getFrames().slice(runStart);
  const txFrames = runFrames.filter((f) => f.dir === "tx");
  const rxFrames = runFrames.filter((f) => f.dir === "rx");
  const delays: number[] = [];
  for (const t of txFrames) {
    const reply = rxFrames.find((f) => f.ts >= t.ts);
    if (reply) delays.push(Math.max(0, reply.ts - t.ts));
  }
  const stats = {
    sent: txFrames.length,
    received: rxFrames.length,
    lost: Math.max(0, txFrames.length - rxFrames.length),
    avgMs: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0,
    maxMs: delays.length ? Math.max(...delays) : 0,
  };

  const failItem = items.find((x) => x.status === "fail");
  const autoStop = timedOut ? `已达到最长运行时长 ${Math.round(maxDuration / 1000)}s` : "";
  return {
    id: `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    caseId: item.id,
    caseName: item.name,
    suite: suiteName,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    status: failed ? "fail" : "pass",
    items,
    stats,
    reason: failItem
      ? `${failItem.expected ?? ""} — ${failItem.actual ?? failItem.error ?? "失败"}${autoStop ? `（${autoStop}）` : ""}`
      : autoStop || undefined,
  };
}

export async function runCase(
  host: RunnerHost,
  item: CaseItem,
  suiteName: string,
  onStep?: RunnerHost["onStep"],
): Promise<RunResult> {
  const rows = parseCsv(item.dataDriven);
  if (!rows.length) return runOnce(host, item, suiteName, onStep);

  const startedAt = nowTime();
  const t0 = performance.now();
  const all: StepResult[] = [];
  let failReason = "";

  for (let i = 0; i < rows.length; i++) {
    const r = await runOnce(host, applyRow(item, rows[i]), `${suiteName} · 数据行${i + 1}`, onStep);
    all.push(...r.items.map((it) => ({ ...it, text: `[行${i + 1}] ${it.text}` })));
    if (r.status === "fail") {
      failReason = `数据行${i + 1}：${r.reason ?? "失败"}`;
      break;
    }
  }

  return {
    id: `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    caseId: item.id,
    caseName: item.name,
    suite: suiteName,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    status: failReason ? "fail" : "pass",
    items: all,
    reason: failReason || undefined,
  };
}

export async function runSuite(
  host: RunnerHost,
  cases: CaseItem[],
  suiteName: string,
  onStep?: RunnerHost["onStep"],
  onCaseDone?: (r: RunResult) => void,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const c of cases) {
    const r = await runCase(host, c, suiteName, onStep);
    results.push(r);
    onCaseDone?.(r);
  }
  return results;
}

export { parseOp, evalOp, parseTimeout };
