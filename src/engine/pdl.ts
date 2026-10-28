import type { ByteOrder } from "./bytes";
import type { ChecksumAlgorithm } from "./crc";

export type FieldType =
  | "uint"
  | "int"
  | "float"
  | "bcd"
  | "bool"
  | "bitfield"
  | "enum"
  | "bytes"
  | "string"
  | "array"
  | "tlv"
  | "reserved"
  | "nested"
  | "timestamp"
  | "crc";

export interface PdlField {
  id: string;
  name: string;
  type: FieldType;
  size: number;
  /** 跨字段/计算字段为 -1 */
  offset: number;
  byteOrder?: ByteOrder;
  bits?: string;
  value?: number | string;
  desc?: string;
  enumMap?: Record<number, string>;
  scale?: number;
  unit?: string;
  /** 值的显示/输入格式：十进制或十六进制（如 len 显示成 0A） */
  valueFormat?: "dec" | "hex";
  /** 自动字段：值为整帧长度（长度字段用它，不用手填） */
  auto?: "frameLength";
  /** 计算字段：值由表达式算出，如长度反码 "0xFF - len" */
  valueExpr?: string;
  /** 变长字段：字节数由表达式算出，如 "len - 5" */
  sizeExpr?: string;
  /** 变长帧里的偏移：如 "len - 1"（校验在帧尾） */
  offsetExpr?: string;
  /** 固定值校验（帧头/帧尾/命令字），解码时不等即报错 */
  expect?: number;
  /** 固定字节内容（HEX），如 "DE 21 09 F6 60"；用于多字节帧头，避免填成巨大十进制 */
  hex?: string;
  /** 跨字段组成说明 */
  compose?: { parts: string[]; note: string };
}

export interface PdlMessage {
  id: string;
  name: string;
  fields: PdlField[];
}

export type FramingMode = "silence-gap" | "fixed" | "delimiter" | "length-field" | "script";

export interface PdlProtocol {
  id: string;
  name: string;
  version: string;
  /** 所属产品（持久化用，可为空） */
  productId?: string;
  /** 所属子产品（一个子产品可以有多个协议） */
  subProductId?: string;
  /** 排序（拖拽调整） */
  order?: number;
  framing: {
    mode: FramingMode;
    gapMs: number;
    /** 帧头字节（HEX），如 "AA 55" */
    prefix?: string;
    /** 帧尾字节（HEX），如 "0D 0A" */
    suffix?: string;
    /** 长度字段位置（相对帧头之后） */
    lengthField?: { offset: number; size: number; includesHeader?: boolean };
    delimiter?: string;
  };
  checksum: {
    algorithm: ChecksumAlgorithm;
    from: number;
    /** "len-2" 或具体下标 */
    to: string;
    endian: "little" | "big";
  };
  messages: PdlMessage[];
  sampleFrame: string;
  updatedAt: string;
}

const F = (f: Partial<PdlField> & { name: string; type: FieldType; size: number }): PdlField => ({
  id: f.name,
  offset: 0,
  ...f,
});

/** 设计稿里的「起升PLC控制协议 v3」 */
export const CRANE_PROTOCOL: PdlProtocol = {
  id: "crane-plc-v3",
  name: "起升PLC 控制协议",
  version: "v3",
  framing: { mode: "silence-gap", gapMs: 20 },
  checksum: { algorithm: "CRC16/MODBUS", from: 0, to: "len-2", endian: "little" },
  sampleFrame: "01 03 02 0B B8 7B 88",
  updatedAt: "2 分钟前",
  messages: [
    {
      id: "status",
      name: "状态上报",
      fields: [
        F({ name: "addr", type: "uint", size: 1, offset: 0, value: 1, desc: "从站地址" }),
        F({
          name: "func",
          type: "enum",
          size: 1,
          offset: 1,
          value: 0x03,
          desc: "功能码 03 读 / 06 写",
          enumMap: { 0x03: "读保持寄存器", 0x06: "写单寄存器", 0x10: "写多寄存器" },
        }),
        F({ name: "byte_count", type: "uint", size: 1, offset: 2, value: 2, desc: "数据字节数" }),
        F({
          name: "position",
          type: "uint",
          size: 2,
          offset: 3,
          byteOrder: "ABCD",
          bits: "15..1",
          value: 3000,
          desc: "当前位置 mm",
          unit: "mm",
        }),
        F({ name: "in_position", type: "bool", size: 1, offset: 5, bits: "0", value: 1, desc: "在位标志位段" }),
        F({ name: "target_point", type: "uint", size: 2, offset: 6, byteOrder: "ABCD", value: 3, desc: "目标点位" }),
        F({ name: "speed_rpm", type: "int", size: 2, offset: 8, byteOrder: "DCBA", value: -120, desc: "转速·有符号补码" }),
        F({
          name: "err_code",
          type: "enum",
          size: 1,
          offset: 10,
          value: 0,
          desc: "故障码",
          enumMap: { 0: "正常", 1: "超重", 2: "限位", 3: "通讯故障" },
        }),
        F({ name: "reserved", type: "reserved", size: 2, offset: 11, value: 0, desc: "保留字段" }),
        F({
          name: "crc16",
          type: "crc",
          size: 2,
          offset: 13,
          byteOrder: "BADC",
          desc: "CRC16/MODBUS 低字节先",
        }),
        F({
          name: "elev_height",
          type: "uint",
          size: 4,
          offset: -1,
          byteOrder: "CDAB",
          value: 125000,
          desc: "提升高度 · 跨字段高16位在 position",
          unit: "mm",
          compose: { parts: ["position"], note: "高 16 位取自 position，低 16 位取自 reserved" },
        }),
      ],
    },
    {
      id: "read_req",
      name: "读保持寄存器请求",
      fields: [
        F({ name: "addr", type: "uint", size: 1, offset: 0, value: 1 }),
        F({ name: "func", type: "enum", size: 1, offset: 1, value: 0x03 }),
        F({ name: "start", type: "uint", size: 2, offset: 2, byteOrder: "ABCD", value: 0 }),
        F({ name: "count", type: "uint", size: 2, offset: 4, byteOrder: "ABCD", value: 10 }),
        F({ name: "crc16", type: "crc", size: 2, offset: 6, byteOrder: "BADC" }),
      ],
    },
    {
      id: "read_resp",
      name: "读保持寄存器响应",
      fields: [
        F({ name: "addr", type: "uint", size: 1, offset: 0, value: 1 }),
        F({ name: "func", type: "enum", size: 1, offset: 1, value: 0x03 }),
        F({ name: "byte_count", type: "uint", size: 1, offset: 2, value: 2 }),
        F({ name: "position", type: "uint", size: 2, offset: 3, byteOrder: "ABCD", value: 3000, unit: "mm" }),
        F({ name: "crc16", type: "crc", size: 2, offset: 5, byteOrder: "BADC" }),
      ],
    },
  ],
};

export const SAMPLE_PROTOCOLS: PdlProtocol[] = [
  CRANE_PROTOCOL,
  {
    ...CRANE_PROTOCOL,
    id: "crane-plc-v2",
    version: "v2",
    name: "起升PLC 控制协议",
    updatedAt: "3 天前",
  },
  {
    ...CRANE_PROTOCOL,
    id: "crane-plc-v1",
    version: "v1",
    name: "起升PLC 控制协议",
    updatedAt: "2 周前",
  },
];

/** 定长帧返回字节数；含变长字段时返回 -1 */
export function messageLength(msg: PdlMessage): number {
  let max = 0;
  for (const f of msg.fields) {
    if (f.offset < 0) continue;
    if (f.sizeExpr) return -1;
    max = Math.max(max, f.offset + f.size);
  }
  return max;
}

export function fieldTypeLabel(t: FieldType): string {
  switch (t) {
    case "uint":
      return "uint";
    case "int":
      return "int";
    case "float":
      return "float";
    case "bcd":
      return "bcd";
    case "bool":
      return "bool";
    case "bitfield":
      return "bitfield";
    case "enum":
      return "enum";
    case "bytes":
      return "bytes";
    case "string":
      return "string";
    case "array":
      return "array";
    case "tlv":
      return "tlv";
    case "reserved":
      return "reserved";
    case "nested":
      return "nested";
    case "timestamp":
      return "timestamp";
    case "crc":
      return "crc";
  }
}

/**
 * 通用二进制 PLC 帧模板（非 Modbus）：
 *   AA 55 | len(1) | cmd(1) | data(len-5) | sum(1)
 * 新建协议默认用它，符合大多数国产 PLC / 板卡的私有协议形状。
 */
export const BINARY_PROTOCOL: PdlProtocol = {
  id: "generic-binary",
  name: "通用二进制帧",
  version: "v1",
  framing: {
    mode: "length-field",
    gapMs: 20,
    prefix: "AA 55",
    lengthField: { offset: 0, size: 1, includesHeader: true },
  },
  checksum: { algorithm: "ADD8", from: 0, to: "len-1", endian: "big" },
  messages: [
    {
      id: "frame",
      name: "通用帧",
      fields: [
        {
          id: "header",
          name: "header",
          type: "uint",
          size: 2,
          offset: 0,
          byteOrder: "ABCD",
          value: 0xaa55,
          expect: 0xaa55,
          desc: "帧头 AA 55（固定）",
        },
        { id: "len", name: "len", type: "uint", size: 1, offset: 2, value: 10, desc: "帧总长度（含头尾）" },
        {
          id: "cmd",
          name: "cmd",
          type: "enum",
          size: 1,
          offset: 3,
          value: 0x03,
          enumMap: { 0x01: "读", 0x02: "写", 0x03: "状态上报", 0x80: "应答" },
          desc: "命令字",
        },
        { id: "data", name: "data", type: "bytes", size: 0, offset: 4, sizeExpr: "len - 5", desc: "数据域（变长）" },
        { id: "sum", name: "sum", type: "crc", size: 1, offset: 0, offsetExpr: "len - 1", desc: "累加和（不含自身）" },
      ],
    },
  ],
  sampleFrame: "",
  updatedAt: "—",
};
/** 空白协议：只有一个数据域 + 校验，字段自己加 */
export const BLANK_PROTOCOL: PdlProtocol = {
  id: "blank",
  name: "空白协议",
  version: "v1",
  framing: { mode: "silence-gap", gapMs: 20 },
  checksum: { algorithm: "ADD8", from: 0, to: "len-1", endian: "big" },
  messages: [{ id: "frame", name: "报文", fields: [] }],
  sampleFrame: "",
  updatedAt: "—",
};

export interface ProtocolTemplate {
  id: string;
  label: string;
  desc: string;
  make: () => PdlProtocol;
}

/** 新建协议时可选的协议族模板 */
export const PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
  {
    id: "plc",
    label: "PLC 默认（帧头+长度+反码+命令+数据+校验）",
    desc: "DE 21 | 长度 | 长度反码 | 命令 | 数据0 | 数据1 | 校验，全部十六进制",
    make: () => PLC_PROTOCOL,
  },
  {
    id: "blank",
    label: "空白 · 自己加字段",
    desc: "不预置任何字段，按你自己的协议加（推荐）",
    make: () => BLANK_PROTOCOL,
  },
  {
    id: "binary",
    label: "示例：通用二进制",
    desc: "仅作参考，预置 帧头/长度/命令/数据/校验 五段",
    make: () => BINARY_PROTOCOL,
  },
  {
    id: "modbus",
    label: "示例：Modbus RTU",
    desc: "仅作参考，预置 地址/功能码/数据/CRC16",
    make: () => CRANE_PROTOCOL,
  },
];

export function templateById(id: string): ProtocolTemplate {
  return PROTOCOL_TEMPLATES.find((t) => t.id === id) ?? PROTOCOL_TEMPLATES[0];
}
/** 原始字节模式：没有可用协议时用它，不解析字段、不误报校验错 */
export const RAW_PROTOCOL: PdlProtocol = {
  id: "raw",
  name: "原始字节",
  version: "—",
  framing: { mode: "silence-gap", gapMs: 20 },
  checksum: { algorithm: "ADD8", from: 0, to: "len-1", endian: "big" },
  messages: [{ id: "raw", name: "原始数据", fields: [] }],
  sampleFrame: "",
  updatedAt: "—",
};
/**
 * PLC 默认模板（用户的实际帧结构）
 *   DE 21 | len | len反码 | cmd | data0 | data1 | sum
 *    2B      1B      1B       1B     1B      2B      1B   = 9 字节
 * 全部字段按十六进制显示/填写
 */
export const PLC_PROTOCOL: PdlProtocol = {
  id: "plc-default",
  name: "PLC 默认协议",
  version: "v1",
  framing: { mode: "silence-gap", gapMs: 20 },
  checksum: { algorithm: "ADD8", from: 0, to: "len-1", endian: "big" },
  messages: [
    {
      id: "frame",
      name: "报文",
      fields: [
        { id: "header", name: "header", type: "bytes", size: 2, offset: 0, hex: "DE 21", desc: "帧头（固定）" },
        { id: "len", name: "len", type: "uint", size: 1, offset: 2, value: 9, valueFormat: "hex", auto: "frameLength", desc: "帧长度（自动）" },
        { id: "lenInv", name: "lenInv", type: "uint", size: 1, offset: 3, value: 0, valueFormat: "hex", valueExpr: "0xFF - len", desc: "长度反码 FF-len（自动）" },
        { id: "cmd", name: "cmd", type: "uint", size: 1, offset: 4, value: 0x60, valueFormat: "hex", desc: "命令 / 状态" },
        { id: "data0", name: "data0", type: "uint", size: 1, offset: 5, value: 0x01, valueFormat: "hex", desc: "数据 0" },
        { id: "data1", name: "data1", type: "uint", size: 2, offset: 6, byteOrder: "ABCD", value: 0x0000, valueFormat: "hex", desc: "数据 1（2 字节）" },
        { id: "sum", name: "sum", type: "crc", size: 1, offset: 8, desc: "校验和（自动）" },
      ],
    },
  ],
  sampleFrame: "DE 21 09 F6 60 01 00 00 5F",
  updatedAt: "—",
};