/**
 * 整机验收（给客户用的，不是给开发用的）
 *
 * 在软件里点「整机验收」即可运行，不需要装 Node / Playwright。
 * 覆盖客户真正会走的链路：
 *   组包 → 发送 → 回包 → 解包 → 断言 → 报告
 * 以及：无限循环自停、失败即停、CSV 数据驱动、变量自增、校验算法、数据库读写。
 *
 * 每一项都真实执行，失败会给出「期望 vs 实际」，结果可导出成《项目交付验收单》。
 */
import { computeChecksum, CHECKSUM_ALGORITHMS } from "./crc";
import { decodeFrame, encodeMessage } from "./codec";
import { CRANE_PROTOCOL } from "./pdl";
import { runCase, parseCsv } from "./runner";
import { exec, query, run, tableCount } from "./db";
import { loadRuns } from "./repo";
import { toHex } from "./bytes";
import { APP_NAME, APP_VERSION } from "./version";
import type { CaseItem, CaseStep, Frame, Source } from "./types";
import type { SelfTestItem } from "./selftest";

/** 验收分组 = 《解决方案说明》第四章「客户验收标准」的 9 项 */
export const ACCEPTANCE_GROUPS = [
  "协议解析",
  "协议编解码",
  "通讯调试",
  "自动化测试",
  "CSV 数据驱动",
  "长时间运行",
  "报告生成",
  "数据库存储",
  "桌面运行环境",
] as const;

/** 内存宿主：模拟一台会回包的设备（不占串口，不需要硬件） */
function makeHost(opts: { autoReply: boolean; badReply?: boolean; replyValue?: number }) {
  const frames: Frame[] = [];
  let id = 1;
  const proto = CRANE_PROTOCOL;
  const written: number[][] = [];
  const host = {
    getProtocol: () => proto,
    getFrames: () => frames,
    pushFrame: (f: Omit<Frame, "id" | "time" | "ts" | "no">) => {
      frames.push({ id: id++, time: "00:00:00.000", ts: Date.now(), no: id, ...f } as Frame);
    },
    write: async (bytes: number[]) => {
      written.push(bytes);
      if (!opts.autoReply) return;
      const msg = proto.messages.find((m) => m.id === "read_resp")!;
      const resp = encodeMessage(proto, msg, {
        addr: 1,
        func: 3,
        byte_count: 2,
        position: opts.badReply ? 999 : (opts.replyValue ?? 3000),
      });
      if (opts.badReply) resp[resp.length - 1] ^= 0xff;
      const d = decodeFrame(proto, resp);
      host.pushFrame({
        dir: "rx",
        source: "device" as Source,
        bytes: resp,
        crcOk: d.crcOk,
        fields: d.fields,
        crcExpected: d.crcExpected,
        crcActual: d.crcActual,
      });
    },
    isLinkOpen: () => true,
  };
  return { host, frames, written };
}

/** 一帧合法的读请求（写出去后模拟设备会回一帧 position=3000） */
function requestHex(): string {
  const proto = CRANE_PROTOCOL;
  const req = proto.messages.find((m) => m.id === "read_req")!;
  return toHex(encodeMessage(proto, req, {}));
}

function makeCase(steps: CaseStep[], extra: Partial<CaseItem> = {}): CaseItem {
  return {
    id: "acceptance",
    subProductId: "sp",
    name: "整机验收用例",
    roleId: "",
    tags: [],
    status: "idle",
    statusText: "未运行",
    stepCount: steps.length,
    assertionCount: 0,
    steps,
    yaml: "",
    ...extra,
  } as CaseItem;
}

const sid = () => `s${Math.random().toString(16).slice(2, 8)}`;
const delayStep = (ms: string): CaseStep => ({ id: sid(), kind: "delay", text: "等待", detail: ms });
const sendStep = (): CaseStep => ({ id: sid(), kind: "send", text: "发送", detail: requestHex() });
const expectStep = (field: string, op: string, timeout = "within 2s"): CaseStep => ({
  id: sid(),
  kind: "expect",
  text: "断言",
  detail: "field",
  fields: [{ label: field, value: op }],
  timeout,
});

export async function runAcceptance(): Promise<SelfTestItem[]> {
  const out: SelfTestItem[] = [];

  const add = async (group: string, name: string, fn: () => string | null | Promise<string | null>) => {
    const t0 = performance.now();
    let item: SelfTestItem;
    try {
      const err = await fn();
      item = { group, name, ok: err === null, detail: err ?? "通过", ms: Math.round(performance.now() - t0) };
    } catch (e) {
      item = {
        group,
        name,
        ok: false,
        detail: `异常：${(e as Error).message}`,
        ms: Math.round(performance.now() - t0),
      };
    }
    out.push(item);
  };

  /* ---------- 协议解析 ---------- */
  await add("协议解析", `校验算法 ${CHECKSUM_ALGORITHMS.length} 种全部可计算`, () => {
    const bad: string[] = [];
    for (const alg of CHECKSUM_ALGORITHMS) {
      try {
        const v = computeChecksum(alg, [0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]);
        if (typeof v !== "number" || Number.isNaN(v)) bad.push(alg);
      } catch {
        bad.push(alg);
      }
    }
    return bad.length ? `异常算法：${bad.join(", ")}` : null;
  });

  await add("协议解析", "字段解析：位段 / 有符号 / 枚举 同时正确", () => {
    const proto = CRANE_PROTOCOL;
    const msg = proto.messages.find((m) => m.id === "status")!;
    const bytes = encodeMessage(proto, msg, {});
    const d = decodeFrame(proto, bytes);
    if (!d.crcOk) return "校验未通过";
    const get = (n: string) => d.fields.find((f) => f.field.name === n)?.value;
    if (Number(get("position")) !== 3000) return `position 期望 3000，实际 ${get("position")}`;
    const inPos = get("in_position");
    if (!(inPos === true || inPos === 1)) return `in_position 期望 true，实际 ${JSON.stringify(inPos)}`;
    if (Number(get("speed_rpm")) !== -120) return `speed_rpm 期望 -120，实际 ${get("speed_rpm")}`;
    if (Number(get("target_point")) !== 3) return `target_point 期望 3，实际 ${get("target_point")}`;
    return null;
  });

  /* ---------- 协议编解码 ---------- */
  await add("协议编解码", "组包 → 解包：位置 3000 能原样还原", () => {
    const proto = CRANE_PROTOCOL;
    const msg = proto.messages.find((m) => m.id === "read_resp")!;
    const bytes = encodeMessage(proto, msg, { addr: 1, func: 3, byte_count: 2, position: 3000 });
    const d = decodeFrame(proto, bytes);
    if (!d.crcOk) return "校验未通过";
    const v = Number(d.fields.find((f) => f.field.name === "position")?.value);
    return v === 3000 ? null : `期望 3000，实际 ${v}`;
  });

  await add("协议编解码", "坏帧必须判失败（不能假装通过）", () => {
    const proto = CRANE_PROTOCOL;
    const msg = proto.messages.find((m) => m.id === "read_resp")!;
    const bytes = encodeMessage(proto, msg, { addr: 1, func: 3, byte_count: 2, position: 3000 });
    bytes[bytes.length - 1] ^= 0xff;
    const d = decodeFrame(proto, bytes);
    return d.crcOk ? "坏帧被误判为通过" : null;
  });

  /* ---------- 通讯调试 ---------- */
  await add("通讯调试", "发送 + 回包：真发一帧，收到回包并断言通过", async () => {
    const { host, written } = makeHost({ autoReply: true });
    const r = await runCase(host, makeCase([sendStep(), expectStep("position", "equals 3000")]), "验收");
    if (r.status !== "pass") return `状态 ${r.status}：${r.reason ?? ""}`;
    if (!written.length) return "没有真的发送";
    return null;
  });

  /* ---------- 自动化测试 ---------- */
  await add("自动化测试", "断言不满足必须判失败（防止假通过）", async () => {
    const { host } = makeHost({ autoReply: true });
    const r = await runCase(host, makeCase([sendStep(), expectStep("position", "equals 1111", "within 300ms")]), "验收");
    return r.status === "fail" ? null : "断言不满足却判为通过";
  });

  await add("自动化测试", "空用例必须判失败", async () => {
    const { host } = makeHost({ autoReply: true });
    const r = await runCase(host, makeCase([]), "验收");
    return r.status === "fail" ? null : "空用例被判为通过";
  });

  await add("自动化测试", "失败即停：第一次失败就停", async () => {
    const { host } = makeHost({ autoReply: true, badReply: true });
    const r = await runCase(
      host,
      makeCase([expectStep("position", "equals 3000", "within 200ms"), delayStep("10ms"), delayStep("10ms")], {
        repeat: 3,
        retries: 0,
      }),
      "验收",
    );
    if (r.status !== "fail") return "应当失败";
    return r.items.length === 1 ? null : `期望只跑 1 步，实际 ${r.items.length} 步`;
  });

  await add("自动化测试", "失败即停关闭后：跑完剩余轮次再判失败", async () => {
    const { host } = makeHost({ autoReply: true, badReply: true });
    const r = await runCase(
      host,
      makeCase([expectStep("position", "equals 3000", "within 200ms"), delayStep("5ms")], {
        repeat: 2,
        retries: 0,
        stopOnFail: false,
      }),
      "验收",
    );
    if (r.status !== "fail") return "应当失败";
    return r.items.length === 4 ? null : `期望 4 步（2 轮），实际 ${r.items.length}`;
  });

  await add("自动化测试", "if 条件分支：成立走 then，不成立走 else", async () => {
    const { host } = makeHost({ autoReply: true, replyValue: 3000 });
    const send = sendStep();
    const ifStep = (cond: string, children: CaseStep[], elseChildren: CaseStep[]): CaseStep => ({
      id: sid(),
      kind: "if",
      text: "if",
      cond,
      children,
      elseChildren,
    });
    const c = makeCase([
      send,
      ifStep("position > 100", [sendStep(), expectStep("position", "equals 3000")], [expectStep("position", "equals 1", "within 200ms")]),
    ]);
    const r = await runCase(host, c, "验收");
    if (r.status !== "pass") return `条件成立时没走 then：${r.reason ?? ""}`;
    const hit = r.items.filter((i) => i.kind === "expect" && i.status === "pass");
    return hit.length === 1 ? null : `then 分支没执行（断言通过 ${hit.length} 次）`;
  });

  await add("自动化测试", "while 循环：跑到条件不成立，且有次数上限", async () => {
    const { host } = makeHost({ autoReply: true });
    const setVar = (name: string, expr: string): CaseStep => ({
      id: sid(),
      kind: "setVar",
      text: "setVar",
      detail: name,
      fields: [{ label: name, value: `= ${expr}` }],
    });
    const c = makeCase([
      setVar("score", "0"),
      { id: sid(), kind: "while", text: "while", cond: "score < 3", timeout: "max 10", children: [setVar("score", "score + 1")] },
    ]);
    const r = await runCase(host, c, "验收");
    if (r.status !== "pass") return `状态 ${r.status}：${r.reason ?? ""}`;
    const w = r.items.find((i) => i.kind === "while");
    return /执行 3 次/.test(w?.actual ?? "") ? null : `循环次数不对：${w?.actual ?? "(无)"}`;
  });

  await add("自动化测试", "变量自增：3 轮各跑一遍", async () => {
    const { host } = makeHost({ autoReply: true });
    const c = makeCase([sendStep()], { repeat: 3, vars: [{ name: "score", init: 0, step: 1 }] });
    const r = await runCase(host, c, "验收");
    if (r.status !== "pass") return `状态 ${r.status}：${r.reason ?? ""}`;
    const rounds = r.items.filter((i) => /^\[第\d+轮\]/.test(i.text));
    return rounds.length === 3 ? null : `期望 3 轮，实际 ${rounds.length}`;
  });

  /* ---------- CSV 数据驱动 ---------- */
  await add("CSV 数据驱动", "CSV 解析：表头 + 2 行数据", () => {
    const rows = parseCsv("want,note\n96,第一行\n96,第二行");
    if (rows.length !== 2) return `期望 2 行，实际 ${rows.length}`;
    if (rows[0].want !== "96") return `第一行 want=${rows[0].want}`;
    if (rows[1].note !== "第二行") return `第二行 note=${rows[1].note}`;
    return null;
  });

  await add("CSV 数据驱动", "批量执行：3 行数据跑 3 遍", async () => {
    const { host } = makeHost({ autoReply: true, replyValue: 3000 });
    const c = makeCase([sendStep(), expectStep("position", "equals ${want}")], {
      dataDriven: "want\n3000\n3000\n3000",
    });
    const r = await runCase(host, c, "验收");
    if (r.status !== "pass") return `状态 ${r.status}：${r.reason ?? ""}`;
    const tagged = r.items.filter((i) => /^\[行\d+\]/.test(i.text));
    return tagged.length === 6 ? null : `期望 6 步（3 行 × 2 步），实际 ${tagged.length}`;
  });

  await add("CSV 数据驱动", "失败数据行能定位（报出第几行）", async () => {
    const { host } = makeHost({ autoReply: true, replyValue: 3000 });
    const c = makeCase([sendStep(), expectStep("position", "equals ${want}", "within 200ms")], {
      dataDriven: "want\n3000\n9999",
      retries: 0,
    });
    const r = await runCase(host, c, "验收");
    if (r.status !== "fail") return "应当失败";
    const bad = r.items.find((i) => i.status === "fail");
    return bad && /^\[行2\]/.test(bad.text) ? null : `没有定位到第 2 行：${bad?.text ?? "(无)"}`;
  });

  /* ---------- 长时间运行 ---------- */
  await add("长时间运行", "无限循环 + 最长运行 → 到点自动停", async () => {
    const { host } = makeHost({ autoReply: true });
    const t0 = Date.now();
    const r = await runCase(host, makeCase([delayStep("40ms")], { repeat: 0, intervalMs: 10, maxDurationMs: 600 }), "验收");
    const elapsed = Date.now() - t0;
    if (elapsed > 2000) return `跑了 ${elapsed}ms，没停住`;
    if (!/最长运行时长/.test(r.reason ?? "")) return `没有超时说明：${r.reason ?? "(空)"}`;
    return null;
  });

  await add("长时间运行", "长时间运行有统计（发送数 / 平均响应）", async () => {
    const { host } = makeHost({ autoReply: true });
    const r = await runCase(host, makeCase([sendStep(), expectStep("position", "equals 3000")], { repeat: 3 }), "验收");
    if (!r.stats) return "缺少统计";
    if (r.stats.sent < 3) return `发送数偏少：${r.stats.sent}`;
    if (typeof r.stats.avgMs !== "number") return "缺少平均响应";
    return null;
  });

  /* ---------- 报告生成 ---------- */
  await add("报告生成", "报告结构完整（状态/步骤/耗时/统计）", async () => {
    const { host } = makeHost({ autoReply: true });
    const r = await runCase(host, makeCase([sendStep(), expectStep("position", "equals 3000")]), "验收");
    if (!r.id || !r.caseName || !r.startedAt) return "缺少基础字段";
    if (typeof r.durationMs !== "number") return "缺少耗时";
    if (!Array.isArray(r.items) || !r.items.length) return "缺少步骤明细";
    if (!r.stats) return "缺少压测统计";
    if (typeof r.stats.sent !== "number" || typeof r.stats.avgMs !== "number") return "统计字段不全";
    if (r.stats.sent < 1) return "统计里没有发送数";
    if (r.stats.received < 1) return "统计里没有接收数";
    return null;
  });

  /* ---------- 数据库存储 ---------- */
  await add("数据库存储", "写入 → 读回 → 清理", () => {
    exec("CREATE TABLE IF NOT EXISTS _acceptance_probe (id TEXT, v INTEGER)");
    run("DELETE FROM _acceptance_probe");
    run("INSERT INTO _acceptance_probe (id, v) VALUES (?, ?)", ["probe", 42]);
    const rows = query<{ v: number }>("SELECT v FROM _acceptance_probe WHERE id = ?", ["probe"]);
    run("DELETE FROM _acceptance_probe");
    if (rows.length !== 1) return `读回 ${rows.length} 行`;
    return Number(rows[0].v) === 42 ? null : `值错误 ${rows[0].v}`;
  });

  await add("数据库存储", "已有数据可读取（协议表）", () => {
    const n = tableCount("protocol");
    return typeof n === "number" ? null : "读取失败";
  });

  await add("数据库存储", "报告历史可读取（趋势 / 通过率的数据源）", () => {
    const runs = loadRuns();
    if (!Array.isArray(runs)) return "读取失败";
    return null;
  });

  /* ---------- 桌面运行环境 ---------- */
  await add("桌面运行环境", "应用版本号可读取", () => {
    return /^\d+\.\d+\.\d+/.test(APP_VERSION) ? null : `版本号异常：${APP_VERSION}`;
  });

  await add("桌面运行环境", "界面样式已加载", () => {
    const el = document.querySelector(".icon-btn") ?? document.body;
    if (!el) return "界面未渲染";
    const bg = getComputedStyle(document.body).backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") return "样式表未生效";
    return null;
  });

  await add("桌面运行环境", "本地存储可用（localStorage 读写）", () => {
    const k = "__acceptance_probe__";
    localStorage.setItem(k, "ok");
    const v = localStorage.getItem(k);
    localStorage.removeItem(k);
    return v === "ok" ? null : "读写失败";
  });



  return out;
}

/** 当前运行环境：桌面版 / 浏览器预览 */
export function envLabel(): string {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return w.__TAURI_INTERNALS__ || w.__TAURI__ ? "Tauri 桌面版" : "浏览器预览（非交付环境）";
}

/** 每个验收分组的结论 */
export function groupSummary(items: SelfTestItem[]): { group: string; ok: boolean; total: number; pass: number }[] {
  const map = new Map<string, { total: number; pass: number }>();
  for (const it of items) {
    const g = it.group ?? "其他";
    const cur = map.get(g) ?? { total: 0, pass: 0 };
    cur.total++;
    if (it.ok) cur.pass++;
    map.set(g, cur);
  }
  return [...map.entries()].map(([group, v]) => ({ group, ok: v.pass === v.total, ...v }));
}

/**
 * 导出《项目交付验收单》—— 可直接作为项目交付依据
 */
export function acceptanceToText(items: SelfTestItem[], ranAt: string, seq?: number): string {
  const pass = items.filter((i) => i.ok).length;
  const allOk = pass === items.length && items.length > 0;
  const L: string[] = [];
  const line = "=".repeat(64);
  const thin = "-".repeat(64);

  L.push(line);
  L.push("            SerialMind 项目交付验收单");
  L.push(line);
  L.push("");
  L.push(`产品名称：${APP_NAME}`);
  L.push(`产品版本：${APP_VERSION}`);
  L.push(`验收时间：${ranAt}`);
  L.push(`运行环境：${envLabel()}`);
  L.push(`验收方式：整机自动验收（内置模拟设备，无需外部硬件）`);
  L.push(`验收结论：${allOk ? "通过（可作为交付依据）" : "未通过（请附本单反馈支持）"}`);
  L.push(`验收结果：${pass} / ${items.length} 项通过`);
  if (seq && seq > 0) L.push(`本次序号：第 ${seq} 次验收（本机记录）`);
  L.push("");
  L.push(thin);
  L.push("一、验收标准对照（对应《解决方案说明》第四章）");
  L.push(thin);
  L.push("");
  const groups = groupSummary(items);
  for (const g of groups) {
    L.push(`  [${g.ok ? "✓" : "✗"}] ${g.group} — ${g.pass}/${g.total} 项通过`);
  }
  const missing = ACCEPTANCE_GROUPS.filter((g) => !groups.some((x) => x.group === g));
  for (const g of missing) L.push(`  [ ] ${g} — 未覆盖`);
  L.push("");
  L.push(thin);
  L.push("二、检查明细");
  L.push(thin);
  L.push("");
  let lastGroup = "";
  for (const it of items) {
    if (it.group && it.group !== lastGroup) {
      lastGroup = it.group;
      L.push(`【${lastGroup}】`);
    }
    L.push(`  ${it.ok ? "[通过]" : "[失败]"} ${it.name}`);
    L.push(`           ${it.detail}（${it.ms}ms）`);
  }
  L.push("");
  L.push(thin);
  L.push("三、签字确认");
  L.push(thin);
  L.push("");
  L.push("  交付方：____________________    日期：________________");
  L.push("");
  L.push("  接收方：____________________    日期：________________");
  L.push("");
  L.push(line);
  L.push("本单由软件真实执行生成，不含任何演示数据。");
  L.push(allOk ? "结论：本次验收全部通过，软件可交付使用。" : "结论：本次验收存在未通过项，暂不具备交付条件。");
  L.push(line);
  return L.join("\n");
}
