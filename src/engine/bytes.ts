export type ByteOrder = "ABCD" | "BADC" | "CDAB" | "DCBA";

/** "01 03 0A" / "0103 0A" / "0x01,0x03" → number[] */
export function parseHex(input: string): number[] {
  const cleaned = input
    .replace(/0x/gi, " ")
    .replace(/[^0-9a-fA-F]/g, " ")
    .trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(/\s+/);
  const out: number[] = [];
  for (const t of tokens) {
    if (t.length === 1) {
      out.push(parseInt(t, 16));
    } else if (t.length % 2 === 0) {
      for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
    } else {
      out.push(parseInt(t, 16));
    }
  }
  return out.filter((n) => !Number.isNaN(n));
}

export function toHex(bytes: number[], sep = " "): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(sep);
}

export function toHexUpperNoPad(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase()).join("");
}

/** 按字节序把「大端序的字节数组」重排为实际线序 */
export function applyOrder(bigEndian: number[], order: ByteOrder): number[] {
  const n = bigEndian.length;
  if (n === 1) return bigEndian.slice();
  if (n === 2) {
    const [a, b] = bigEndian;
    return order === "ABCD" ? [a, b] : [b, a];
  }
  if (n === 4) {
    const [a, b, c, d] = bigEndian;
    switch (order) {
      case "ABCD":
        return [a, b, c, d];
      case "BADC":
        return [b, a, d, c];
      case "CDAB":
        return [c, d, a, b];
      case "DCBA":
        return [d, c, b, a];
    }
  }
  // 其它长度：仅 ABCD / DCBA 有意义
  return order === "DCBA" ? bigEndian.slice().reverse() : bigEndian.slice();
}

/** 把线序字节还原成大端序 */
export function undoOrder(wire: number[], order: ByteOrder): number[] {
  const n = wire.length;
  if (n === 1) return wire.slice();
  if (n === 2) {
    const [a, b] = wire;
    return order === "ABCD" ? [a, b] : [b, a];
  }
  if (n === 4) {
    const [a, b, c, d] = wire;
    switch (order) {
      case "ABCD":
        return [a, b, c, d];
      case "BADC":
        return [b, a, d, c];
      case "CDAB":
        return [c, d, a, b];
      case "DCBA":
        return [d, c, b, a];
    }
  }
  return order === "DCBA" ? wire.slice().reverse() : wire.slice();
}

export function bigEndianBytes(value: number, size: number): number[] {
  const out: number[] = [];
  let v = value;
  for (let i = size - 1; i >= 0; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

export function readBigEndian(bytes: number[], signed = false): number {
  let v = 0;
  for (const b of bytes) v = v * 256 + (b & 0xff);
  if (signed) {
    const bits = bytes.length * 8;
    const max = Math.pow(2, bits - 1);
    if (v >= max) v -= Math.pow(2, bits);
  }
  return v;
}

export function asciiView(bytes: number[]): string {
  return bytes.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "·")).join("");
}

export function bitsOf(byte: number, from: number, to: number): number {
  const width = from - to + 1;
  const mask = (1 << width) - 1;
  return (byte >> to) & mask;
}
