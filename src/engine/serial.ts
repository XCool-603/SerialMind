/**
 * 串口传输层
 * - 桌面端（Tauri）：走 Rust serialport，命令 list_ports / open_port / write_port / close_port，数据经 serial://data 事件推送
 * - 浏览器：走 Web Serial（Chrome / Edge，localhost 或 https）
 * 上层接口保持一致，UI 不需要关心当前跑在哪。
 */

type DataHandler = (bytes: number[]) => void;

interface SerialLike {
  open: (opts: unknown) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
}

export interface PortEntry {
  name: string;
  detail: string;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isSerialSupported(): boolean {
  return isTauri() || (typeof navigator !== "undefined" && "serial" in navigator);
}

/* ---------------- 桌面端（Tauri） ---------------- */

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(cmd, args);
}

async function tauriListen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  const mod = await import("@tauri-apps/api/event");
  const un = await mod.listen(event, (e) => handler(e.payload));
  return un;
}

let tauriUnlisten: (() => void) | null = null;
let opened = false;

/* ---------------- 模拟设备（回环，不需要硬件） ---------------- */

export const MOCK_PORT = "__mock__";
let mockHandler: DataHandler | null = null;
let mockEcho = true;

/* ---------------- 浏览器（Web Serial） ---------------- */

let webPort: SerialLike | null = null;
let webReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let keepReading = false;

/* ---------------- 对外接口 ---------------- */

export async function listPorts(): Promise<PortEntry[]> {
  if (isTauri()) {
    const ports = await tauriInvoke<{ name: string; kind: string; detail: string }[]>("list_ports");
    return ports.map((p) => ({ name: p.name, detail: p.detail }));
  }
  if (!isSerialSupported()) return [];
  const nav = navigator as unknown as { serial: { getPorts: () => Promise<SerialLike[]> } };
  const ports = await nav.serial.getPorts();
  return ports.map((p, i) => {
    const info = p.getInfo?.() ?? {};
    const vid = info.usbVendorId?.toString(16).toUpperCase().padStart(4, "0") ?? "----";
    const pid = info.usbProductId?.toString(16).toUpperCase().padStart(4, "0") ?? "----";
    return { name: `WebSerial-${i + 1}`, detail: `USB ${vid}:${pid}` };
  });
}

export interface SerialOpts {
  path?: string;
  baud: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "odd" | "even";
  flowControl?: "none" | "hardware" | "software";
}

export async function connectSerial(opts: SerialOpts, onData: DataHandler): Promise<string> {
  if (isTauri()) {
    const path = opts.path;
    if (!path) throw new Error("请先选择端口");
    const name = await tauriInvoke<string>("open_port", {
      path,
      baud: opts.baud,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity: opts.parity ?? "none",
      flowControl: opts.flowControl ?? "none",
    });
    if (tauriUnlisten) tauriUnlisten();
    tauriUnlisten = await tauriListen("serial://data", (payload) => {
      if (Array.isArray(payload)) onData(payload as number[]);
    });
    opened = true;
    return name;
  }

  if (!isSerialSupported()) {
    throw new Error("当前环境不支持串口：桌面端请用 Tauri 版，浏览器请用 Chrome/Edge 打开 localhost");
  }
  const nav = navigator as unknown as { serial: { requestPort: () => Promise<SerialLike> } };
  webPort = await nav.serial.requestPort();
  await webPort.open({
    baudRate: opts.baud,
    dataBits: opts.dataBits ?? 8,
    stopBits: opts.stopBits ?? 1,
    parity: opts.parity ?? "none",
    flowControl: opts.flowControl ?? "none",
    bufferSize: 65536,
  });
  keepReading = true;
  opened = true;
  void webReadLoop(onData);
  return "Web Serial";
}

async function webReadLoop(onData: DataHandler) {
  if (!webPort?.readable) return;
  webReader = webPort.readable.getReader();
  try {
    while (keepReading) {
      const { value, done } = await webReader.read();
      if (done) break;
      if (value && value.length) onData(Array.from(value));
    }
  } catch {
    /* 断开时忽略 */
  } finally {
    try {
      webReader?.releaseLock();
    } catch {
      /* noop */
    }
    webReader = null;
  }
}

export async function connectMock(baud: number, onData: DataHandler): Promise<string> {
  mockHandler = onData;
  mockEcho = true;
  opened = true;
  return `模拟设备（回环）@ ${baud}`;
}

export async function writeSerial(bytes: number[]): Promise<void> {
  if (mockHandler) {
    // 回环：发出的字节原样当作收到
    setTimeout(() => mockHandler?.(bytes.slice()), 10);
    return;
  }
  if (isTauri()) {
    await tauriInvoke("write_port", { data: bytes });
    return;
  }
  if (!webPort?.writable) throw new Error("串口未打开");
  const writer = webPort.writable.getWriter();
  try {
    await writer.write(new Uint8Array(bytes));
  } finally {
    writer.releaseLock();
  }
}

export async function disconnectSerial(): Promise<void> {
  if (mockHandler) {
    mockHandler = null;
    opened = false;
    return;
  }
  if (isTauri()) {
    if (tauriUnlisten) {
      tauriUnlisten();
      tauriUnlisten = null;
    }
    await tauriInvoke("close_port");
    opened = false;
    return;
  }
  keepReading = false;
  try {
    await webReader?.cancel();
  } catch {
    /* noop */
  }
  try {
    await webPort?.close();
  } catch {
    /* noop */
  }
  webPort = null;
  opened = false;
}

export function isOpen(): boolean {
  return opened;
}
