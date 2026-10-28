/**
 * 无限循环自动停止 / 失败即停 的真实测试（无需硬件）
 *
 * 验证：
 *  1) repeat=0（无限循环）+ maxDurationMs → 到点自己停，reason 带说明
 *  2) maxDurationMs=0 → 不会自己停（靠 repeat 收尾）
 *  3) stopOnFail=true（默认）→ 第一次失败就停
 *  4) stopOnFail=false → 失败后继续跑完剩余轮次，最后整体判失败
 *
 * 运行： npx tsx scripts/test-autostop.ts
 */
import { runCase } from "../src/engine/runner";
import { CRANE_PROTOCOL } from "../src/engine/pdl";
import { encodeMessage, decodeFrame } from "../src/engine/codec";
import type { CaseItem, CaseStep, Frame, Source } from "../src/engine/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

/** 假宿主：收到读请求就回一帧（可选故意回错，用于制造失败） */
function makeHost(opts: { autoReply: boolean; badReply?: boolean }) {
  const frames: Frame[] = [];
  let id = 1;
  const proto = CRANE_PROTOCOL;
  const host = {
    getProtocol: () => proto,
    getFrames: () => frames,
    pushFrame: (f: Omit<Frame, "id" | "time" | "ts" | "no">) => {
      frames.push({ id: id++, time: "00:00:00.000", ts: Date.now(), no: id, ...f } as Frame);
    },
    write: async (bytes: number[]) => {
      if (!opts.autoReply) return;
      const msg = proto.messages.find((m) => m.id === "read_resp")!;
      const resp = encodeMessage(proto, msg, { addr: 1, func: 3, byte_count: 2, position: opts.badReply ? 999 : 3000 });
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
  return { host, frames };
}

function makeCase(steps: CaseStep[], extra: Partial<CaseItem> = {}): CaseItem {
  return {
    id: "case-autostop",
    subProductId: "sp",
    name: "自动停止测试",
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

const delay = (ms: string): CaseStep => ({ id: `d${Math.random().toString(16).slice(2, 8)}`, kind: "delay", text: "等待", detail: ms });

console.log("\n[1] 无限循环 + 最长运行时长 → 到点自动停");
{
  const { host } = makeHost({ autoReply: true });
  const c = makeCase([delay("50ms")], { repeat: 0, intervalMs: 20, maxDurationMs: 900 });
  const t0 = Date.now();
  const r = await runCase(host, c, "自动停止");
  const elapsed = Date.now() - t0;
  check("在 1.6s 内自己停了（没跑飞）", elapsed < 1600, `实际 ${elapsed}ms`);
  check("用时接近设定值（0.7s~1.6s）", elapsed >= 700, `实际 ${elapsed}ms`);
  check("reason 说明是超时自动停", /最长运行时长/.test(r.reason ?? ""), r.reason ?? "(空)");
  check("跑过的轮次 > 3", r.items.length > 3, `${r.items.length} 步`);
}

console.log("\n[2] maxDurationMs = 0 → 不自动停，按 repeat 收尾");
{
  const { host } = makeHost({ autoReply: true });
  const c = makeCase([delay("10ms")], { repeat: 3, intervalMs: 0, maxDurationMs: 0 });
  const r = await runCase(host, c, "按次数");
  check("跑满 3 轮", r.items.length === 3, `${r.items.length} 步`);
  check("没有超时说明", !/最长运行时长/.test(r.reason ?? ""), r.reason ?? "(空)");
  check("状态通过", r.status === "pass", r.status);
}

console.log("\n[3] stopOnFail = true（默认）→ 第一次失败就停");
{
  const { host } = makeHost({ autoReply: true, badReply: true });
  const c = makeCase(
    [
      { id: "e1", kind: "expect", text: "位置 = 3000", detail: "position equals 3000" },
      delay("10ms"),
      delay("10ms"),
    ],
    { repeat: 3, intervalMs: 0, retries: 0 },
  );
  const r = await runCase(host, c, "失败即停");
  check("状态失败", r.status === "fail", r.status);
  check("只执行了 1 步就停", r.items.length === 1, `${r.items.length} 步`);
}

console.log("\n[4] stopOnFail = false → 失败也跑完，最后整体判失败");
{
  const { host } = makeHost({ autoReply: true, badReply: true });
  const c = makeCase(
    [
      { id: "e1", kind: "expect", text: "位置 = 3000", detail: "position equals 3000" },
      delay("10ms"),
      delay("10ms"),
    ],
    { repeat: 3, intervalMs: 0, retries: 0, stopOnFail: false },
  );
  const r = await runCase(host, c, "跑完再判");
  check("状态仍然失败", r.status === "fail", r.status);
  check("3 轮都跑了（9 步）", r.items.length === 9, `${r.items.length} 步`);
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (failures.length) {
  console.log("\n失败项：");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("无限循环自动停止 / 失败即停 都正确 ✅");
