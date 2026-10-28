import { applyOrder, bigEndianBytes, bitsOf, readBigEndian, undoOrder } from "./bytes";
import { computeChecksum, checksumSize as checksumSizeOf } from "./crc";
import { evalExpr } from "./expr";
import { messageLength, type PdlField, type PdlMessage, type PdlProtocol } from "./pdl";

export interface DecodedField {
  field: PdlField;
  raw: number[];
  value: number | string | boolean;
  display: string;
  ok: boolean;
  /** 帧头/固定值不匹配时的说明 */
  error?: string;
}

export interface ResolvedField {
  field: PdlField;
  offset: number;
  size: number;
}

/**
 * 按帧长解算字段布局（支持变长：sizeExpr / offsetExpr）
 * vars: len（整帧长度）+ 已解出的字段值
 */
export function resolveLayout(msg: PdlMessage, frameLen: number, vars: Record<string, number> = {}): ResolvedField[] {
  const out: ResolvedField[] = [];
  const env: Record<string, number> = { len: frameLen, ...vars };
  let cursor = 0;
  for (const f of msg.fields) {
    if (f.offset < 0) continue;

    let size = f.size;
    if (f.sizeExpr) {
      const v = evalExpr(f.sizeExpr, env);
      size = v === null ? 0 : Math.max(0, Math.round(v));
    }

    let offset: number;
    if (f.offsetExpr) {
      const v = evalExpr(f.offsetExpr, env);
      offset = v === null ? cursor : Math.max(0, Math.round(v));
    } else if (f.offset >= cursor) {
      offset = f.offset;
    } else {
      // 前一个字段变长，后续字段跟着顺延
      offset = cursor;
    }

    out.push({ field: f, offset, size });
    // 注意：不要用字段名覆盖内置变量 len —— 长度字段通常就叫 len
    if (f.name !== "len" && !(f.name in env)) env[f.name] = 0;
    cursor = Math.max(cursor, offset + size);
  }
  return out;
}

/** 找校验字段 */
export function findChecksum(msg: PdlMessage): PdlField | undefined {
  return msg.fields.find((f) => f.type === "crc");
}

/** 组包：字段值 → 线序字节（含校验自动计算；支持变长） */
export function encodeMessage(
  proto: PdlProtocol,
  msg: PdlMessage,
  values: Record<string, number | string | boolean> = {},
): number[] {
  // 有「自动整帧长度」字段时：帧长 = 各字段长度之和
  const autoField = msg.fields.find((f) => f.auto === "frameLength");
  // 帧长：定长直接用；变长取 len 字段值
  let frameLen = messageLength(msg);
  if (autoField) {
    let sum = 0;
    for (const f of msg.fields) {
      if (f.offset < 0) continue;
      sum += f.sizeExpr ? 0 : f.size;
    }
    frameLen = sum;
    values = { ...values, [autoField.name]: frameLen };
  }
  if (frameLen < 0) {
    const lenField = msg.fields.find((f) => f.name === "len" || f.name === "length" || f.name === "len_field");
    const explicit = lenField ? Number(values[lenField.name]) : NaN;
    frameLen = Number.isFinite(explicit) && explicit > 0 ? explicit : 0;
    if (!frameLen) {
      throw new Error("变长协议需要提供长度字段（len）的值才能组包");
    }
  }

  const layout = resolveLayout(msg, frameLen);
  const buf = new Array<number>(frameLen).fill(0);
  const crcField = findChecksum(msg);
  const crcResolved = crcField ? layout.find((l) => l.field.id === crcField.id) : undefined;

  // 先填非校验字段（计算字段按顺序用已写入的值求值）
  const env: Record<string, number> = { len: frameLen };
  for (const { field: f, offset, size } of layout) {
    if (f.type === "crc" || size <= 0) continue;
    // 固定字节字段：直接写 HEX
    if (f.hex) {
      const hb = hexToBytes(f.hex);
      for (let i = 0; i < Math.min(hb.length, size); i++) buf[offset + i] = hb[i] & 0xff;
      continue;
    }
    // 计算字段：值由表达式算出（如长度反码 0xFF - len）
    let num: number;
    if (f.valueExpr) {
      const v = evalExpr(f.valueExpr, env);
      num = v === null ? 0 : Math.round(v);
    } else {
      const raw = values[f.name] !== undefined ? values[f.name] : f.value ?? 0;
      num = typeof raw === "boolean" ? (raw ? 1 : 0) : Number(raw) || 0;
    }
    env[f.name] = num;
    const be = bigEndianBytes(num, size);
    const wire = applyOrder(be, f.byteOrder ?? "ABCD");
    for (let i = 0; i < size && offset + i < frameLen; i++) buf[offset + i] = wire[i] & 0xff;
  }

  // 再算校验
  if (crcField && crcResolved) {
    const crcOff = crcResolved.offset;
    const val = computeChecksum(proto.checksum.algorithm, buf.slice(proto.checksum.from, crcOff));
    const be = bigEndianBytes(val, crcResolved.size);
    const wire = applyOrder(be, crcField.byteOrder ?? "BADC");
    for (let i = 0; i < crcResolved.size && crcOff + i < frameLen; i++) buf[crcOff + i] = wire[i] & 0xff;
  }

  return buf;
}

function hexToBytes(hex?: string): number[] {
  if (!hex) return [];
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

function decodeOne(f: PdlField, bytes: number[], offset: number, size: number): DecodedField {
  const wire = bytes.slice(offset, offset + size);
  // 固定字节字段：显示 HEX，并逐字节校验
  if (f.hex) {
    const expect = hexToBytes(f.hex);
    const ok = expect.length === wire.length && expect.every((b, i) => b === wire[i]);
    return {
      field: f,
      raw: wire,
      value: wire.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "),
      display: wire.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "),
      ok,
      error: ok ? undefined : `期望 ${f.hex}，实际 ${wire.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}`,
    };
  }
  const be = undoOrder(wire, f.byteOrder ?? "ABCD");
  let value: number | string | boolean = 0;

  switch (f.type) {
    case "uint":
    case "reserved":
    case "crc":
    case "timestamp":
      value = readBigEndian(be, false);
      break;
    case "int":
      value = readBigEndian(be, true);
      break;
    case "float":
      value = be.length === 4 ? new DataView(new Uint8Array(be).buffer).getFloat32(0) : 0;
      break;
    case "bool": {
      const bit = f.bits ? Number(f.bits) : 0;
      value = bitsOf(wire[0] ?? 0, bit, bit) === 1;
      break;
    }
    case "bitfield": {
      const [from, to] = (f.bits ?? "7..0").split("..").map(Number);
      value = bitsOf(wire[0] ?? 0, from, to);
      break;
    }
    case "bcd":
      value = Number(be.map((b) => b.toString(16).padStart(2, "0")).join("")) || 0;
      break;
    case "enum":
      value = readBigEndian(be, false);
      break;
    case "string":
      value = be.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "·")).join("");
      break;
    default:
      value = readBigEndian(be, false);
  }

  let display: string;
  const enumLabel = f.enumMap?.[Number(value)];
  if (f.valueFormat === "hex" && typeof value === "number") {
    // 十六进制显示（如 len = 0A）
    display = value.toString(16).toUpperCase().padStart(Math.max(2, size * 2), "0");
  } else if (enumLabel) {
    // 任何数值字段只要配了枚举，就显示「值 名称」
    display = `${Number(value).toString(16).padStart(2, "0").toUpperCase()} ${enumLabel}`;
  } else if (f.type === "enum") {
    display = String(value);
  } else if (f.type === "bool") {
    display = value ? "1" : "0";
  } else if (f.type === "string") {
    display = String(value);
  } else {
    display = `${value}${f.unit ?? ""}`;
  }

  let ok = true;
  let error: string | undefined;
  if (f.expect !== undefined && Number(value) !== f.expect) {
    ok = false;
    error = `期望 0x${f.expect.toString(16).toUpperCase()}，实际 0x${Number(value).toString(16).toUpperCase()}`;
  }

  return { field: f, raw: wire, value, display, ok, error };
}

export interface DecodeResult {
  msg: PdlMessage;
  fields: DecodedField[];
  crcOk: boolean;
  crcExpected: string;
  crcActual: string;
  diffBytes: number[];
  /** 帧头/固定值校验失败 */
  headerOk: boolean;
  headerError?: string;
  /** 长度字段与实到字节数是否一致 */
  lengthOk: boolean;
  lengthError?: string;
  /** 这一帧是否匹配当前协议（长度/帧头都对得上） */
  matched: boolean;
  /** 不匹配的原因 */
  matchError?: string;
}

export function detectMessage(proto: PdlProtocol, bytes: number[]): PdlMessage {
  // 1) 按帧头识别
  const prefix = proto.framing.prefix ? proto.framing.prefix.replace(/\s/g, "") : "";
  if (prefix) {
    const prefixBytes: number[] = [];
    for (let i = 0; i < prefix.length; i += 2) prefixBytes.push(parseInt(prefix.slice(i, i + 2), 16));
    if (bytes.length >= prefixBytes.length && prefixBytes.every((b, i) => bytes[i] === b)) {
      // 命中帧头，继续用命令字区分报文
    }
  }

  // 2) 定长匹配
  const exact = proto.messages.filter((m) => messageLength(m) === bytes.length);
  if (exact.length === 1) return exact[0];

  // 3) 命令字匹配
  const cmdField = proto.messages[0]?.fields.find((f) => f.name === "cmd" || f.name === "func" || f.name === "code");
  if (cmdField) {
    const layout = resolveLayout(proto.messages[0], bytes.length);
    const r = layout.find((l) => l.field.id === cmdField.id);
    if (r) {
      const v = readBigEndian(undoOrder(bytes.slice(r.offset, r.offset + r.size), cmdField.byteOrder ?? "ABCD"), false);
      const hit = proto.messages.find((m) => m.fields.some((f) => (f.name === "cmd" || f.name === "func" || f.name === "code") && Number(f.value) === v));
      if (hit) return hit;
    }
  }

  if (exact.length > 1) return exact[0];

  // 4) 兜底：长度最接近的
  return proto.messages
    .slice()
    .sort((a, b) => {
      const la = messageLength(a);
      const lb = messageLength(b);
      return Math.abs((la < 0 ? bytes.length : la) - bytes.length) - Math.abs((lb < 0 ? bytes.length : lb) - bytes.length);
    })[0];
}

export function decodeFrame(proto: PdlProtocol, bytes: number[]): DecodeResult {
  const msg = detectMessage(proto, bytes);
  const frameLen = bytes.length;
  const layout = resolveLayout(msg, frameLen);
  const fields = layout.map((l) => decodeOne(l.field, bytes, l.offset, l.size));

  // 自动整帧长度字段：解出的值应等于实际帧长
  const autoField = msg.fields.find((f) => f.auto === "frameLength");
  if (autoField) {
    const af = fields.find((x) => x.field.id === autoField.id);
    if (af) {
      const same = Number(af.value) === frameLen;
      af.ok = same;
      af.error = same ? undefined : `期望 ${frameLen}，实际 ${af.value}`;
    }
  }

  // 计算字段（如长度反码 FF-len）：用已解出的值算一遍，和实际字节比对
  const env: Record<string, number> = { len: frameLen };
  for (const f of fields) {
    if (typeof f.value === "number") env[f.field.name] = f.value;
  }
  for (const f of fields) {
    if (!f.field.valueExpr) continue;
    const expect = evalExpr(f.field.valueExpr, env);
    if (expect === null) continue;
    const actual = Number(f.value);
    const same = Math.round(expect) === actual;
    f.ok = same;
    f.error = same ? undefined : `期望 ${Math.round(expect).toString(16).toUpperCase()}，实际 ${actual.toString(16).toUpperCase()}`;
    f.display = `${actual.toString(16).toUpperCase().padStart(Math.max(2, f.raw.length * 2), "0")}${same ? "" : " ⚠"}`;
  }

  // 帧头/固定值
  const badFixed = fields.find((f) => !f.ok);
  const headerOk = !badFixed;
  const headerError = badFixed ? `${badFixed.field.name} ${badFixed.error}` : undefined;

  // 长度字段自洽
  let lengthOk = true;
  let lengthError: string | undefined;
  const lenField = msg.fields.find((f) => f.name === "len" || f.name === "length");
  if (lenField) {
    const lr = layout.find((l) => l.field.id === lenField.id);
    if (lr) {
      const declared = Number(fields.find((f) => f.field.id === lenField.id)?.value ?? 0);
      const includesHeader = proto.framing.lengthField?.includesHeader !== false;
      const expect = includesHeader ? frameLen : frameLen - (proto.framing.prefix ? proto.framing.prefix.replace(/\s/g, "").length / 2 : 0);
      if (declared && declared !== expect) {
        lengthOk = false;
        lengthError = `长度字段声明 ${declared}B，实际 ${expect}B`;
      }
    }
  }

  // 校验
  const crcField = findChecksum(msg);
  const crcResolved = crcField ? layout.find((l) => l.field.id === crcField.id) : undefined;
  let crcOk = true;
  let crcExpected = "";
  let crcActual = "";
  const diffBytes: number[] = [];

  if (crcField && crcResolved) {
    const crcOff = crcResolved.offset;
    const expect = computeChecksum(proto.checksum.algorithm, bytes.slice(proto.checksum.from, crcOff));
    const wire = bytes.slice(crcOff, crcOff + crcResolved.size);
    const actual = readBigEndian(undoOrder(wire, crcField.byteOrder ?? "BADC"), false);
    crcOk = expect === actual;
    const expectWire = applyOrder(bigEndianBytes(expect, crcResolved.size), crcField.byteOrder ?? "BADC");
    crcExpected = expectWire.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    crcActual = wire.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    if (!crcOk) for (let i = 0; i < wire.length; i++) diffBytes.push(crcOff + i);
  }

  // 帧是否匹配协议：长度必须对得上，固定帧头必须一致
  const expectedLen = messageLength(msg);
  const lengthMismatch = expectedLen > 0 && frameLen !== expectedLen;
  const headerMismatch = !headerOk;
  const matched = !lengthMismatch && !headerMismatch;
  const matchError = lengthMismatch
    ? `这帧 ${frameLen} 字节，当前协议要求 ${expectedLen} 字节 —— 不是同一帧，校验无意义`
    : headerMismatch
      ? `帧头不匹配：${headerError}`
      : undefined;

  return {
    msg,
    fields,
    crcOk,
    crcExpected,
    crcActual,
    diffBytes,
    headerOk,
    headerError,
    lengthOk,
    lengthError,
    matched,
    matchError,
  };
}

/** 校验算法 → 字节数（复用 crc 模块的定义） */
export function checksumSize(algorithm: string): number {
  return checksumSizeOf(algorithm as Parameters<typeof checksumSizeOf>[0]);
}

/**
 * 给一段裸字节追加校验和。
 * **不要求协议里有 crc 字段**：算法可直接指定，字节数按算法推断
 * （CRC16 低字节先，其余单字节）
 */
export function appendChecksum(proto: PdlProtocol, body: number[], algorithm?: string): number[] {
  if (!body.length) return body.slice();
  const alg = (algorithm ?? proto.checksum.algorithm) as Parameters<typeof computeChecksum>[0];
  const crcField = findChecksum(proto.messages[0]);
  const size = crcField?.size ?? checksumSize(alg as string);
  const from = proto.checksum.from ?? 0;
  const value = computeChecksum(alg, body.slice(from));
  const be = bigEndianBytes(value, size);
  const wire = applyOrder(be, crcField?.byteOrder ?? (size > 1 ? "BADC" : "ABCD"));
  return [...body, ...wire];
}

/** 协议里是否有校验字段 */
export function hasChecksum(proto: PdlProtocol): boolean {
  return !!findChecksum(proto.messages[0]);
}

export interface RoundTripResult {
  ok: boolean;
  sample: number[];
  rebuilt: number[];
  diffIndexes: number[];
  message: PdlMessage;
  checksumOnly: boolean;
}

export function roundTrip(proto: PdlProtocol, sample: number[], overrideMsgId?: string): RoundTripResult {
  const msg = overrideMsgId ? proto.messages.find((m) => m.id === overrideMsgId) ?? detectMessage(proto, sample) : detectMessage(proto, sample);
  const decoded = decodeFrame(proto, sample);
  const values: Record<string, number | string | boolean> = {};
  for (const d of decoded.fields) {
    if (d.field.type === "crc" || d.field.offset < 0) continue;
    values[d.field.name] = d.value as number;
  }
  const rebuilt = encodeMessage(proto, msg, values);
  const diffIndexes: number[] = [];
  const n = Math.max(sample.length, rebuilt.length);
  for (let i = 0; i < n; i++) {
    if (sample[i] !== rebuilt[i]) diffIndexes.push(i);
  }
  const crcField = findChecksum(msg);
  const layout = resolveLayout(msg, sample.length);
  const crcResolved = crcField ? layout.find((l) => l.field.id === crcField.id) : undefined;
  const crcIdx = crcResolved?.offset ?? sample.length;
  const checksumOnly = diffIndexes.every((i) => i >= crcIdx);
  return { ok: diffIndexes.length === 0, sample, rebuilt, diffIndexes, message: msg, checksumOnly };
}

/** 用样例帧穷举校验算法 */
export function detectChecksum(proto: PdlProtocol, sample: number[]): { alg: string; ok: boolean }[] {
  const msg = detectMessage(proto, sample);
  const layout = resolveLayout(msg, sample.length);
  const crcField = findChecksum(msg);
  const crcResolved = crcField ? layout.find((l) => l.field.id === crcField.id) : undefined;
  if (!crcField || !crcResolved) return [];
  const wire = sample.slice(crcResolved.offset, crcResolved.offset + crcResolved.size);
  const actual = readBigEndian(undoOrder(wire, crcField.byteOrder ?? "BADC"), false);
  const algs: Array<"CRC16/MODBUS" | "CRC16/CCITT" | "CRC16/XMODEM" | "SUM8" | "XOR8" | "LRC"> = [
    "CRC16/MODBUS",
    "CRC16/CCITT",
    "CRC16/XMODEM",
    "SUM8",
    "XOR8",
    "LRC",
  ];
  return algs.map((alg) => ({ alg, ok: computeChecksum(alg, sample.slice(proto.checksum.from, crcResolved.offset)) === actual }));
}
