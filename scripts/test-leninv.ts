/**
 * 用户协议验证：header | len(十六进制) | len反码(FF-len) | data(变长) | sum
 * 运行： npx tsx scripts/test-leninv.ts
 */
import { type PdlField, type PdlProtocol, messageLength } from "../src/engine/pdl";
import { decodeFrame, encodeMessage, roundTrip, resolveLayout } from "../src/engine/codec";
import { parseHex, toHex } from "../src/engine/bytes";
import { evalExpr } from "../src/engine/expr";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

const fields: PdlField[] = [
  { id: "header", name: "header", type: "bytes", size: 2, offset: 0, hex: "DE 21", desc: "帧头（随便写）" },
  { id: "len", name: "len", type: "uint", size: 1, offset: 2, value: 0, valueFormat: "hex", auto: "frameLength", desc: "长度（自动）" },
  { id: "lenInv", name: "lenInv", type: "uint", size: 1, offset: 3, value: 0, valueExpr: "0xFF - len", desc: "长度反码 FF-len" },
  { id: "data", name: "data", type: "bytes", size: 5, offset: 4, desc: "数据域" },
  { id: "sum", name: "sum", type: "crc", size: 1, offset: 0, offsetExpr: "len - 1", desc: "累加和" },
];

const proto: PdlProtocol = {
  id: "p-leninv",
  name: "带长度反码的协议",
  version: "v1",
  framing: { mode: "length-field", gapMs: 20, prefix: "DE 21", lengthField: { offset: 0, size: 1, includesHeader: true } },
  checksum: { algorithm: "SUM8", from: 0, to: "len-1", endian: "big" },
  messages: [{ id: "frame", name: "报文", fields }],
  sampleFrame: "",
  updatedAt: "—",
};

console.log("\n[1] 表达式：FF - len");
{
  check("0xFF - 10 = 245 (F5)", evalExpr("0xFF - len", { len: 10 }) === 245);
  check("0xFF - 8 = 247 (F7)", evalExpr("0xFF - len", { len: 8 }) === 247);
}

console.log("\n[2] 组包：len 按十六进制写，反码自动算");
{
  const bytes = encodeMessage(proto, proto.messages[0], { len: 0x0a });
  console.log(`     帧：${toHex(bytes)}（${bytes.length}B）`);
  check("帧头 DE 21", toHex(bytes.slice(0, 2)) === "DE 21", toHex(bytes.slice(0, 2)));
  check("len 写成 0A", toHex(bytes.slice(2, 3)) === "0A", toHex(bytes.slice(2, 3)));
  check("反码自动算成 F5", toHex(bytes.slice(3, 4)) === "F5", toHex(bytes.slice(3, 4)));
  check("总长 = 10（头2+长1+反码1+数据5+校验1）", bytes.length === 10, String(bytes.length));
  check("data 域 5 字节", resolveLayout(proto.messages[0], 10).find((l) => l.field.id === "data")?.size === 5);
  const sum = bytes[bytes.length - 1];
  const calc = bytes.slice(0, -1).reduce((a, b) => (a + b) & 0xff, 0);
  check("sum 正确", sum === calc, `帧内 ${sum} 期望 ${calc}`);
}

console.log("\n[3] 解码：反码校验");
{
  const frame = encodeMessage(proto, proto.messages[0], {});
  const d = decodeFrame(proto, frame);
  const lenF = d.fields.find((f) => f.field.name === "len");
  const invF = d.fields.find((f) => f.field.name === "lenInv");
  check("len 显示成 0A", lenF?.display === "0A", String(lenF?.display));
  check("反码显示 F5 且校验通过", String(invF?.display).startsWith("F5") && invF?.ok === true, String(invF?.display));
  check("整帧 CRC 通过", d.crcOk);

  // 故意把反码写错
  const bad = frame.slice();
  bad[3] = 0x00;
  const d2 = decodeFrame(proto, bad);
  const inv2 = d2.fields.find((f) => f.field.name === "lenInv");
  check("反码错 → 标红", inv2?.ok === false, inv2?.error ?? "");
}

console.log("\n[4] 换一种数据域长度：len 与反码自动跟着变");
{
  const f2 = fields.map((f) => (f.id === "data" ? { ...f, size: 3 } : f));
  const p2: PdlProtocol = { ...proto, messages: [{ id: "frame", name: "报文", fields: f2 }] };
  const bytes = encodeMessage(p2, p2.messages[0], {});
  check("总长 8", bytes.length === 8, String(bytes.length));
  check("len=08（自动）", toHex(bytes.slice(2, 3)) === "08", toHex(bytes.slice(2, 3)));
  check("反码=F7（自动）", toHex(bytes.slice(3, 4)) === "F7", toHex(bytes.slice(3, 4)));
  const rt = roundTrip(p2, bytes);
  check("round-trip 一致", rt.ok, rt.ok ? "" : `${rt.diffIndexes.length} 差异`);
}

console.log("\n[5] 完整样例帧解析");
{
  const frame = parseHex("DE 21 0A F5 11 22 33 44 55 2A");
  // 手工核对 sum
  const sum = frame.slice(0, -1).reduce((a, b) => (a + b) & 0xff, 0);
  const sample = [...frame.slice(0, -1), sum];
  const d = decodeFrame(proto, sample);
  check("帧头校验通过", d.headerOk, d.headerError ?? "");
  check("长度自洽", d.lengthOk, d.lengthError ?? "");
  check("反码校验通过", d.fields.find((f) => f.field.name === "lenInv")?.ok === true);
  check("校验通过", d.crcOk, `期望 ${d.crcExpected} 实际 ${d.crcActual}`);
  check("data 解出 5 字节", d.fields.find((f) => f.field.name === "data")?.raw.length === 5);
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
console.log("长度 + 反码 + 变长 + 校验 全部可用 ✅");
