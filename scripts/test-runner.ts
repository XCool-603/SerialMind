/**
 * 测试执行引擎的真实测试（不需要硬件）
 * 用注入的假宿主模拟"设备回包"，验证：
 *  1) set 步骤真的组包并发送
 *  2) expect 步骤真的等到回包并断言通过
 *  3) assertNo 能抓到 CRC 错
 *  4) 链路未连接时 expect 必须超时失败（不能假装通过）
 *  5) 步骤失败后用例立即失败（失败即停）
 *
 * 运行： npx tsx scripts/test-runner.ts
 */
import { runCase, runSuite, parseOp, evalOp, parseTimeout } from "../src/engine/runner";
import { CRANE_PROTOCOL } from "../src/engine/pdl";
import { encodeMessage, decodeFrame } from "../src/engine/codec";
import { toHex } from "../src/engine/bytes";
import type { CaseItem, Frame, Source } from "../src/engine/types";

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

/** 假宿主：可控的帧列表 + 可选自动回包 */
function makeHost(opts: { linkOpen: boolean; autoReply?: boolean; badCrc?: boolean }) {
  const frames: Frame[] = [];
  let id = 1;
  const written: number[][] = [];
  const proto = CRANE_PROTOCOL;

  const host = {
    getProtocol: () => proto,
    getFrames: () => frames,
    pushFrame: (f: Omit<Frame, "id" | "time" | "ts" | "no">) => {
      frames.push({ id: id++, time: "00:00:00.000", ts: Date.now(), no: id, ...f } as Frame);
    },
    write: async (bytes: number[]) => {
      written.push(bytes);
      if (!opts.autoReply) return;
      // 模拟设备：收到读请求后回一帧 position=3000
      const msg = proto.messages.find((m) => m.id === "read_resp")!;
      const resp = encodeMessage(proto, msg, { addr: 1, func: 3, byte_count: 2, position: 3000 });
      if (opts.badCrc) resp[resp.length - 1] ^= 0xff;
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
    isLinkOpen: () => opts.linkOpen,
  };
  return { host, frames, written };
}

function makeCase(steps: CaseItem["steps"]): CaseItem {
  return {
    id: "case-test",
    productId: "p",
    name: "引擎测试用例",
    link: "ch1",
    tags: [],
    status: "never",
    statusText: "",
    stepCount: steps.length,
    assertionCount: 0,
    steps,
    yaml: "",
  };
}

async function main() {
  console.log("\n[1] 断言解析与求值");
  check("equals 3000", (() => { const o = parseOp("equals 3000"); return !!o && evalOp(3000, o) && !evalOp(2999, o); })());
  check("range 1000..4000", (() => { const o = parseOp("range 1000..4000"); return !!o && evalOp(2000, o) && !evalOp(5000, o); })());
  check("in 1,3,5", (() => { const o = parseOp("in 1,3,5"); return !!o && evalOp(5, o) && !evalOp(2, o); })());
  check("超时解析 within 3s → 3000ms", parseTimeout("within 3s") === 3000);
  check("超时解析 200ms → 200ms", parseTimeout("200ms") === 200);

  console.log("\n[2] 全部通过：set → expect → assertNo → delay");
  {
    const { host, written } = makeHost({ linkOpen: true, autoReply: true });
    const c = makeCase([
      { id: "s1", kind: "set", text: "set", fields: [{ label: "target_point", value: "= 3" }] },
      { id: "s2", kind: "expect", text: "expect", fields: [{ label: "position", value: "equals 3000" }], timeout: "500ms" },
      { id: "s3", kind: "assertNo", text: "assertNo", fields: [{ label: "crc_error", value: "" }] },
      { id: "s4", kind: "delay", text: "delay", detail: "20ms" },
    ]);
    const r = await runCase(host, c, "test");
    check("用例整体通过", r.status === "pass", r.reason ?? "");
    check("set 步骤真的发出了字节", written.length >= 1 && written[0].length > 0, `写串口 ${written.length} 次`);
    check("expect 步骤拿到实际值", r.items[1]?.status === "pass" && (r.items[1]?.actual ?? "").includes("3000"), r.items[1]?.actual ?? "");
    check("assertNo 步骤通过", r.items[2]?.status === "pass");
    check("delay 步骤通过", r.items[3]?.status === "pass");
    check("结果含耗时", r.durationMs >= 0);
  }

  console.log("\n[3] 断言不满足必须失败（不能假装通过）");
  {
    const { host } = makeHost({ linkOpen: true, autoReply: true });
    const c = makeCase([
      { id: "s1", kind: "expect", text: "expect", fields: [{ label: "position", value: "equals 9999" }], timeout: "200ms" },
    ]);
    const r = await runCase(host, c, "test");
    check("用例失败", r.status === "fail");
    check("失败原因记录期望与实际", (r.reason ?? "").includes("9999"), r.reason ?? "");
    check("耗时约等于超时时间", r.durationMs >= 180, `${r.durationMs}ms`);
  }

  console.log("\n[4] 链路未连接：expect 必须超时并说明原因");
  {
    const { host } = makeHost({ linkOpen: false, autoReply: false });
    const c = makeCase([
      { id: "s1", kind: "expect", text: "expect", fields: [{ label: "position", value: "equals 3000" }], timeout: "150ms" },
    ]);
    const r = await runCase(host, c, "test");
    check("用例失败", r.status === "fail");
    check("原因指出串口未连接", (r.items[0]?.actual ?? "").includes("串口未连接"), r.items[0]?.actual ?? "");
  }

  console.log("\n[5] CRC 错帧必须被 assertNo 抓到");
  {
    const { host } = makeHost({ linkOpen: true, autoReply: true, badCrc: true });
    const c = makeCase([
      { id: "s1", kind: "send", text: "send", detail: "01 03 00 00 00 0A C5 CD" },
      { id: "s2", kind: "delay", text: "delay", detail: "30ms" },
      { id: "s3", kind: "assertNo", text: "assertNo", fields: [{ label: "crc_error", value: "" }] },
    ]);
    const r = await runCase(host, c, "test");
    check("assertNo 判定失败", r.status === "fail", r.reason ?? "");
    check("原因提到 CRC", (r.reason ?? "").includes("CRC"), r.reason ?? "");
  }

  console.log("\n[6] 失败即停：后续步骤不再执行");
  {
    const { host, written } = makeHost({ linkOpen: false });
    const c = makeCase([
      { id: "s1", kind: "expect", text: "expect", fields: [{ label: "position", value: "equals 3000" }], timeout: "100ms" },
      { id: "s2", kind: "set", text: "set", fields: [{ label: "target_point", value: "= 5" }] },
    ]);
    const r = await runCase(host, c, "test");
    check("只执行了 1 步", r.items.length === 1, `实际 ${r.items.length} 步`);
    check("第二步没有发送", written.length === 0);
  }

  console.log("\n[7] 套件执行：逐条产出结果");
  {
    const { host } = makeHost({ linkOpen: true, autoReply: true });
    const c1 = makeCase([
      { id: "a0", kind: "send", text: "send", detail: "01 03 00 00 00 0A C5 CD" },
      { id: "a", kind: "expect", text: "expect", fields: [{ label: "position", value: "equals 3000" }], timeout: "300ms" },
    ]);
    const c2 = { ...makeCase([{ id: "b", kind: "expect", text: "expect", fields: [{ label: "position", value: "equals 1" }], timeout: "100ms" }]), id: "case-2", name: "第二条" };
    const results = await runSuite(host, [c1, c2], "全量回归");
    check("产出 2 条结果", results.length === 2);
    check("第一条通过", results[0].status === "pass");
    check("第二条失败", results[1].status === "fail");
    check("结果带套件名", results[0].suite === "全量回归");
  }

  console.log("\n[8] 空用例必须失败而不是假通过");
  {
    const { host } = makeHost({ linkOpen: true });
    const r = await runCase(host, makeCase([]), "test");
    check("空用例失败", r.status === "fail");
    check("原因说明没有步骤", (r.reason ?? "").includes("没有步骤"), r.reason ?? "");
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log("失败项：");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
  console.log("全部通过 ✅");
}

void main();
