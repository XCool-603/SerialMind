/**
 * 字节序 ABCD / BADC / CDAB / DCBA 双向验证（分析文档里唯一零覆盖的功能）
 * 运行： npx tsx scripts/test-byteorder.ts
 */
import { type PdlField, type PdlProtocol } from "../src/engine/pdl";
import { decodeFrame, encodeMessage } from "../src/engine/codec";
import { parseHex, toHex } from "../src/engine/bytes";

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

const VALUE = 0x12345678;

function protoWith(order: PdlField["byteOrder"]): PdlProtocol {
  return {
    id: `p-${order}`,
    name: `字节序 ${order}`,
    version: "v1",
    framing: { mode: "fixed", gapMs: 20 },
    checksum: { algorithm: "ADD8", from: 0, to: "len", endian: "big" },
    messages: [
      {
        id: "frame",
        name: "报文",
        fields: [{ id: "v", name: "v", type: "uint", size: 4, offset: 0, byteOrder: order, value: VALUE }],
      },
    ],
    sampleFrame: "",
    updatedAt: "—",
  };
}

console.log(`\n原值：0x${VALUE.toString(16).toUpperCase()}（4 字节）`);

console.log("\n[1] 组包字节序");
{
  const cases: [NonNullable<PdlField["byteOrder"]>, string][] = [
    ["ABCD", "12 34 56 78"],
    ["BADC", "34 12 78 56"],
    ["CDAB", "56 78 12 34"],
    ["DCBA", "78 56 34 12"],
  ];
  for (const [order, want] of cases) {
    const bytes = encodeMessage(protoWith(order), protoWith(order).messages[0], { v: VALUE });
    check(`${order} → ${want}`, toHex(bytes) === want, toHex(bytes));
  }
}

console.log("\n[2] 解包还原（双向一致）");
{
  for (const order of ["ABCD", "BADC", "CDAB", "DCBA"] as const) {
    const proto = protoWith(order);
    const bytes = encodeMessage(proto, proto.messages[0], { v: VALUE });
    const d = decodeFrame(proto, bytes);
    const v = d.fields[0]?.value;
    check(`${order} 解回原值`, Number(v) === VALUE, `0x${Number(v).toString(16).toUpperCase()}`);
  }
}

console.log("\n[3] 真实帧：DE 21 09 F6 60 01 00 00（data1 两字节）");
{
  const mk = (order: PdlField["byteOrder"]): PdlProtocol => ({
    id: "plc",
    name: "plc",
    version: "v1",
    framing: { mode: "fixed", gapMs: 20 },
    checksum: { algorithm: "ADD8", from: 0, to: "len", endian: "big" },
    messages: [
      {
        id: "f",
        name: "报文",
        fields: [
          { id: "h", name: "header", type: "bytes", size: 5, offset: 0, hex: "DE 21 09 F6 60" },
          { id: "c", name: "cmd", type: "uint", size: 1, offset: 5, value: 1 },
          { id: "d", name: "data1", type: "uint", size: 2, offset: 6, byteOrder: order, value: 0 },
        ],
      },
    ],
    sampleFrame: "",
    updatedAt: "—",
  });
  const abcd = encodeMessage(mk("ABCD"), mk("ABCD").messages[0], { cmd: 1, data1: 0x0212 });
  const dcba = encodeMessage(mk("DCBA"), mk("DCBA").messages[0], { cmd: 1, data1: 0x0212 });
  check("data1=0x0212 大端 ABCD → 02 12", toHex(dcba ? abcd.slice(6, 8) : []) === "02 12", toHex(abcd.slice(6, 8)));
  check("data1=0x0212 小端 DCBA → 12 02", toHex(dcba.slice(6, 8)) === "12 02", toHex(dcba.slice(6, 8)));

  const d = decodeFrame(mk("DCBA"), parseHex("DE 21 09 F6 60 01 12 02"));
  check("小端解回 0x0212", Number(d.fields.find((f) => f.field.name === "data1")?.value) === 0x0212, String(d.fields.find((f) => f.field.name === "data1")?.value));
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
console.log("四种字节序双向都正确 ✅");
