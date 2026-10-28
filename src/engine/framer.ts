/**
 * 流式分帧器：把串口收到的连续字节切成"帧"
 *
 * 没有它，收到的数据块会当成一帧直接解码——Modbus 碰巧能对上，
 * 但带帧头 / 长度字段 / 变长数据域的 PLC 协议必然解错。
 *
 * 支持：帧头对齐、长度字段、定长、分隔符、静默间隔（由外部定时 flush）
 */
import { readBigEndian } from "./bytes";
import { messageLength, type PdlProtocol } from "./pdl";

function hexToBytes(hex?: string): number[] {
  if (!hex) return [];
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

function indexOfSeq(hay: number[], needle: number[], from = 0): number {
  if (!needle.length) return from;
  for (let i = from; i <= hay.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

export class FrameSplitter {
  private buf: number[] = [];
  private lastAt = 0;
  private droppedCount = 0;

  constructor(private getProto: () => PdlProtocol) {}

  get pending(): number {
    return this.buf.length;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  reset(): void {
    this.buf = [];
    this.lastAt = 0;
    this.droppedCount = 0;
  }

  /** 收到字节：返回已切出的完整帧 */
  push(bytes: number[], now = Date.now()): number[][] {
    if (!bytes.length) return [];
    this.buf.push(...bytes);
    this.lastAt = now;
    return this.drain();
  }

  /** 静默间隔模式：由外部定时调用，间隔到了就把缓冲作为一帧吐出 */
  flushIdle(now = Date.now()): number[][] {
    const proto = this.getProto();
    if (proto.framing.mode !== "silence-gap") return [];
    if (!this.buf.length) return [];
    if (now - this.lastAt < (proto.framing.gapMs || 20)) return [];
    const out = [this.buf.slice()];
    this.buf = [];
    return out;
  }

  /** 缓冲里还有多少字节、最后一次收到数据是多久前 */
  get idleMs(): number {
    return this.lastAt ? Date.now() - this.lastAt : 0;
  }

  /**
   * 兜底：按协议分不出帧、但缓冲已经等了很久 → 原样吐出
   * （否则协议配错时会出现"收不到任何消息"的假死）
   */
  takeStale(staleMs = 200): number[] | null {
    if (!this.buf.length) return null;
    if (this.idleMs < staleMs) return null;
    const out = this.buf.slice();
    this.buf = [];
    return out;
  }

  private drain(): number[][] {
    const out: number[][] = [];
    const proto = this.getProto();
    const framing = proto.framing;
    const prefix = hexToBytes(framing.prefix);
    let guard = 0;

    while (this.buf.length && guard++ < 500) {
      // 1) 对齐帧头
      if (prefix.length) {
        const idx = indexOfSeq(this.buf, prefix);
        if (idx < 0) {
          // 没有完整帧头：保留可能是半个帧头的尾部，其余丢弃
          const keep = Math.min(this.buf.length, prefix.length - 1);
          this.droppedCount += this.buf.length - keep;
          this.buf = keep ? this.buf.slice(this.buf.length - keep) : [];
          break;
        }
        if (idx > 0) {
          this.droppedCount += idx;
          this.buf = this.buf.slice(idx);
        }
      }

      // 2) 判断这一帧有多长
      const total = this.frameTotal(proto, prefix.length);
      if (total === null) break; // 数据还不够
      if (total <= 0 || total > 8192) {
        this.buf.shift();
        this.droppedCount++;
        continue;
      }
      if (this.buf.length < total) break; // 等后续字节

      out.push(this.buf.slice(0, total));
      this.buf = this.buf.slice(total);
    }

    if (this.buf.length > 65536) {
      this.droppedCount += this.buf.length;
      this.buf = [];
    }
    return out;
  }

  private frameTotal(proto: PdlProtocol, prefixLen: number): number | null {
    const framing = proto.framing;
    const msg = proto.messages[0];

    if (framing.mode === "fixed") {
      const len = messageLength(msg);
      return len > 0 ? len : null;
    }

    if (framing.mode === "length-field") {
      const lf = framing.lengthField;
      if (!lf) return null;
      const start = prefixLen + lf.offset;
      const need = start + lf.size;
      if (this.buf.length < need) return null;
      const declared = readBigEndian(this.buf.slice(start, start + lf.size), false);
      if (!declared) return 0;
      // includesHeader 默认 true：长度字段就是整帧字节数
      return lf.includesHeader === false ? prefixLen + declared : declared;
    }

    if (framing.mode === "delimiter") {
      const suffix = hexToBytes(framing.suffix ?? framing.delimiter);
      if (!suffix.length) return null;
      const idx = indexOfSeq(this.buf, suffix, prefixLen);
      return idx < 0 ? null : idx + suffix.length;
    }

    // silence-gap / script 由 flushIdle 负责
    return null;
  }
}
