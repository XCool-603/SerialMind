/**
 * 非 Modbus 的 PLC 协议验证：帧头 + 长度 + 命令 + 变长数据域 + 累加和
 * 运行： npx tsx scripts/test-plc.ts
 */
import { BINARY_PROTOCOL, CRANE_PROTOCOL } from "../src/engine/pdl";
import { FrameSplitter } from "../src/engine/framer";
import { decodeFrame, encodeMessage, roundTrip } from "../src/engine/codec";
import { parseHex, toHex } from "../src/engine/bytes";

let pass = 0;
let fail = 0;
const bad: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    bad.push(name);
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

const proto = BINARY_PROTOCOL;

// 构造一帧：AA 55 | len=0A | cmd=03 | data=01..05 | sum
const body = parseHex("AA 55 0A 03 01 02 03 04 05");
const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
const frame = [...body, sum];
console.log(`\n样例帧（${frame.length}B）：${toHex(frame)}`);

console.log("\n[1] 流式分帧：逐字节喂入");
{
  const sp = new FrameSplitter(() => proto);
  const got: number[][] = [];
  for (const b of frame) got.push(...sp.push([b]));
  check("切出 1 帧", got.length === 1, `实际 ${got.length}`);
  check("帧内容一致", toHex(got[0] ?? []) === toHex(frame), toHex(got[0] ?? []));
  check("缓冲已清空", sp.pending === 0);
}

console.log("\n[2] 噪声前缀要能丢掉");
{
  const sp = new FrameSplitter(() => proto);
  const got = sp.push([0x11, 0x22, 0x33, ...frame]);
  check("仍然切出 1 帧", got.length === 1);
  check("丢掉了 3 个垃圾字节", sp.dropped === 3, `dropped=${sp.dropped}`);
}

console.log("\n[3] 半帧要等待（不能提前吐）");
{
  const sp = new FrameSplitter(() => proto);
  const got = sp.push(frame.slice(0, 6));
  check("半帧不吐出", got.length === 0);
  const got2 = sp.push(frame.slice(6));
  check("补齐后吐出", got2.length === 1);
}

console.log("\n[4] 一包多帧要全部切出");
{
  const sp = new FrameSplitter(() => proto);
  const got = sp.push([...frame, ...frame, ...frame]);
  check("切出 3 帧", got.length === 3, `实际 ${got.length}`);
}

console.log("\n[5] 解码：帧头 / 长度 / 校验 / 变长数据域");
{
  const d = decodeFrame(proto, frame);
  check("帧头校验通过", d.headerOk, d.headerError ?? "");
  check("长度字段自洽", d.lengthOk, d.lengthError ?? "");
  check("累加和正确", d.crcOk, `期望 ${d.crcExpected} 实际 ${d.crcActual}`);
  const data = d.fields.find((f) => f.field.name === "data");
  check("数据域按 len-5 解出 5 字节", data?.raw.length === 5, `实际 ${data?.raw.length}`);
  const cmd = d.fields.find((f) => f.field.name === "cmd");
  check("命令字解出 03 状态上报", String(cmd?.display).includes("状态上报"), String(cmd?.display));
}

console.log("\n[6] 组包与 round-trip");
{
  const rebuilt = encodeMessage(proto, proto.messages[0], { header: 0xaa55, len: frame.length, cmd: 3 });
  check("组包长度 = 声明长度", rebuilt.length === frame.length, `${rebuilt.length} vs ${frame.length}`);
  check("组包帧头正确", toHex(rebuilt.slice(0, 2)) === "AA 55", toHex(rebuilt.slice(0, 2)));
  const rt = roundTrip(proto, frame);
  check("样例帧 round-trip 逐字节一致", rt.ok, rt.ok ? "" : `${rt.diffIndexes.length} 字节差异`);
}

console.log("\n[7] 坏帧必须被识别");
{
  const broken = frame.slice();
  broken[0] = 0xab; // 破坏帧头
  const d1 = decodeFrame(proto, broken);
  check("帧头错 → headerOk=false", !d1.headerOk, d1.headerError ?? "");

  const badSum = frame.slice();
  badSum[badSum.length - 1] ^= 0xff;
  const d2 = decodeFrame(proto, badSum);
  check("校验错 → crcOk=false", !d2.crcOk);

  const badLen = frame.slice();
  badLen[2] = 0x0c; // 声明 12 字节
  const d3 = decodeFrame(proto, badLen);
  check("长度不符 → lengthOk=false", !d3.lengthOk, d3.lengthError ?? "");
}

console.log("\n[8] 回归：Modbus 协议仍然可用");
{
  const req = parseHex("01 03 00 00 00 0A C5 CD");
  const d = decodeFrame(CRANE_PROTOCOL, req);
  check("Modbus 请求帧 CRC 正确", d.crcOk);
  check("Modbus 解出 addr=1", Number(d.fields.find((f) => f.field.name === "addr")?.value) === 1);
  const rt = roundTrip(CRANE_PROTOCOL, req);
  check("Modbus round-trip 一致", rt.ok);
}

console.log(`\n${"=".repeat(52)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log("失败项：" + bad.join(", "));
  process.exit(1);
}
console.log("非 Modbus 的 PLC 协议已可用 ✅");
