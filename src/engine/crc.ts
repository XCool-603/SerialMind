export type ChecksumAlgorithm =
  // ---- 累加类 ----
  | "ADD8" // 8 位累加和（&0xFF）—— 俗称 ADD8 / SUM8
  | "ADD16" // 16 位累加和
  | "INV8" // 累加和取反（0xFF - sum）
  | "NEG8" // 累加和补码（0x100 - sum）
  | "LRC" // Modbus ASCII LRC（= NEG8）
  | "XOR8" // 异或和
  | "BCC" // 块校验（= XOR8）
  | "NEGXOR8" // 异或和取反
  // ---- CRC8 ----
  | "CRC8"
  | "CRC8/MAXIM"
  | "CRC8/SAE-J1850"
  | "CRC8/ROHC"
  // ---- CRC16 ----
  | "CRC16/MODBUS"
  | "CRC16/ARC"
  | "CRC16/CCITT"
  | "CRC16/XMODEM"
  | "CRC16/X25"
  | "CRC16/DNP"
  | "CRC16/USB"
  | "FLETCHER16"
  // ---- CRC32 ----
  | "CRC32"
  | "CRC32C";

/** 兼容旧数据里用的 SUM8 */
export type LegacyAlgorithm = "SUM8";

export interface AlgorithmMeta {
  /** 界面显示名 */
  label: string;
  /** 计算方式说明 */
  formula: string;
  /** 占几个字节 */
  size: number;
  /** 分组 */
  group: "累加 / 异或" | "CRC8" | "CRC16" | "CRC32 / 其它";
}

export const ALGORITHM_META: Record<ChecksumAlgorithm, AlgorithmMeta> = {
  ADD8: { label: "ADD8 累加和", formula: "Σ bytes & 0xFF", size: 1, group: "累加 / 异或" },
  ADD16: { label: "ADD16 累加和", formula: "Σ bytes & 0xFFFF", size: 2, group: "累加 / 异或" },
  INV8: { label: "INV8 累加和取反", formula: "0xFF - (Σ & 0xFF)", size: 1, group: "累加 / 异或" },
  NEG8: { label: "NEG8 累加和补码", formula: "0x100 - (Σ & 0xFF)", size: 1, group: "累加 / 异或" },
  LRC: { label: "LRC 纵向冗余", formula: "0x100 - (Σ & 0xFF)", size: 1, group: "累加 / 异或" },
  XOR8: { label: "XOR8 异或和", formula: "bytes 逐字节异或", size: 1, group: "累加 / 异或" },
  BCC: { label: "BCC 块校验", formula: "bytes 逐字节异或", size: 1, group: "累加 / 异或" },
  NEGXOR8: { label: "NEGXOR8 异或取反", formula: "~（逐字节异或）& 0xFF", size: 1, group: "累加 / 异或" },
  CRC8: { label: "CRC8 标准", formula: "poly 0x07 init 0x00", size: 1, group: "CRC8" },
  "CRC8/MAXIM": { label: "CRC8/MAXIM (Dallas)", formula: "poly 0x31 反射 init 0x00", size: 1, group: "CRC8" },
  "CRC8/SAE-J1850": { label: "CRC8/SAE-J1850", formula: "poly 0x1D init 0xFF xor 0xFF", size: 1, group: "CRC8" },
  "CRC8/ROHC": { label: "CRC8/ROHC", formula: "poly 0x07 反射 init 0xFF", size: 1, group: "CRC8" },
  "CRC16/MODBUS": { label: "CRC16/MODBUS", formula: "poly 0xA001 init 0xFFFF 反射", size: 2, group: "CRC16" },
  "CRC16/ARC": { label: "CRC16/ARC (IBM)", formula: "poly 0xA001 init 0x0000 反射", size: 2, group: "CRC16" },
  "CRC16/CCITT": { label: "CRC16/CCITT-FALSE", formula: "poly 0x1021 init 0xFFFF", size: 2, group: "CRC16" },
  "CRC16/XMODEM": { label: "CRC16/XMODEM", formula: "poly 0x1021 init 0x0000", size: 2, group: "CRC16" },
  "CRC16/X25": { label: "CRC16/X25 (IBM-SDLC)", formula: "poly 0x8408 init 0xFFFF xor 0xFFFF", size: 2, group: "CRC16" },
  "CRC16/DNP": { label: "CRC16/DNP", formula: "poly 0xA6BC init 0x0000 xor 0xFFFF", size: 2, group: "CRC16" },
  "CRC16/USB": { label: "CRC16/USB", formula: "poly 0xA001 init 0xFFFF xor 0xFFFF", size: 2, group: "CRC16" },
  FLETCHER16: { label: "Fletcher-16", formula: "双模 255 累加", size: 2, group: "CRC16" },
  CRC32: { label: "CRC32 (IEEE)", formula: "poly 0xEDB88320", size: 4, group: "CRC32 / 其它" },
  CRC32C: { label: "CRC32C (Castagnoli)", formula: "poly 0x82F63B78", size: 4, group: "CRC32 / 其它" },
};

/* ---------------- 基础实现 ---------------- */

export function crc16modbus(bytes: number[], init = 0xffff): number {
  let crc = init;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

export function crc16ccitt(bytes: number[], init = 0xffff): number {
  let crc = init;
  for (const b of bytes) {
    crc ^= (b & 0xff) << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** 反射多项式版本（X25 / DNP / USB 用） */
function crc16Reflected(bytes: number[], poly: number, init: number, xorout: number): number {
  let crc = init;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ poly : crc >> 1;
    }
  }
  return (crc ^ xorout) & 0xffff;
}

function crc16Dnp(bytes: number[]): number {
  // DNP：poly 0x3D65 反射 = 0xA6BC，init 0，xor 0xFFFF
  let crc = 0x0000;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa6bc : crc >> 1;
    }
  }
  return (crc ^ 0xffff) & 0xffff;
}

export function crc8(bytes: number[], poly = 0x07, init = 0x00, xorout = 0x00): number {
  let crc = init;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ poly) & 0xff : (crc << 1) & 0xff;
    }
  }
  return (crc ^ xorout) & 0xff;
}

/** 反射 CRC8（MAXIM / ROHC 用） */
function crc8Reflected(bytes: number[], poly: number, init: number, xorout = 0x00): number {
  let crc = init;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ poly : crc >> 1;
    }
  }
  return (crc ^ xorout) & 0xff;
}

export function crc32(bytes: number[], poly = 0xedb88320): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ poly : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function sum8(bytes: number[]): number {
  return bytes.reduce((a, b) => (a + b) & 0xff, 0);
}

export function sum16(bytes: number[]): number {
  return bytes.reduce((a, b) => (a + b) & 0xffff, 0);
}

export function xor8(bytes: number[]): number {
  return bytes.reduce((a, b) => a ^ b, 0) & 0xff;
}

export function lrc(bytes: number[]): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return ((~sum + 1) & 0xff) >>> 0;
}

export function fletcher16(bytes: number[]): number {
  let s1 = 0;
  let s2 = 0;
  for (const b of bytes) {
    s1 = (s1 + b) % 255;
    s2 = (s2 + s1) % 255;
  }
  return ((s2 << 8) | s1) & 0xffff;
}

/** 计算校验值（返回数值，字节序由调用方决定） */
export function computeChecksum(alg: ChecksumAlgorithm | LegacyAlgorithm, bytes: number[]): number {
  switch (alg) {
    // 累加 / 异或
    case "ADD8":
    case "SUM8": // 旧名兼容
      return sum8(bytes);
    case "ADD16":
      return sum16(bytes);
    case "INV8":
      return (~sum8(bytes) & 0xff) >>> 0;
    case "NEG8":
      return ((0x100 - sum8(bytes)) & 0xff) >>> 0;
    case "LRC":
      return lrc(bytes);
    case "XOR8":
    case "BCC":
      return xor8(bytes);
    case "NEGXOR8":
      return (~xor8(bytes) & 0xff) >>> 0;
    // CRC8
    case "CRC8":
      return crc8(bytes, 0x07, 0x00);
    case "CRC8/MAXIM":
      return crc8Reflected(bytes, 0x8c, 0x00);
    case "CRC8/SAE-J1850":
      return crc8(bytes, 0x1d, 0xff, 0xff);
    case "CRC8/ROHC":
      return crc8Reflected(bytes, 0xe0, 0xff);
    // CRC16
    case "CRC16/MODBUS":
      return crc16modbus(bytes, 0xffff);
    case "CRC16/ARC":
      return crc16modbus(bytes, 0x0000);
    case "CRC16/CCITT":
      return crc16ccitt(bytes, 0xffff);
    case "CRC16/XMODEM":
      return crc16ccitt(bytes, 0x0000);
    case "CRC16/X25":
      return crc16Reflected(bytes, 0x8408, 0xffff, 0xffff);
    case "CRC16/USB":
      return crc16Reflected(bytes, 0xa001, 0xffff, 0xffff);
    case "CRC16/DNP":
      return crc16Dnp(bytes);
    case "FLETCHER16":
      return fletcher16(bytes);
    // CRC32
    case "CRC32":
      return crc32(bytes, 0xedb88320);
    case "CRC32C":
      return crc32(bytes, 0x82f63b78);
  }
}

export function checksumSize(alg: ChecksumAlgorithm | LegacyAlgorithm): number {
  if (alg === "SUM8") return 1;
  return ALGORITHM_META[alg as ChecksumAlgorithm]?.size ?? 1;
}

export const CHECKSUM_ALGORITHMS: ChecksumAlgorithm[] = Object.keys(ALGORITHM_META) as ChecksumAlgorithm[];

/** 界面用：分组后的算法清单 */
export const ALGORITHM_GROUPS: { group: AlgorithmMeta["group"]; items: ChecksumAlgorithm[] }[] = [
  "累加 / 异或",
  "CRC8",
  "CRC16",
  "CRC32 / 其它",
].map((group) => ({
  group: group as AlgorithmMeta["group"],
  items: CHECKSUM_ALGORITHMS.filter((a) => ALGORITHM_META[a].group === group),
}));

/** 名称 → 说明（兼容旧名 SUM8） */
export function algorithmLabel(alg: string): string {
  if (alg === "SUM8") return ALGORITHM_META.ADD8.label;
  return ALGORITHM_META[alg as ChecksumAlgorithm]?.label ?? alg;
}
