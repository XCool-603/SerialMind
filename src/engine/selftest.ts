/**
 * 引擎自检（真跑，不是装饰）
 * 覆盖：校验算法已知向量、字节序四排列、组包/解包、位段、断言求值、帧识别。
 * 设置 → 「引擎自检」可随时执行。
 */
import { computeChecksum, crc16modbus, crc16ccitt, crc32 } from "./crc";
import { applyOrder, bigEndianBytes, bitsOf, parseHex, toHex } from "./bytes";
import { decodeFrame, detectMessage, encodeMessage, roundTrip } from "./codec";
import { CRANE_PROTOCOL } from "./pdl";
import { evalOp, parseOp } from "./runner";

export interface SelfTestItem {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
  /** 归属的验收分组（对应《解决方案说明》里的验收标准项） */
  group?: string;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function t(name: string, fn: () => string | null): SelfTestItem {
  const t0 = performance.now();
  try {
    const err = fn();
    return { name, ok: err === null, detail: err ?? "通过", ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { name, ok: false, detail: `异常：${(e as Error).message}`, ms: Math.round(performance.now() - t0) };
  }
}

export function runSelfTest(): SelfTestItem[] {
  const proto = CRANE_PROTOCOL;
  const req = proto.messages.find((m) => m.id === "read_req")!;
  const resp = proto.messages.find((m) => m.id === "read_resp")!;
  const status = proto.messages.find((m) => m.id === "status")!;

  return [
    t("CRC16/MODBUS 已知向量：值 0xCDC5，线序 C5 CD", () => {
      const v = crc16modbus(parseHex("01 03 00 00 00 0A"));
      if (v !== 0xcdc5) return `值错误，实际 0x${v.toString(16).toUpperCase()}`;
      // MODBUS 低字节先发：BADC 顺序
      const wire = toHex(applyOrder(bigEndianBytes(v, 2), "BADC"));
      return wire === "C5 CD" ? null : `线序错误，实际 ${wire}`;
    }),

    t('CRC16/CCITT 已知向量 "123456789" → 0x29B1', () => {
      const v = crc16ccitt([...'123456789'].map((c) => c.charCodeAt(0)));
      return v === 0x29b1 ? null : `实际 0x${v.toString(16).toUpperCase()}`;
    }),

    t('CRC32 已知向量 "123456789" → 0xCBF43926', () => {
      const v = crc32([...'123456789'].map((c) => c.charCodeAt(0)));
      return v === 0xcbf43926 ? null : `实际 0x${v.toString(16).toUpperCase()}`;
    }),

    t("SUM8 / XOR8 基础运算", () => {
      if (computeChecksum("SUM8", [1, 2, 3]) !== 6) return "SUM8 错误";
      if (computeChecksum("XOR8", [0xff, 0x0f]) !== 0xf0) return "XOR8 错误";
      return null;
    }),

    t("字节序 ABCD/BADC/CDAB/DCBA（4 字节 0x11223344）", () => {
      const be = bigEndianBytes(0x11223344, 4);
      const expect: Record<string, string> = {
        ABCD: "11 22 33 44",
        BADC: "22 11 44 33",
        CDAB: "33 44 11 22",
        DCBA: "44 33 22 11",
      };
      for (const [k, v] of Object.entries(expect)) {
        const got = toHex(applyOrder(be, k as "ABCD"));
        if (got !== v) return `${k} 期望 ${v} 实际 ${got}`;
      }
      return null;
    }),

    t("组包 → 解包 round-trip（position=3000）", () => {
      const bytes = encodeMessage(proto, resp, { addr: 1, func: 3, byte_count: 2, position: 3000 });
      const d = decodeFrame(proto, bytes);
      if (!d.crcOk) return "CRC 校验未通过";
      const pos = d.fields.find((f) => f.field.name === "position")?.value;
      return Number(pos) === 3000 ? null : `解出 position=${pos}`;
    }),

    t("样例帧 round-trip 逐字节一致", () => {
      const bytes = encodeMessage(proto, resp, { addr: 1, func: 3, byte_count: 2, position: 3000 });
      const rt = roundTrip(proto, bytes, "read_resp");
      return rt.ok ? null : `${rt.diffIndexes.length} 个字节差异`;
    }),

    t("位段提取 bitsOf", () => {
      if (bitsOf(0b1011, 3, 0) !== 11) return "低 4 位错误";
      if (bitsOf(0b1011, 0, 0) !== 1) return "bit0 错误";
      if (bitsOf(0b1011, 3, 2) !== 2) return "高 2 位错误";
      return null;
    }),

    t("帧识别：7 字节 → read_resp", () => {
      const bytes = encodeMessage(proto, resp, { addr: 1, func: 3, byte_count: 2, position: 3000 });
      const msg = detectMessage(proto, bytes);
      return msg.id === "read_resp" ? null : `识别成 ${msg.id}`;
    }),

    t("帧识别：15 字节 → status", () => {
      const bytes = encodeMessage(proto, status, { addr: 1, func: 3, byte_count: 2, position: 3000 });
      const msg = detectMessage(proto, bytes);
      return msg.id === "status" ? null : `识别成 ${msg.id}`;
    }),

    t("断言求值 equals / range / in", () => {
      const eqOp = parseOp("equals 3000");
      const rangeOp = parseOp("range 1000..4000");
      const inOp = parseOp("in 1,3,5");
      if (!eqOp || !rangeOp || !inOp) return "断言解析失败";
      if (!evalOp(3000, eqOp)) return "equals 失败";
      if (!evalOp(2500, rangeOp)) return "range 失败";
      if (!evalOp(3, inOp)) return "in 失败";
      if (evalOp(7, inOp)) return "in 误判";
      return null;
    }),

    t("十六进制解析容错（0x / 空格 / 连写）", () => {
      const a = toHex(parseHex("0x01 0x03 0A"));
      const b = toHex(parseHex("01030A"));
      const c = toHex(parseHex("01,03,0a"));
      return eq(a, b) && eq(b, c) ? null : `${a} | ${b} | ${c}`;
    }),

    t("校验算法判定：能识别出 CRC16/MODBUS", () => {
      const bytes = encodeMessage(proto, resp, { addr: 1, func: 3, byte_count: 2, position: 3000 });
      const d = decodeFrame(proto, bytes);
      return d.crcOk ? null : "样例帧 CRC 未通过";
    }),

    t("坏帧必须被判定为 CRC 失败", () => {
      const bytes = encodeMessage(proto, resp, { addr: 1, func: 3, byte_count: 2, position: 3000 });
      bytes[bytes.length - 1] ^= 0xff;
      const d = decodeFrame(proto, bytes);
      return d.crcOk ? "坏帧被误判为通过" : null;
    }),
  ];
}
