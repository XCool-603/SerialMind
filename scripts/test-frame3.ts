/**
 * 用户真实帧验证：DE 21 09 F6 60 | 00 | 00 00
 *   头(5 字节固定) | 车号(1 字节) | 高低位(2 字节) = 8 字节
 * 运行： npx tsx scripts/test-frame3.ts
 */
import { messageLength, type PdlField, type PdlProtocol } from "../src/engine/pdl";
import { decodeFrame, encodeMessage, roundTrip } from "../src/engine/codec";
import { FrameSplitter } from "../src/engine/framer";
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

const SAMPLE = "DE 21 09 F6 60 00 00 00";

const fields: PdlField[] = [
  { id: "header", name: "header", type: "bytes", size: 5, offset: 0, hex: "DE 21 09 F6 60", desc: "帧头（固定）" },
  { id: "carNo", name: "carNo", type: "uint", size: 1, offset: 5, value: 0, desc: "车号" },
  { id: "value", name: "value", type: "uint", size: 2, offset: 6, byteOrder: "ABCD", value: 0, desc: "高/低位" },
];

const proto: PdlProtocol = {
  id: "p3",
  name: "三字段协议",
  version: "v1",
  framing: { mode: "fixed", gapMs: 20 },
  checksum: { algorithm: "SUM8", from: 0, to: "len", endian: "big" },
  messages: [{ id: "frame", name: "报文", fields }],
  sampleFrame: SAMPLE,
  updatedAt: "—",
};

console.log(`\n样例帧：${SAMPLE}（${parseHex(SAMPLE).length} 字节）`);
console.log("\n[1] 帧长与字段布局");
{
  check("定长 = 8 字节", messageLength(proto.messages[0]) === 8, String(messageLength(proto.messages[0])));
  check("三个字段", proto.messages[0].fields.length === 3);
}

console.log("\n[2] 解码");
{
  const bytes = parseHex(SAMPLE);
  const d = decodeFrame(proto, bytes);
  const header = d.fields.find((f) => f.field.name === "header");
  const carNo = d.fields.find((f) => f.field.name === "carNo");
  const value = d.fields.find((f) => f.field.name === "value");
  check("帧头 = DE 21 09 F6 60", header?.display === "DE 21 09 F6 60", String(header?.display));
  check("帧头校验通过", header?.ok === true, header?.error ?? "");
  check("车号 = 0", Number(carNo?.value) === 0, String(carNo?.display));
  check("高低位 = 0", Number(value?.value) === 0, String(value?.display));
  check("无校验字段时 crcOk 不误报", d.crcOk === true);
}

console.log("\n[3] 改车号 / 高低位后组包");
{
  const bytes = encodeMessage(proto, proto.messages[0], { carNo: 5, value: 0x1234 });
  check("帧头保持固定", toHex(bytes.slice(0, 5)) === "DE 21 09 F6 60", toHex(bytes.slice(0, 5)));
  check("车号写成 05", toHex(bytes.slice(5, 6)) === "05", toHex(bytes.slice(5, 6)));
  check("高低位写成 12 34", toHex(bytes.slice(6, 8)) === "12 34", toHex(bytes.slice(6, 8)));
  check("总长 8 字节", bytes.length === 8);
}

console.log("\n[4] round-trip");
{
  const rt = roundTrip(proto, parseHex(SAMPLE));
  check("样例帧逐字节一致", rt.ok, rt.ok ? "" : `${rt.diffIndexes.length} 字节差异`);
}

console.log("\n[5] 流式分帧（定长 8）");
{
  const sp = new FrameSplitter(() => proto);
  const got = sp.push(parseHex(SAMPLE));
  check("切出 1 帧", got.length === 1);
  check("帧内容一致", toHex(got[0] ?? []) === toHex(parseHex(SAMPLE)));
  const sp2 = new FrameSplitter(() => proto);
  const got2 = sp2.push([...parseHex(SAMPLE), ...parseHex(SAMPLE)]);
  check("一包两帧切出 2 帧", got2.length === 2, `实际 ${got2.length}`);
}

console.log("\n[6] 帧头不对必须报错");
{
  const bad = parseHex("DE 21 09 F6 61 00 00 00");
  const d = decodeFrame(proto, bad);
  check("帧头错 → headerOk=false", d.headerOk === false, d.headerError ?? "");
}

console.log("\n[7] 枚举：00=无 01=上线 02=上电 04=启动");
{
  const enumFields: PdlField[] = [
    { id: "header", name: "header", type: "bytes", size: 5, offset: 0, hex: "DE 21 09 F6 60" },
    {
      id: "state",
      name: "state",
      type: "uint",
      size: 1,
      offset: 5,
      value: 0,
      enumMap: { 0: "无", 1: "上线", 2: "上电", 4: "启动" },
      desc: "状态",
    },
    { id: "value", name: "value", type: "uint", size: 2, offset: 6, byteOrder: "ABCD", value: 0 },
  ];
  const p2: PdlProtocol = { ...proto, messages: [{ id: "frame", name: "报文", fields: enumFields }] };
  const d0 = decodeFrame(p2, parseHex("DE 21 09 F6 60 00 00 00"));
  const s0 = d0.fields.find((f) => f.field.name === "state");
  check("00 → 显示 00 无", String(s0?.display) === "00 无", String(s0?.display));

  const d1 = decodeFrame(p2, parseHex("DE 21 09 F6 60 01 00 00"));
  const s1 = d1.fields.find((f) => f.field.name === "state");
  check("01 → 显示 01 上线", String(s1?.display) === "01 上线", String(s1?.display));

  const d4 = decodeFrame(p2, parseHex("DE 21 09 F6 60 04 12 34"));
  const s4 = d4.fields.find((f) => f.field.name === "state");
  check("04 → 显示 04 启动", String(s4?.display) === "04 启动", String(s4?.display));
  check("同帧其他字段仍正常", Number(d4.fields.find((f) => f.field.name === "value")?.value) === 0x1234);

  const enc = encodeMessage(p2, p2.messages[0], { state: 2, value: 0 });
  check("枚举值可组包（02 上电）", toHex(enc.slice(5, 6)) === "02", toHex(enc.slice(5, 6)));
}

console.log("\n[8] 整帧不分字段：一帧就是一个固定报文");
{
  const wholeFields: PdlField[] = [
    { id: "frame", name: "frame", type: "bytes", size: 8, offset: 0, hex: "DE 21 09 F6 60 00 00 00", desc: "整帧（固定报文）" },
  ];
  const p3: PdlProtocol = { ...proto, messages: [{ id: "frame", name: "报文", fields: wholeFields }] };
  const d = decodeFrame(p3, parseHex(SAMPLE));
  const f = d.fields[0];
  check("只有一个字段", d.fields.length === 1);
  check("整帧内容显示为 HEX", String(f?.display) === "DE 21 09 F6 60 00 00 00", String(f?.display));
  check("整帧校验通过", f?.ok === true, f?.error ?? "");
  const rebuilt = encodeMessage(p3, p3.messages[0], {});
  check("可以直接按原样发出去", toHex(rebuilt) === "DE 21 09 F6 60 00 00 00", toHex(rebuilt));
  const rt = roundTrip(p3, parseHex(SAMPLE));
  check("整帧 round-trip 一致", rt.ok);
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
console.log("三个字段的协议已完全可用 ✅");
