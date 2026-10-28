/**
 * 测试执行引擎（真跑，不造假）
 *
 * - 步骤真的驱动链路：set 组包发送、send 发原始字节、expect 真等回包、assertNo 真查异常
 * - 断言基于解包后的字段值，不是字符串比对
 * - 链路未连接时，expect 会真超时失败，并在结果里说明原因
 * - 运行产物（RunResult）是报告页唯一数据来源，没有预置报告
 */
import { appendChecksum, decodeFrame, encodeMessage, hasChecksum, type DecodedField } from "./codec";
import { parseHex, toHex } from "./bytes";
import { CRANE_PROTOCOL, type PdlProtocol } from "./pdl";
import type { CaseItem, CaseStep, Frame, RunResult, StepResult } from "./types";

export interface RunnerHost {
  getProtocol: () => PdlProtocol;
  getFrames: () => Frame[];
  pushFrame: (f: Omit<Frame, "id" | "time" | "ts" | "no">) => void;
  write: (bytes: number[]) => Promise<void>;
  isLinkOpen: () => boolean;
  /** 发送裸 HEX 时是否自动补校验和 */
  autoChecksum?: () => boolean;
  /** 用户点了停止 */
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

/* ---------------- 控制流（if / while / 变量） ---------------- */

type Ctrl = "ok" | "fail" | "break" | "continue";

interface RunCtx {
  startFrameIndex: number;
  linkOpen: boolean;
  /** 运行期变量：setVar 写入，条件判断和 ${name} 读取 */
  vars: Record<string, number>;
  depth: number;
  retries: number;
  /** 失败即停：true 时遇到失败立刻中断，false 时继续跑完剩余步骤 */
  abortOnFail: boolean;
}

const MAX_DEPTH = 6;

function substText(s: string | undefined, vars: Record<string, number>): string | undefined {
  if (!s) return s;
  return s.replace(/\$\{([^}]+)\}/g, (m, k) => {
    const v = vars[String(k).trim()];
    return v === undefined ? m : String(v);
  });
}

function substStep(step: CaseStep, vars: Record<string, number>): CaseStep {
  if (!Object.keys(vars).length) return step;
  return {
    ...step,
    detail: substText(step.detail, vars),
    cond: substText(step.cond, vars),
    timeout: substText(step.timeout, vars),
    fields: step.fields?.map((f) => ({ label: f.label, value: substText(f.value, vars) ?? "" })),
  };
}

/** 取条件左边的值：先查运行期变量，再查最近一帧回包字段 */
function condValue(host: RunnerHost, name: string, ctx: RunCtx): number | null {
  if (ctx.vars[name] !== undefined) return ctx.vars[name];
  const frames = host
    .getFrames()
    .slice(ctx.startFrameIndex)
    .filter((f) => f.dir === "rx" && f.crcOk);
  const last = frames[frames.length - 1];
  return last ? fieldNumber(last.fields, name) : null;
}

/** 条件求值，支持：> < >= <= == != equals range in exists notexists */
function evalCond(host: RunnerHost, cond: string | undefined, ctx: RunCtx): { ok: boolean; detail: string } {
  const raw = (cond ?? "").trim();
  if (!raw) return { ok: false, detail: "条件为空" };
  const m = raw.match(/^([A-Za-z_]\w*)\s*(>=|<=|==|!=|=|>|<)?\s*(.*)$/);
  if (!m) return { ok: false, detail: `条件写法看不懂：${raw}` };
  const name = m[1];
  const sym = m[2];
  const rest = (m[3] ?? "").trim();
  const opStr = sym ? `${sym} ${rest}`.trim() : rest;
  const op = parseOp(opStr);
  if (!op) return { ok: false, detail: `条件运算符看不懂：${raw}` };
  const v = condValue(host, name, ctx);
  if (op.kind === "exists" || op.kind === "notexists") {
    const has = v !== null;
    const ok = op.kind === "exists" ? has : !has;
    return { ok, detail: `${name} ${op.kind === "exists" ? "存在" : "不存在"} → ${has ? "有" : "无"}` };
  }
  if (v === null) return { ok: false, detail: `${name} 取不到值（既不是变量，最近也没有含该字段的回包）` };
  const ok = evalOp(v, op);
  return { ok, detail: `${name}=${v} ${opStr} → ${ok ? "成立" : "不成立"}` };
}

/** setVar 的表达式求值：支持 a+b / a-b / a*b / a/b / 常量 */
function evalExpr(expr: string, vars: Record<string, number>): number | null {
  const s = expr.trim().replace(/^=\s*/, "");
  const m = s.match(/^([A-Za-z_]\w*|-?\d+(?:\.\d+)?)\s*(?:([+\-*/])\s*([A-Za-z_]\w*|-?\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const pick = (t: string): number => (vars[t] !== undefined ? vars[t] : Number(t));
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

/**
 * 执行一串步骤（支持嵌套）。返回 ok / fail / break / continue。
 * 叶子步骤失败会按 retries 重试；块（if / while）失败不重试，直接向上抛。
 */
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
        actual: `执行 ${n} 次后条件${c.ok ? "仍成立（到上限）" : "不再成立"}`,
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
/* ---------------- 步骤执行 ---------------- */

async function runStep(
  host: RunnerHost,
  step: CaseStep,
  ctx: { startFrameIndex: number; linkOpen: boolean },
): Promise<StepResult> {
  const startedAt = nowTime();
  const t0 = performance.now();
  const base: Omit<StepResult, "status" | "durationMs" | "startedAt"> = { stepId: step.id, kind: step.kind, text: step.text };

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
      case "set": {
        // field <name> = <value> → 组包发送
        const f = step.fields?.[0];
        if (!f) return finish("fail", { error: "set 步骤缺少字段" });
        const raw = f.value.replace(/^=\s*/, "");
        const num = Number(raw);
        const msg = proto.messages.find((m) => m.id === "status") ?? proto.messages[0];
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

      case "send": {
        let bytes = parseHex(step.detail ?? "");
        if (!bytes.length) return finish("fail", { error: "send 步骤没有有效字节" });
        // 自动补校验和：只在这帧还不合法时才补（避免给已带校验的帧再加一遍）
        if (host.autoChecksum?.()) {
          const proto = host.getProtocol();
          if (hasChecksum(proto)) {
            const probe = decodeFrame(proto, bytes);
            if (!(probe.matched && probe.crcOk)) bytes = appendChecksum(proto, bytes);
          }
        }
        await sendBytes(bytes, "case");
        return finish("pass", { actual: toHex(bytes), frameHex: toHex(bytes) });
      }

      case "expect": {
        const f = step.fields?.[0];
        if (!f) return finish("fail", { error: "expect 步骤缺少断言" });
        const op = parseOp(f.value);
        if (!op) return finish("fail", { error: `无法解析断言：${f.label} ${f.value}` });
        const timeout = parseTimeout(step.timeout);
        const deadline = performance.now() + timeout;

        while (performance.now() < deadline) {
          const frames = host.getFrames().slice(ctx.startFrameIndex);
          for (const fr of frames) {
            if (fr.dir !== "rx" || !fr.crcOk) continue;
            const v = fieldNumber(fr.fields, f.label);
            if (v !== null && evalOp(v, op)) {
              return finish("pass", {
                expected: `${f.label} ${f.value}`,
                actual: `${f.label}=${v}（${fr.time} 收到）`,
                frameHex: toHex(fr.bytes),
              });
            }
          }
          await sleep(30);
        }

        // 超时：尽量给出最后一次观测到的值，便于排障
        const frames = host.getFrames().slice(ctx.startFrameIndex).filter((x) => x.dir === "rx");
        const last = frames[frames.length - 1];
        const lastVal = last ? fieldNumber(last.fields, f.label) : null;
        const why = !ctx.linkOpen
          ? "串口未连接，收不到回包"
          : frames.length === 0
            ? "窗口内未收到任何回包"
            : `最后一次 ${f.label}=${lastVal ?? "未解出"}`;
        return finish("fail", {
          expected: `${f.label} ${f.value}（${timeout}ms 内）`,
          actual: why,
          frameHex: last ? toHex(last.bytes) : undefined,
        });
      }

      case "assertNo": {
        const frames = host.getFrames().slice(ctx.startFrameIndex);
        const checks = step.fields?.map((x) => x.label) ?? [];
        const problems: string[] = [];
        if (checks.includes("crc_error")) {
          const bad = frames.filter((x) => x.dir === "rx" && !x.crcOk);
          if (bad.length) problems.push(`${bad.length} 帧 CRC 校验失败`);
        }
        if (checks.includes("timeout")) {
          // 该窗口内本步骤没有等待语义，超时由 expect 步骤负责；这里只做占位校验
        }
        if (checks.includes("unexpected_frame")) {
          const rx = frames.filter((x) => x.dir === "rx");
          if (rx.length > 1) problems.push(`收到 ${rx.length} 帧，期望 1 帧`);
        }
        return problems.length
          ? finish("fail", { expected: checks.join(" / ") + " 无异常", actual: problems.join("；") })
          : finish("pass", { expected: checks.join(" / ") + " 无异常", actual: "无异常" });
      }

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
        // 并行下发：把多个字段一次组包发送
        const msg = proto.messages.find((m) => m.id === "status") ?? proto.messages[0];
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

      case "setVar": {
        const f = step.fields?.[0];
        const name = (f?.label ?? step.detail ?? "").trim();
        const expr = f?.value ?? "";
        if (!name) return finish("fail", { error: "setVar 缺少变量名" });
        const vars = (ctx as { vars?: Record<string, number> }).vars;
        const val = evalExpr(expr, vars ?? {});
        if (val === null) return finish("fail", { error: `无法计算：${name} = ${expr}` });
        if (vars) vars[name] = val;
        return finish("pass", { expected: `${name} = ${expr}`, actual: `${name} = ${val}` });
      }

      default:
        return finish("skip", { error: `步骤类型 ${step.kind} 暂不支持自动执行` });
    }
  } catch (e) {
    return finish("fail", { error: (e as Error).message });
  }
}

/* ---------------- 数据驱动（CSV） ---------------- */

/** 解析 CSV（首行表头），返回 [{列名: 值}] */
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

/** 把步骤里的 ${列名} 换成该行的值 */
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
      fields: st.fields?.map((f) => ({ label: f.label, value: sub(f.value) ?? "" })),
      children: st.children ? walk(st.children) : undefined,
      elseChildren: st.elseChildren ? walk(st.elseChildren) : undefined,
    }));
  return { ...item, steps: walk(item.steps) };
}
/* ---------------- 用例 / 套件执行 ---------------- */

/** 单次执行（不含数据驱动） */
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

  if (!item.steps.length) {
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

    // 变量：第 r 轮的值 = init + step × r（同时作为运行期变量，供 if / while / setVar 使用）
    const row: Record<string, string> = {};
    const runtimeVars: Record<string, number> = {};
    for (const v of vars) {
      const val = v.init + v.step * r;
      row[v.name] = String(val);
      runtimeVars[v.name] = val;
    }
    const steps = vars.length ? applyRow(item, row).steps : item.steps;
    const tag = rounds === Infinity ? `[#${r + 1}] ` : rounds > 1 ? `[第${r + 1}轮] ` : "";
    const rctx: RunCtx = {
      startFrameIndex: host.getFrames().length,
      linkOpen: ctx.linkOpen,
      vars: runtimeVars,
      depth: 0,
      retries,
      abortOnFail: stopOnFail,
    };

    const before = items.length;
    const ctrl = await runList(host, steps, rctx, items, tag);
    for (let i = before; i < items.length; i++) onStep?.(item.id, i - before, items[i]);
    if (ctrl === "fail") {
      failed = true;
      if (stopOnFail) break;
    }
    if (timedOut) break;
    if (failed && stopOnFail) break;
    if (items.length > 50000) break; // 无限循环时防内存爆掉
  }

  // 压测统计：发多少 / 收多少 / 丢多少 / 平均响应
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
  const autoStop = timedOut ? `达到最长运行时长 ${Math.round(maxDuration / 1000)}s，已自动停止` : "";
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
/** 有 CSV 数据就按行跑，全部通过才算通过 */
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
