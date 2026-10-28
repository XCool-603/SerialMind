/**
 * 控制流测试：if / else / while / setVar / break / continue 必须真跑
 * 运行： npx tsx scripts/test-controlflow.ts
 */
import { runCase } from "../src/engine/runner";
import { encodeMessage, decodeFrame } from "../src/engine/codec";
import { CRANE_PROTOCOL } from "../src/engine/pdl";
import { toHex } from "../src/engine/bytes";
import type { CaseItem, CaseStep, Frame, Source } from "../src/engine/types";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
};

const proto = CRANE_PROTOCOL;

/** 模拟设备：回 position=3000 */
function makeHost(opts: { position?: number; reply?: boolean } = {}) {
  const frames: Frame[] = [];
  let id = 1;
  const host = {
    getProtocol: () => proto,
    getFrames: () => frames,
    pushFrame: (f: Omit<Frame, "id" | "time" | "ts" | "no">) => {
      frames.push({ id: id++, time: "00:00:00.000", ts: Date.now(), no: id, ...f } as Frame);
    },
    write: async () => {
      if (opts.reply === false) return;
      const msg = proto.messages.find((m) => m.id === "read_resp")!;
      const bytes = encodeMessage(proto, msg, { addr: 1, func: 3, byte_count: 2, position: opts.position ?? 3000 });
      const d = decodeFrame(proto, bytes);
      host.pushFrame({
        dir: "rx",
        source: "device" as Source,
        bytes,
        crcOk: d.crcOk,
        fields: d.fields,
        crcExpected: d.crcExpected,
        crcActual: d.crcActual,
      });
    },
    isLinkOpen: () => true,
  };
  return host;
}

let n = 0;
const sid = () => `s${++n}`;
const send: CaseStep = () => ({ id: sid(), kind: "send", text: "send", detail: toHex(encodeMessage(proto, proto.messages.find((m) => m.id === "read_req")!, {})) }) as CaseStep;
const sendStep = (): CaseStep => ({ id: sid(), kind: "send", text: "send", detail: toHex(encodeMessage(proto, proto.messages.find((m) => m.id === "read_req")!, {})) });
const expectStep = (field: string, op: string, timeout = "within 1s"): CaseStep => ({
  id: sid(),
  kind: "expect",
  text: "expect",
  detail: "field",
  fields: [{ label: field, value: op }],
  timeout,
});
const setVar = (name: string, expr: string): CaseStep => ({
  id: sid(),
  kind: "setVar",
  text: "setVar",
  detail: name,
  fields: [{ label: name, value: `= ${expr}` }],
});

function makeCase(steps: CaseStep[], extra: Partial<CaseItem> = {}): CaseItem {
  return {
    id: "cf",
    subProductId: "sp",
    name: "控制流用例",
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

console.log("\n[1] if / else 分支");
{
  // position=3000 > 100 成立 → 走 then（send + expect 通过）
  const c = makeCase([
    sendStep(), // 先收一帧，if 才能读到 position
    {
      id: sid(),
      kind: "if",
      text: "if",
      cond: "position > 100",
      children: [sendStep(), expectStep("position", "equals 3000")],
      elseChildren: [expectStep("position", "equals 1", "within 200ms")],
    },
  ]);
  const r = await runCase(makeHost({ position: 3000 }), c, "cf");
  ok("条件成立走 then", r.status === "pass", r.reason ?? "");
  ok("then 里的步骤真执行了", r.items.some((i) => i.kind === "expect" && i.status === "pass"));
}
{
  // position=50 不满足 > 100 → 走 else
  const c = makeCase([
    sendStep(),
    {
      id: sid(),
      kind: "if",
      text: "if",
      cond: "position > 100",
      children: [expectStep("position", "equals 999", "within 200ms")],
      elseChildren: [sendStep(), expectStep("position", "equals 50")],
    },
  ]);
  const r = await runCase(makeHost({ position: 50 }), c, "cf");
  ok("条件不成立走 else", r.status === "pass", r.reason ?? "");
}
{
  // else 分支里断言失败 → 整体失败
  const c = makeCase([
    {
      id: sid(),
      kind: "if",
      text: "if",
      cond: "position > 100",
      children: [sendStep()],
      elseChildren: [sendStep(), expectStep("position", "equals 123456", "within 200ms")],
    },
  ]);
  const r = await runCase(makeHost({ position: 50 }), c, "cf");
  ok("else 里失败会判失败", r.status === "fail", r.status);
}

console.log("\n[2] setVar 变量运算");
{
  const c = makeCase([setVar("score", "1"), setVar("score", "score + 1"), setVar("score", "score * 10")]);
  const r = await runCase(makeHost(), c, "cf");
  ok("变量赋值可执行", r.status === "pass", r.reason ?? "");
  ok("score 依次算出 1 → 2 → 20", r.items.filter((i) => i.kind === "setVar").map((i) => i.actual).join(" | ").includes("20"), r.items.map((i) => i.actual).join(" | "));
}

console.log("\n[3] while 循环 + break");
{
  // 循环 3 次后条件不成立
  const c = makeCase([
    setVar("score", "0"),
    {
      id: sid(),
      kind: "while",
      text: "while",
      cond: "score < 3",
      timeout: "max 10",
      children: [setVar("score", "score + 1")],
    },
  ]);
  const r = await runCase(makeHost(), c, "cf");
  ok("while 正常结束", r.status === "pass", r.reason ?? "");
  const whileItem = r.items.find((i) => i.kind === "while");
  ok("循环执行了 3 次", /执行 3 次/.test(whileItem?.actual ?? ""), whileItem?.actual);
}
{
  // while 无限条件，靠 break 跳出
  const c = makeCase([
    setVar("score", "0"),
    {
      id: sid(),
      kind: "while",
      text: "while",
      cond: "score < 100",
      timeout: "max 50",
      children: [setVar("score", "score + 1"), { id: sid(), kind: "if", text: "if", cond: "score >= 2", children: [{ id: sid(), kind: "break", text: "break" }] }],
    },
  ]);
  const r = await runCase(makeHost(), c, "cf");
  ok("break 能跳出 while", r.status === "pass", r.reason ?? "");
  const whileItem = r.items.find((i) => i.kind === "while");
  ok("只跑了 2 次就跳出", /执行 2 次/.test(whileItem?.actual ?? ""), whileItem?.actual);
}
{
  // max 上限保护
  const c = makeCase([
    setVar("score", "0"),
    {
      id: sid(),
      kind: "while",
      text: "while",
      cond: "score < 1000",
      timeout: "max 5",
      children: [setVar("score", "score + 1")],
    },
  ]);
  const r = await runCase(makeHost(), c, "cf");
  const whileItem = r.items.find((i) => i.kind === "while");
  ok("到达上限会停（不会跑飞）", /执行 5 次/.test(whileItem?.actual ?? ""), whileItem?.actual);
}

console.log("\n[4] 嵌套 if 在 while 里");
{
  const c = makeCase([
    setVar("score", "0"),
    {
      id: sid(),
      kind: "while",
      text: "while",
      cond: "score < 3",
      timeout: "max 10",
      children: [
        setVar("score", "score + 1"),
        {
          id: sid(),
          kind: "if",
          text: "if",
          cond: "score == 2",
          children: [sendStep(), expectStep("position", "equals 3000")],
        },
      ],
    },
  ]);
  const r = await runCase(makeHost({ position: 3000 }), c, "cf");
  ok("嵌套 if 正常", r.status === "pass", r.reason ?? "");
  const expects = r.items.filter((i) => i.kind === "expect");
  ok("只有 score==2 那轮发了断言", expects.length === 1, `${expects.length} 次`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
