import { create } from "zustand";
import { appendChecksum, decodeFrame, encodeMessage } from "./codec";
import { BINARY_PROTOCOL, CRANE_PROTOCOL, RAW_PROTOCOL, templateById, type PdlProtocol } from "./pdl";
import { parseHex, stringToBytes } from "./bytes";
import { initDb } from "./db";
import { appendRun, clearRunsTable, isEmpty, loadRuns, loadWorkspace, persist, uuid } from "./repo";
import { loadHealth, saveHealth, loadHistory, pushHistory, clearHistory, type HealthRecord } from "./health";
import { stepsToYaml } from "./yaml";
import { runCase, runSuite, type RunnerHost } from "./runner";
import { FrameSplitter } from "./framer";
import type {
  CaseItem,
  CaseStep,
  Connection,
  Frame,
  ProductItem,
  RoleItem,
  RuleItem,
  RunResult,
  Source,
  StepResult,
  SubProductItem,
  SuiteItem,
  QuickSendItem,
  ViewKey,
  ViewMode,
} from "./types";
import type { DialogState } from "./dialog";

export type {
  CaseItem,
  CaseStep,
  Connection,
  Frame,
  ProductItem,
  RoleItem,
  RuleItem,
  RunResult,
  Source,
  StepResult,
  SubProductItem,
  SuiteItem,
  QuickSendItem,
  ViewKey,
  ViewMode,
};

export type DbStatus = "loading" | "ready" | "error";

const VIEW_KEYS: ViewKey[] = ["terminal", "protocol", "case", "report"];
function initialView(): ViewKey {
  if (typeof window === "undefined") return "terminal";
  const h = window.location.hash.replace("#", "") as ViewKey;
  return VIEW_KEYS.includes(h) ? h : "terminal";
}

/* ---------------- 帧 ---------------- */

let frameId = 1;
let frameNo = 1;

function nowTime(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function mkFrame(partial: Omit<Frame, "id" | "time" | "ts" | "no"> & { time?: string }): Frame {
  return { id: frameId++, time: partial.time ?? nowTime(), ts: Date.now(), no: frameNo++, ...partial } as Frame;
}

/* ---------------- 分桶（按产品隔离） ---------------- */

interface Bucket {
  subProducts: SubProductItem[];
  roles: RoleItem[];
  protocols: PdlProtocol[];
  rules: RuleItem[];
  cases: CaseItem[];
  suites: SuiteItem[];
}

const emptyBucket = (): Bucket => ({ subProducts: [], roles: [], protocols: [], rules: [], cases: [], suites: [] });

/* ---------------- 规则引擎 ---------------- */

const ruleLastFire = new Map<string, number>();

/** 流式分帧器：串口字节流 → 完整帧 */
let splitter: FrameSplitter | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function stopFlushTimer() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

function parseEvery(trigger: string): number | null {
  const m = trigger.match(/每\s*(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (!m) return null;
  const v = Number(m[1]);
  return m[2].toLowerCase() === "s" ? v * 1000 : v;
}

/* ---------------- 步骤 → YAML ---------------- */

export { stepsToYaml } from "./yaml";
/* ---------------- Store ---------------- */

interface State {
  dbStatus: DbStatus;
  /** 数据库出错时的原始信息（状态栏可见） */
  dbError: string;
  /** 清空本地数据库并重启 */
  resetDatabase: () => Promise<void>;
  /** 发送时自动补校验和（手动 HEX 发送框 / 用例 raw 步骤） */
  autoChecksum: boolean;
  setAutoChecksum: (v: boolean) => void;
  /** 自动补校验时用的算法（独立于协议，默认跟随协议） */
  checksumAlgorithm: string;
  setChecksumAlgorithm: (v: string) => void;

  products: ProductItem[];
  activeProductId: string;
  subProducts: SubProductItem[];
  activeSubProductId: string;
  roles: RoleItem[];
  activeRoleId: string;
  protocols: PdlProtocol[];
  activeProtocolId: string;
  rules: RuleItem[];
  cases: CaseItem[];
  suites: SuiteItem[];

  connection: Connection;

  frames: Frame[];
  runs: RunResult[];
  running: boolean;
  liveSteps: StepResult[];
  runningCaseId: string;
  runningSuiteName: string;

  selectedFrameId: number | null;
  filter: "all" | Source;
  viewMode: ViewMode;
  activeView: ViewKey;
  inspectorTab: "fields" | "curve" | "rules";
  autoSend: boolean;
  aiLevel: string;
  paused: boolean;
  sendInput: string;
  rxCount: number;
  txCount: number;
  totalFrames: number;
  roundTripFailed: boolean;
  showRoundTripModal: boolean;
  fixOrderSeq: number;
  requestOrderFix: () => void;
  forceSaveSeq: number;
  requestForceSave: () => void;
  activeCaseId: string;
  activeSuiteId: string;
  serialMsg: string;
  availablePorts: { name: string; detail: string }[];
  showSelfTest: boolean;
  /** 最近一次整机验收结果（本机持久化） */
  health: HealthRecord | null;
  /** 测试页当前模式：用例 / 套件 */
  caseTab: "cases" | "suites";
  /** 验收历史（项目交付记录，最多 20 条） */
  history: HealthRecord[];

  dialog: DialogState | null;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;

  aiOpen: boolean;
  toggleAi: () => void;
  applyDraft: (p: PdlProtocol) => void;

  init: () => Promise<void>;
  refreshPorts: () => Promise<void>;
  connectPort: (port?: string, baud?: number) => Promise<void>;
  /** 改串口参数（数据位/停止位/校验/流控），自动记住 */
  setSerialParam: (patch: Partial<Pick<Connection, "dataBits" | "stopBits" | "parity" | "flowControl">>) => void;
  disconnectPort: () => Promise<void>;
  sendBytes: (bytes: number[], source?: Source) => Promise<void>;
  tickRules: () => void;

  createProduct: (name: string) => void;
  renameProduct: (id: string, name: string) => void;
  deleteProduct: (id: string) => void;
  switchProduct: (id: string) => void;

  createSubProduct: (name: string, templateId?: string) => void;
  duplicateSubProduct: (id: string) => void;
  duplicateRole: (id: string) => void;
  duplicateRule: (id: string) => void;
  duplicateSuite: (id: string) => void;
  /** 拖拽移动：同父排序，跨父则改归属 */
  moveNode: (kind: "subProduct" | "role" | "rule" | "case" | "suite" | "protocol", draggedId: string, targetId: string) => void;
  /** 请求停止正在跑的无循环用例 */
  stopRequested: boolean;
  requestStop: () => void;
  /** 直接发送某个协议（用字段默认值组包） */
  sendProtocol: (protoId: string) => Promise<void>;
  updateSubProduct: (id: string, patch: Partial<SubProductItem>) => void;
  deleteSubProduct: (id: string) => void;
  setActiveSubProduct: (id: string) => void;

  createRole: (input: { name: string; address: number; note?: string }) => void;
  updateRole: (id: string, patch: Partial<RoleItem>) => void;
  deleteRole: (id: string) => void;

  createProtocol: (name: string, templateId?: string) => void;
  updateProtocol: (id: string, patch: Partial<PdlProtocol>) => void;
  duplicateProtocol: () => void;
  deleteProtocol: (id: string) => void;

  createCase: (name: string) => void;
  updateCase: (caseId: string, patch: Partial<CaseItem>) => void;
  updateCaseSteps: (caseId: string, steps: CaseStep[]) => void;
  duplicateCase: (id: string) => void;
  deleteCase: (id: string) => void;

  createRule: (name: string, trigger: string, action: string) => void;
  updateRule: (id: string, patch: Partial<RuleItem>) => void;
  deleteRule: (id: string) => void;

  createSuite: (name: string, tag?: string) => void;
  deleteSuite: (id: string) => void;

  runActiveCase: () => Promise<void>;
  runActiveSuite: () => Promise<void>;
  runFailedCases: () => Promise<void>;
  clearRuns: () => void;

  setView: (v: ViewKey) => void;
  setFilter: (f: "all" | Source) => void;
  setViewMode: (m: ViewMode) => void;
  setInspectorTab: (t: "fields" | "curve" | "rules") => void;
  selectFrame: (id: number) => void;
  togglePause: () => void;
  toggleAutoSend: () => void;
  setSendInput: (v: string) => void;
  sendCurrent: () => void;
  clearFrames: () => void;
  setActiveRole: (id: string) => void;
  setActiveProtocol: (id: string) => void;
  setActiveCase: (id: string) => void;
  setActiveSuite: (id: string) => void;
  toggleRule: (id: string) => void;
  pushFrame: (f: Omit<Frame, "id" | "time" | "ts" | "no">) => void;
  setRoundTripFailed: (v: boolean) => void;
  setShowRoundTripModal: (v: boolean) => void;
  setShowSelfTest: (v: boolean) => void;
  setHealth: (rec: Omit<HealthRecord, "version">) => void;
  setCaseTab: (v: "cases" | "suites") => void;
  clearAcceptanceHistory: () => void;
  // SSCom 风格发送与终端模式
  sendMode: "hex" | "text";
  setSendMode: (m: "hex" | "text") => void;
  sendNewline: boolean;
  setSendNewline: (v: boolean) => void;
  clearOnSend: boolean;
  setClearOnSend: (v: boolean) => void;
  periodSend: boolean;
  periodMs: number;
  setPeriodMs: (ms: number) => void;
  togglePeriodSend: () => void;
  termViewMode: "stream" | "table";
  setTermViewMode: (m: "stream" | "table") => void;
  showTimestamp: boolean;
  setShowTimestamp: (v: boolean) => void;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  resetCounters: () => void;
  quickSends: QuickSendItem[];
  addQuickSend: (item?: Partial<QuickSendItem>) => void;
  updateQuickSend: (id: string, patch: Partial<QuickSendItem>) => void;
  deleteQuickSend: (id: string) => void;
  loopingQuick: boolean;
  loopIntervalMs: number;
  setLoopIntervalMs: (ms: number) => void;
  toggleLoopQuickSend: () => void;
  currentLoopIndex: number;
}

const DEFAULT_QUICK_SENDS: QuickSendItem[] = [
  { id: "qs1", enabled: true, hex: false, content: "AT", note: "AT 测试握手" },
  { id: "qs2", enabled: true, hex: false, content: "AT+CSQ", note: "查询信号强度" },
  { id: "qs3", enabled: false, hex: false, content: "AT+GMR", note: "固件版本查询" },
  { id: "qs4", enabled: false, hex: true, content: "01 03 00 00 00 02 C4 0B", note: "Modbus 读保持寄存器" },
  { id: "qs5", enabled: false, hex: true, content: "01 06 00 01 00 01 19 CA", note: "Modbus 写单个寄存器" },
];

function loadQuickSends(): QuickSendItem[] {
  if (typeof window === "undefined") return DEFAULT_QUICK_SENDS;
  try {
    const raw = localStorage.getItem("serialmind_quick_sends");
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_QUICK_SENDS;
}

function saveQuickSends(items: QuickSendItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("serialmind_quick_sends", JSON.stringify(items));
  } catch {}
}

let periodTimer: ReturnType<typeof setInterval> | null = null;
let loopQuickTimer: ReturnType<typeof setInterval> | null = null;

const buckets: Record<string, Bucket> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const s = get();
      buckets[s.activeProductId] = {
        subProducts: s.subProducts,
        roles: s.roles,
        protocols: s.protocols,
        rules: s.rules,
        cases: s.cases,
        suites: s.suites,
      };
      const all = Object.values(buckets);
      void persist({
        products: s.products,
        subProducts: all.flatMap((b) => b.subProducts),
        roles: all.flatMap((b) => b.roles),
        protocols: all.flatMap((b) => b.protocols).map((p) => ({
          id: p.id,
          productId: p.productId ?? s.activeProductId,
          subProductId: p.subProductId ?? "",
          name: p.name,
          version: p.version,
          pdlJson: JSON.stringify(p),
        })),
        cases: all.flatMap((b) => b.cases),
        suites: all.flatMap((b) => b.suites),
        rules: all.flatMap((b) => b.rules),
      }).catch((e: Error) => {
        console.warn("[db] 保存失败", e);
        set({ serialMsg: `保存失败：${e?.message ?? "未知"}` });
      });
    }, 350);
  };

  const host: RunnerHost = {
    getProtocol: () => {
      const s = get();
      // 只认「当前选中的协议」；没有就退回原始字节模式，绝不拿 Modbus 示例去解别人的帧
      const hit = s.protocols.find((p) => p.id === s.activeProtocolId);
      // 没选中就按原始字节，绝不猜一个协议去解别人的帧
      return hit ?? RAW_PROTOCOL;
    },
    getAllProtocols: () => get().protocols,
    getFrames: () => get().frames,
    pushFrame: (f) => get().pushFrame(f),
    write: async (bytes) => {
      const m = await import("./serial");
      if (!m.isOpen()) throw new Error("串口未连接");
      await m.writeSerial(bytes);
    },
    isLinkOpen: () => get().connection.connected,
    autoChecksum: () => get().autoChecksum,
    shouldStop: () => get().stopRequested,
    onStep: (_caseId, _i, res) => set((s) => ({ liveSteps: [...s.liveSteps, res] })),
  };

  return {
    dbStatus: "loading",
    dbError: "",
    stopRequested: false,
    requestStop: () => set({ stopRequested: true, serialMsg: "正在停止…" }),
    autoChecksum: true,
    setAutoChecksum: (v) => set({ autoChecksum: v }),
    checksumAlgorithm: "ADD8",
    setChecksumAlgorithm: (v) => set({ checksumAlgorithm: v }),
    resetDatabase: async () => {
      const { wipeDb } = await import("./db");
      await wipeDb();
      window.location.reload();
    },

    products: [],
    activeProductId: "",
    subProducts: [],
    activeSubProductId: "",
    roles: [],
    activeRoleId: "",
    protocols: [],
    activeProtocolId: "",
    rules: [],
    cases: [],
    suites: [],

    connection: (() => {
      const def: Connection = { port: "", baud: 115200, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none", frame: "8N1", connected: false };
      try {
        const saved = localStorage.getItem("serialmind.serial");
        if (!saved) return def;
        const o = JSON.parse(saved) as Partial<Connection>;
        const c = { ...def, ...o, connected: false };
        c.frame = `${c.dataBits}${c.parity === "odd" ? "O" : c.parity === "even" ? "E" : "N"}${c.stopBits}`;
        return c;
      } catch {
        return def;
      }
    })(),

    frames: [],
    runs: [],
    running: false,
    liveSteps: [],
    runningCaseId: "",
    runningSuiteName: "",

    selectedFrameId: null,
    filter: "all",
    viewMode: "hex",
    activeView: initialView(),
    inspectorTab: "fields",
    autoSend: false,
    aiLevel: "L1",
    paused: false,
    sendInput: "",
    rxCount: 0,
    txCount: 0,
    totalFrames: 0,
    sendMode: "text",
    sendNewline: true,
    clearOnSend: false,
    periodSend: false,
    periodMs: 1000,
    termViewMode: "stream",
    showTimestamp: true,
    autoScroll: true,
    quickSends: loadQuickSends(),
    loopingQuick: false,
    loopIntervalMs: 200,
    currentLoopIndex: -1,
    roundTripFailed: false,
    showRoundTripModal:
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("modal") === "1",
    fixOrderSeq: 0,
    requestOrderFix: () => set((s) => ({ fixOrderSeq: s.fixOrderSeq + 1, showRoundTripModal: false })),
    forceSaveSeq: 0,
    requestForceSave: () => set((s) => ({ forceSaveSeq: s.forceSaveSeq + 1, showRoundTripModal: false })),
    activeCaseId: "",
    activeSuiteId: "",
    serialMsg: "就绪",
    availablePorts: [],
    showSelfTest: false,
  health: loadHealth(),
  history: loadHistory(),
  caseTab: "cases",

    dialog: null,
    openDialog: (d) => set({ dialog: d }),
    closeDialog: () => set({ dialog: null }),

    aiOpen: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ai") === "1",
    toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen })),
    applyDraft: (p) => {
      const s = get();
      const spId = s.activeSubProductId || s.subProducts[0]?.id || "";
      set((st) => ({
        protocols: [{ ...p, productId: st.activeProductId }, ...st.protocols],
        activeProtocolId: p.id,
        subProducts: spId ? st.subProducts.map((sp) => (sp.id === spId ? { ...sp, protocolId: p.id } : sp)) : st.subProducts,
        activeView: "protocol",
        aiOpen: false,
        serialMsg: `已应用草稿「${p.name}」（${p.messages[0]?.fields.length ?? 0} 字段）`,
      }));
      scheduleSave();
    },

    init: async () => {
      try {
        await initDb();
        if (isEmpty()) {
          set({ dbStatus: "ready", serialMsg: "数据库已就绪 —— 先新建一个产品" });
          return;
        }
        const w = loadWorkspace();
        const products = w.products;
        if (!products.length) {
          set({ dbStatus: "ready", serialMsg: "数据库已就绪 —— 先新建一个产品" });
          return;
        }
        const activeProductId = products[0].id;
        const protocols: PdlProtocol[] = w.protocols.map((p) => {
          try {
            return { ...(JSON.parse(p.pdlJson) as PdlProtocol), productId: p.productId, subProductId: p.subProductId, version: p.version, name: p.name };
          } catch {
            return { ...CRANE_PROTOCOL, id: p.id, name: p.name, version: p.version, productId: p.productId, subProductId: p.subProductId };
          }
        });
        for (const p of products) {
          buckets[p.id] = {
            subProducts: w.subProducts.filter((x) => x.productId === p.id),
            roles: w.roles.filter((r) => w.subProducts.some((sp) => sp.id === r.subProductId && sp.productId === p.id)),
            protocols: protocols.filter((x) => (x.productId ?? activeProductId) === p.id),
            rules: w.rules.filter((r) => w.subProducts.some((sp) => sp.id === r.subProductId && sp.productId === p.id)),
            cases: w.cases.filter((c) => w.subProducts.some((sp) => sp.id === c.subProductId && sp.productId === p.id)),
            suites: w.suites.filter((s) => s.productId === p.id),
          };
        }
        const b = buckets[activeProductId];
        const sp = b.subProducts[0];
        set({
          dbStatus: "ready",
          products,
          activeProductId,
          subProducts: b.subProducts,
          activeSubProductId: sp?.id ?? "",
          roles: b.roles,
          activeRoleId: b.roles[0]?.id ?? "",
          protocols: b.protocols,
          activeProtocolId:
            b.protocols.find((p) => p.id === sp?.protocolId)?.id ??
            b.protocols.find((p) => p.subProductId === sp?.id)?.id ??
            b.protocols[0]?.id ??
            "",
          rules: b.rules,
          cases: b.cases,
          suites: b.suites,
          activeCaseId: b.cases[0]?.id ?? "",
          activeSuiteId: b.suites[0]?.id ?? "",
          runs: loadRuns(200),
          serialMsg: `已载入：${products.length} 产品 · ${w.subProducts.length} 子产品 · ${w.roles.length} 角色 · ${w.cases.length} 用例`,
        });
      } catch (e) {
        set({ dbStatus: "error", serialMsg: `数据库初始化失败：${(e as Error).message}` });
      }
    },

    refreshPorts: async () => {
      try {
        const m = await import("./serial");
        const ports = await m.listPorts();
        set({
          availablePorts: ports,
          serialMsg: ports.length ? `发现 ${ports.length} 个串口：${ports.map((p) => p.name).join(" / ")}` : "未发现可用串口",
        });
      } catch (e) {
        set({ serialMsg: `枚举串口失败：${(e as Error).message}` });
      }
    },

    /* ---------- 运行时连接：顶栏选口 ---------- */
    connectPort: async (port, baud) => {
      const s = get();
      const targetPort = port ?? s.connection.port;
      const targetBaud = baud ?? s.connection.baud;
      if (!targetPort) {
        set({ serialMsg: "请先在顶栏选择一个串口" });
        return;
      }
      try {
        const { connectSerial, connectMock, MOCK_PORT } = await import("./serial");
        const proto = host.getProtocol();
        splitter = new FrameSplitter(() => host.getProtocol());
        const emit = (frame: number[], warn?: string) => {
          const allProtocols = get().protocols;
          let activeProto = allProtocols.find((p) => p.id === get().activeProtocolId) ?? allProtocols[0] ?? host.getProtocol();
          let d = decodeFrame(activeProto, frame);

          if ((!d.matched || !d.crcOk) && allProtocols.length > 1) {
            for (const op of allProtocols) {
              if (op.id === activeProto.id) continue;
              const probe = decodeFrame(op, frame);
              if (probe.matched && probe.crcOk) {
                activeProto = op;
                d = probe;
                break;
              }
            }
          }

          get().pushFrame({
            dir: "rx",
            source: "device",
            bytes: frame,
            crcOk: d.crcOk,
            matched: d.matched,
            fields: d.fields,
            crcExpected: d.crcExpected,
            crcActual: d.crcActual,
            banner: warn ?? d.matchError ?? (!d.lengthOk ? `长度不符：${d.lengthError}` : undefined),
            protocolName: activeProto?.name,
            protocolId: activeProto?.id,
          });
        };
        const onBytes = (bytes: number[]) => {
          if (!splitter) return;
          for (const frame of splitter.push(bytes)) emit(frame);
        };
        const name =
          targetPort === MOCK_PORT
            ? await connectMock(targetBaud, onBytes)
            : await connectSerial(
                {
                  path: targetPort,
                  baud: targetBaud,
                  dataBits: s.connection.dataBits,
                  stopBits: s.connection.stopBits,
                  parity: s.connection.parity,
                  flowControl: s.connection.flowControl,
                },
                onBytes,
              );

        // 定时分帧：静默间隔模式按间隔吐；其他模式若长时间分不出帧，原样吐出
        stopFlushTimer();
        flushTimer = setInterval(() => {
          if (!splitter) return;
          for (const frame of splitter.flushIdle()) emit(frame);
          const stale = splitter.takeStale(250);
          if (stale) emit(stale, "未按协议分出帧，按原始字节显示");
        }, 15);
        set((st) => ({
          connection: { ...st.connection, port: targetPort, baud: targetBaud, connected: true },
          serialMsg: `已连接 ${name} @ ${targetBaud}`,
        }));
        // onConnect 规则触发一次
        for (const r of get().rules) {
          if (r.enabled && /onConnect|连接建立/i.test(r.trigger)) {
            ruleLastFire.set(r.id, Date.now());
            const msg = proto.messages.find((m) => m.id === "read_req") ?? proto.messages[0];
            void get().sendBytes(encodeMessage(proto, msg, {}), "trigger");
            set((st) => ({ rules: st.rules.map((x) => (x.id === r.id ? { ...x, hits: x.hits + 1, lastRun: nowTime() } : x)) }));
          }
        }
      } catch (e) {
        set({ serialMsg: `连接失败：${(e as Error).message}` });
      }
    },

    setSerialParam: (patch) => {
      set((st) => {
        const c = { ...st.connection, ...patch };
        c.frame = `${c.dataBits}${c.parity === "odd" ? "O" : c.parity === "even" ? "E" : "N"}${c.stopBits}`;
        try {
          localStorage.setItem("serialmind.serial", JSON.stringify({ baud: c.baud, dataBits: c.dataBits, stopBits: c.stopBits, parity: c.parity, flowControl: c.flowControl }));
        } catch {
          /* noop */
        }
        return { connection: c, serialMsg: `串口参数 ${c.frame}` };
      });
    },

    disconnectPort: async () => {
      stopFlushTimer();
      splitter?.reset();
      try {
        const { disconnectSerial } = await import("./serial");
        await disconnectSerial();
      } catch {
        /* noop */
      }
      set((s) => ({ connection: { ...s.connection, connected: false }, serialMsg: "已断开" }));
    },

    sendBytes: async (bytes, source = "manual") => {
      const allProtocols = get().protocols;
      let proto = allProtocols.find((p) => p.id === get().activeProtocolId) ?? allProtocols[0] ?? host.getProtocol();
      let d = decodeFrame(proto, bytes);
      if ((!d.matched || !d.crcOk) && allProtocols.length > 1) {
        for (const op of allProtocols) {
          if (op.id === proto.id) continue;
          const probe = decodeFrame(op, bytes);
          if (probe.matched && probe.crcOk) {
            proto = op;
            d = probe;
            break;
          }
        }
      }
      get().pushFrame({
        dir: "tx",
        source,
        bytes,
        crcOk: d.crcOk,
        matched: d.matched,
        fields: d.fields,
        crcExpected: d.crcExpected,
        crcActual: d.crcActual,
        banner: d.matchError ?? (!d.lengthOk ? `长度不符：${d.lengthError}` : undefined),
        protocolName: proto?.name,
        protocolId: proto?.id,
      });
      const m = await import("./serial");
      if (!m.isOpen()) return;
      try {
        await m.writeSerial(bytes);
      } catch (e) {
        set({ serialMsg: `发送失败：${(e as Error).message}` });
      }
    },

    tickRules: () => {
      const s = get();
      if (!s.autoSend || s.paused) return;
      const proto = s.protocols.find((p) => p.id === s.activeProtocolId);
      if (!proto) return;
      const now = Date.now();
      for (const r of s.rules) {
        if (!r.enabled) continue;
        const period = parseEvery(r.trigger);
        if (!period) continue;
        const last = ruleLastFire.get(r.id) ?? 0;
        if (now - last < period) continue;
        ruleLastFire.set(r.id, now);
        const msg = proto.messages.find((m) => m.id === "read_req") ?? proto.messages[0];
        void get().sendBytes(encodeMessage(proto, msg, {}), "period");
        set((st) => ({ rules: st.rules.map((x) => (x.id === r.id ? { ...x, hits: x.hits + 1, lastRun: nowTime() } : x)) }));
      }
    },

    /* ---------- 产品 ---------- */
    createProduct: (name) => {
      const id = uuid();
      buckets[id] = emptyBucket();
      buckets[id].suites = [
        { id: uuid(), productId: id, name: "冒烟", count: 0, desc: "带「冒烟」标签的用例", tag: "冒烟" },
        { id: uuid(), productId: id, name: "全量回归", count: 0, desc: "该产品全部用例" },
      ];
      set((s) => ({ products: [...s.products, { id, name }] }));
      get().switchProduct(id);
      set({ serialMsg: `已创建产品「${name}」` });
      scheduleSave();
    },
    renameProduct: (id, name) => {
      set((s) => ({ products: s.products.map((p) => (p.id === id ? { ...p, name } : p)) }));
      scheduleSave();
    },
    deleteProduct: (id) => {
      const s = get();
      if (s.products.length <= 1) {
        set({ serialMsg: "至少保留一个产品" });
        return;
      }
      delete buckets[id];
      const rest = s.products.filter((p) => p.id !== id);
      set({ products: rest });
      if (s.activeProductId === id) get().switchProduct(rest[0].id);
      else scheduleSave();
    },
    switchProduct: (id) => {
      const s = get();
      if (id === s.activeProductId) return;
      if (s.activeProductId) {
        buckets[s.activeProductId] = {
          subProducts: s.subProducts,
          roles: s.roles,
          protocols: s.protocols,
          rules: s.rules,
          cases: s.cases,
          suites: s.suites,
        };
      }
      const b = buckets[id] ?? emptyBucket();
      buckets[id] = b;
      const sp = b.subProducts[0];
      set({
        activeProductId: id,
        subProducts: b.subProducts,
        activeSubProductId: sp?.id ?? "",
        roles: b.roles,
        activeRoleId: b.roles[0]?.id ?? "",
        protocols: b.protocols,
        activeProtocolId: sp?.protocolId || b.protocols[0]?.id || "",
        rules: b.rules,
        cases: b.cases,
        suites: b.suites,
        activeCaseId: b.cases[0]?.id ?? "",
        activeSuiteId: b.suites[0]?.id ?? "",
        frames: [],
        rxCount: 0,
        txCount: 0,
        totalFrames: 0,
    sendMode: "text",
    sendNewline: true,
    clearOnSend: false,
    periodSend: false,
    periodMs: 1000,
    termViewMode: "stream",
    showTimestamp: true,
    autoScroll: true,
    quickSends: loadQuickSends(),
    loopingQuick: false,
    loopIntervalMs: 200,
    currentLoopIndex: -1,
        serialMsg: `已切换到「${s.products.find((p) => p.id === id)?.name ?? id}」`,
      });
    },

    /* ---------- 排序 / 复制 / 直发 ---------- */
    moveNode: (kind, draggedId, targetId) => {
      const s = get();
      const idx = (arr: { id: string }[], id: string) => arr.findIndex((x) => x.id === id);

      if (kind === "protocol") {
        const from = s.protocols.find((p) => p.id === draggedId);
        const to = s.protocols.find((p) => p.id === targetId);
        if (!from || !to || draggedId === targetId) return;
        const rest = s.protocols.filter((p) => p.id !== draggedId);
        const moved = { ...from, subProductId: to.subProductId };
        const at = rest.findIndex((p) => p.id === targetId);
        rest.splice(at < 0 ? rest.length : at, 0, moved);
        set({ protocols: rest.map((p, i) => ({ ...p, order: i })), serialMsg: `已把「${from.name}」移到「${s.subProducts.find((x) => x.id === to.subProductId)?.name ?? ""}」下` });
        scheduleSave();
        return;
      }

      if (kind === "role") {
        const from = s.roles.find((r) => r.id === draggedId);
        const to = s.roles.find((r) => r.id === targetId);
        if (!from || !to || draggedId === targetId) return;
        const rest = s.roles.filter((r) => r.id !== draggedId);
        const moved = { ...from, subProductId: to.subProductId };
        const at = rest.findIndex((r) => r.id === targetId);
        rest.splice(at < 0 ? rest.length : at, 0, moved);
        set({ roles: rest.map((r, i) => ({ ...r, order: i })), serialMsg: "已移动角色" });
        scheduleSave();
        return;
      }

      if (kind === "rule") {
        const from = s.rules.find((r) => r.id === draggedId);
        const to = s.rules.find((r) => r.id === targetId);
        if (!from || !to || draggedId === targetId) return;
        const rest = s.rules.filter((r) => r.id !== draggedId);
        const moved = { ...from, subProductId: to.subProductId };
        const at = rest.findIndex((r) => r.id === targetId);
        rest.splice(at < 0 ? rest.length : at, 0, moved);
        set({ rules: rest.map((r, i) => ({ ...r, order: i })), serialMsg: "已移动规则" });
        scheduleSave();
        return;
      }

      if (kind === "case") {
        const from = s.cases.find((c) => c.id === draggedId);
        const to = s.cases.find((c) => c.id === targetId);
        if (!from || !to || draggedId === targetId) return;
        const rest = s.cases.filter((c) => c.id !== draggedId);
        // 跨子产品时，原角色不属于新子产品 → 解绑
        const sameParent = from.subProductId === to.subProductId;
        const moved = { ...from, subProductId: to.subProductId, roleId: sameParent ? from.roleId : "" };
        const at = rest.findIndex((c) => c.id === targetId);
        rest.splice(at < 0 ? rest.length : at, 0, moved);
        set({ cases: rest.map((c, i) => ({ ...c, order: i })), serialMsg: sameParent ? "已移动用例" : "已把用例移到另一个子产品（角色已解绑）" });
        scheduleSave();
        return;
      }

      if (kind === "suite") {
        const rest = s.suites.filter((x) => x.id !== draggedId);
        const from = s.suites.find((x) => x.id === draggedId);
        if (!from) return;
        const at = rest.findIndex((x) => x.id === targetId);
        rest.splice(at < 0 ? rest.length : at, 0, from);
        set({ suites: rest.map((x, i) => ({ ...x, order: i })) });
        scheduleSave();
        return;
      }

      if (kind === "subProduct") {
        const rest = s.subProducts.filter((x) => x.id !== draggedId);
        const from = s.subProducts.find((x) => x.id === draggedId);
        if (!from) return;
        const at = rest.findIndex((x) => x.id === targetId);
        rest.splice(at < 0 ? rest.length : at, 0, from);
        set({ subProducts: rest.map((x, i) => ({ ...x, order: i })) });
        scheduleSave();
      }
      void idx;
    },

    duplicateSubProduct: (id) => {
      const s = get();
      const base = s.subProducts.find((x) => x.id === id);
      if (!base) return;
      const copy: SubProductItem = { ...base, id: uuid(), name: `${base.name} 副本` };
      set({ subProducts: [...s.subProducts, copy], activeSubProductId: copy.id, serialMsg: `已复制子产品「${base.name}」` });
      scheduleSave();
    },

    duplicateRole: (id) => {
      const s = get();
      const base = s.roles.find((x) => x.id === id);
      if (!base) return;
      set({ roles: [...s.roles, { ...base, id: uuid(), name: `${base.name} 副本` }], serialMsg: "已复制角色" });
      scheduleSave();
    },

    duplicateRule: (id) => {
      const s = get();
      const base = s.rules.find((x) => x.id === id);
      if (!base) return;
      set({ rules: [...s.rules, { ...base, id: uuid(), name: `${base.name} 副本`, hits: 0 }], serialMsg: "已复制规则" });
      scheduleSave();
    },

    duplicateSuite: (id) => {
      const s = get();
      const base = s.suites.find((x) => x.id === id);
      if (!base) return;
      set({ suites: [...s.suites, { ...base, id: uuid(), name: `${base.name} 副本` }], serialMsg: "已复制套件" });
      scheduleSave();
    },

    sendProtocol: async (protoId) => {
      const s = get();
      const proto = s.protocols.find((p) => p.id === protoId);
      if (!proto) return;
      const m = proto.messages[0];
      if (!m || !m.fields.length) {
        set({ serialMsg: `「${proto.name}」还没有字段，无法发送` });
        return;
      }
      try {
        const bytes = encodeMessage(proto, m, {});
        await s.sendBytes(bytes, "manual");
        set({ serialMsg: `已发送「${proto.name}」${bytes.length} 字节` });
      } catch (e) {
        set({ serialMsg: `组包失败：${(e as Error).message}` });
      }
    },

    /* ---------- 子产品 ---------- */
    createSubProduct: (name, templateId) => {
      const s = get();
      const spId = uuid();
      // 按所选协议类型（PLC / Modbus / 空白）生成第一个协议
      const tpl = templateById(templateId || "plc");
      const firstProtocol: PdlProtocol = {
        ...tpl.make(),
        id: uuid(),
        name: `${name}·主协议`,
        productId: s.activeProductId,
        subProductId: spId,
        updatedAt: "刚刚",
      };
      const sp: SubProductItem = { id: spId, productId: s.activeProductId, name, protocolId: firstProtocol.id };
      set({
        subProducts: [...s.subProducts, sp],
        protocols: [firstProtocol, ...s.protocols],
        activeSubProductId: spId,
        activeProtocolId: firstProtocol.id,
        serialMsg: `已新建子产品「${name}」，协议类型：${tpl.label}`,
      });
      scheduleSave();
    },
    updateSubProduct: (id, patch) => {
      set((s) => ({ subProducts: s.subProducts.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      if (patch.protocolId && get().activeSubProductId === id) set({ activeProtocolId: patch.protocolId });
      scheduleSave();
    },
    deleteSubProduct: (id) => {
      const s = get();
      const roleIds = new Set(s.roles.filter((r) => r.subProductId === id).map((r) => r.id));
      set({
        subProducts: s.subProducts.filter((x) => x.id !== id),
        roles: s.roles.filter((r) => r.subProductId !== id),
        cases: s.cases.filter((c) => c.subProductId !== id && !roleIds.has(c.roleId)),
        rules: s.rules.filter((r) => r.subProductId !== id),
        protocols: s.protocols.filter((p) => p.subProductId !== id),
        activeSubProductId: s.activeSubProductId === id ? s.subProducts.filter((x) => x.id !== id)[0]?.id ?? "" : s.activeSubProductId,
        serialMsg: "子产品已删除（其下角色/用例/规则一并移除）",
      });
      scheduleSave();
    },
    setActiveSubProduct: (id) => {
      const s = get();
      const sp = s.subProducts.find((x) => x.id === id);
      // 优先该子产品绑定的协议，其次它的第一个协议，再退回全局第一个
      const own = s.protocols.filter((p) => p.subProductId === id);
      const nextProto =
        s.protocols.find((p) => p.id === sp?.protocolId)?.id ?? own[0]?.id ?? s.activeProtocolId;
      set({
        activeSubProductId: id,
        activeProtocolId: nextProto,
        activeRoleId: s.roles.find((r) => r.subProductId === id)?.id ?? "",
      });
    },

    /* ---------- 角色 ---------- */
    createRole: (input) => {
      const s = get();
      const spId = s.activeSubProductId || s.subProducts[0]?.id || "";
      if (!spId) {
        set({ serialMsg: "请先建一个子产品" });
        return;
      }
      const role: RoleItem = { id: uuid(), subProductId: spId, name: input.name, address: input.address, note: input.note };
      set({ roles: [...s.roles, role], activeRoleId: role.id, serialMsg: `已新建角色「${input.name}」（站号 ${input.address}）` });
      scheduleSave();
    },
    updateRole: (id, patch) => {
      set((s) => ({ roles: s.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      scheduleSave();
    },
    deleteRole: (id) => {
      set((s) => {
        const roles = s.roles.filter((r) => r.id !== id);
        return { roles, activeRoleId: s.activeRoleId === id ? roles[0]?.id ?? "" : s.activeRoleId, serialMsg: "角色已删除" };
      });
      scheduleSave();
    },

    /* ---------- 协议 ---------- */
    createProtocol: (name, templateId) => {
      const s = get();
      const spId = s.activeSubProductId || s.subProducts[0]?.id || "";
      const tpl = templateById(templateId || "plc");
      const p: PdlProtocol = {
        ...tpl.make(),
        id: uuid(),
        name,
        version: "v1",
        productId: s.activeProductId,
        subProductId: spId,
        updatedAt: "刚刚",
      };
      set({
        protocols: [p, ...s.protocols],
        activeProtocolId: p.id,
        subProducts: s.subProducts.map((x) => (x.id === spId ? { ...x, protocolId: p.id } : x)),
        serialMsg: `已新建协议「${name}」（${tpl.label}）`,
      });
      scheduleSave();
    },
    updateProtocol: (id, patch) => {
      set((s) => ({
        protocols: s.protocols.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: "刚刚" } : p)),
        serialMsg: "协议已保存",
      }));
      scheduleSave();
    },
    duplicateProtocol: () => {
      const s = get();
      const base = s.protocols.find((p) => p.id === s.activeProtocolId);
      if (!base) return;
      const nums = s.protocols.map((p) => Number(p.version.replace(/[^\d]/g, "")) || 0);
      const nextV = `v${Math.max(...nums, 0) + 1}`;
      const copy: PdlProtocol = { ...base, id: uuid(), version: nextV, productId: s.activeProductId, updatedAt: "刚刚" };
      set({ protocols: [copy, ...s.protocols], activeProtocolId: copy.id, serialMsg: `已另存为 ${nextV}` });
      scheduleSave();
    },
    deleteProtocol: (id) => {
      set((s) => {
        const protocols = s.protocols.filter((p) => p.id !== id);
        return {
          protocols,
          activeProtocolId: s.activeProtocolId === id ? protocols[0]?.id ?? "" : s.activeProtocolId,
          subProducts: s.subProducts.map((sp) => (sp.protocolId === id ? { ...sp, protocolId: "" } : sp)),
        };
      });
      scheduleSave();
    },

    /* ---------- 用例 ---------- */
    createCase: (name) => {
      const s = get();
      const spId = s.activeSubProductId || s.subProducts[0]?.id || "";
      const roleId = s.roles.find((r) => r.subProductId === spId)?.id ?? "";
      const item: CaseItem = {
        id: uuid(),
        subProductId: spId,
        name,
        roleId,
        tags: [],
        status: "never",
        statusText: "未运行",
        stepCount: 0,
        assertionCount: 0,
        steps: [],
        yaml: `case: ${name}\nsubProduct: ${spId}\nsteps: []`,
      };
      set({ cases: [...s.cases, item], activeCaseId: item.id, serialMsg: `已新建用例「${name}」` });
      scheduleSave();
    },
    updateCase: (caseId, patch) => {
      set((s) => ({ cases: s.cases.map((c) => (c.id === caseId ? { ...c, ...patch } : c)) }));
      scheduleSave();
    },
    updateCaseSteps: (caseId, steps) => {
      const yaml = stepsToYaml(steps);
      set((s) => ({
        cases: s.cases.map((c) =>
          c.id === caseId
            ? {
                ...c,
                steps,
                stepCount: steps.length,
                assertionCount: steps.filter((x) => x.kind === "expect" || x.kind === "assertNo").length,
                yaml,
                status: "never",
                statusText: "未运行",
              }
            : c,
        ),
      }));
      scheduleSave();
    },
    duplicateCase: (id) => {
      const s = get();
      const base = s.cases.find((c) => c.id === id);
      if (!base) return;
      const copy: CaseItem = { ...base, id: uuid(), name: `${base.name} 副本`, status: "never", statusText: "未运行" };
      set({ cases: [...s.cases, copy], activeCaseId: copy.id });
      scheduleSave();
    },
    deleteCase: (id) => {
      set((s) => {
        const cases = s.cases.filter((c) => c.id !== id);
        return { cases, activeCaseId: s.activeCaseId === id ? cases[0]?.id ?? "" : s.activeCaseId };
      });
      scheduleSave();
    },

    /* ---------- 规则 ---------- */
    createRule: (name, trigger, action) => {
      const s = get();
      const item: RuleItem = {
        id: uuid(),
        subProductId: s.activeSubProductId || s.subProducts[0]?.id || "",
        name,
        icon: "\uF215",
        iconColor: "var(--green)",
        trigger,
        action,
        enabled: true,
        hits: 0,
        lastRun: "—",
      };
      set({ rules: [...s.rules, item] });
      scheduleSave();
    },
    updateRule: (id, patch) => {
      set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      scheduleSave();
    },
    deleteRule: (id) => {
      set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
      scheduleSave();
    },

    /* ---------- 套件 ---------- */
    createSuite: (name, tag) => {
      const s = get();
      const item: SuiteItem = {
        id: uuid(),
        productId: s.activeProductId,
        name,
        count: 0,
        desc: tag ? `按标签「${tag}」筛选` : "全部用例",
        tag,
      };
      set({ suites: [...s.suites, item], activeSuiteId: item.id });
      scheduleSave();
    },
    deleteSuite: (id) => {
      set((s) => {
        const suites = s.suites.filter((x) => x.id !== id);
        return { suites, activeSuiteId: s.activeSuiteId === id ? suites[0]?.id ?? "" : s.activeSuiteId };
      });
      scheduleSave();
    },

    /* ---------- 执行 ---------- */
    runActiveCase: async () => {
      const s = get();
      const item = s.cases.find((c) => c.id === s.activeCaseId);
      if (!item || s.running) return;
      set({ running: true, stopRequested: false, liveSteps: [], runningCaseId: item.id, runningSuiteName: "单条用例" });
      const r = await runCase(host, item, "单条用例");
      try {
        appendRun(r);
        const { flush } = await import("./db");
        await flush();
      } catch {
        /* 落库失败不影响结果展示 */
      }
      set((st) => ({
        running: false,
        runs: [r, ...st.runs].slice(0, 200),
        cases: st.cases.map((c) =>
          c.id === item.id
            ? { ...c, status: r.status === "pass" ? "passed" : "failed", statusText: `${r.status === "pass" ? "上次通过" : "上次失败"} · ${r.startedAt.slice(0, 5)}` }
            : c,
        ),
        activeView: "report",
        serialMsg: `用例「${item.name}」${r.status === "pass" ? "通过" : "失败"} · ${r.durationMs}ms`,
      }));
    },

    runActiveSuite: async () => {
      const s = get();
      if (s.running) return;
      const suite = s.suites.find((x) => x.id === s.activeSuiteId) ?? s.suites[0];
      const cases = suite?.tag ? s.cases.filter((c) => c.tags.includes(suite.tag!)) : s.cases;
      if (!cases.length) {
        set({ serialMsg: "没有可执行的用例" });
        return;
      }
      set({ running: true, stopRequested: false, liveSteps: [], runningCaseId: "", runningSuiteName: suite?.name ?? "全部用例" });
      const results = await runSuite(host, cases, suite?.name ?? "全部用例", host.onStep, (r) => {
        set((st) => ({ runs: [r, ...st.runs].slice(0, 200) }));
      });
      const pass = results.filter((r) => r.status === "pass").length;
      set((st) => ({
        running: false,
        runs: [...results, ...st.runs].slice(0, 200),
        cases: st.cases.map((c) => {
          const r = results.find((x) => x.caseId === c.id);
          return r
            ? { ...c, status: r.status === "pass" ? "passed" : "failed", statusText: `${r.status === "pass" ? "上次通过" : "上次失败"} · ${r.startedAt.slice(0, 5)}` }
            : c;
        }),
        activeView: "report",
        serialMsg: `套件「${suite?.name ?? "全部用例"}」完成：${pass}/${results.length} 通过`,
      }));
    },

    runFailedCases: async () => {
      const s = get();
      if (s.running) return;
      const failedIds = new Set(s.runs.filter((r) => r.status === "fail").map((r) => r.caseId));
      const cases = s.cases.filter((c) => failedIds.has(c.id));
      if (!cases.length) {
        set({ serialMsg: "没有失败用例可复跑" });
        return;
      }
      set({ running: true, liveSteps: [], runningCaseId: "", runningSuiteName: "失败复跑" });
      const results = await runSuite(host, cases, "失败复跑", host.onStep, (r) => {
        set((st) => ({ runs: [r, ...st.runs].slice(0, 200) }));
      });
      const pass = results.filter((r) => r.status === "pass").length;
      set((st) => ({
        running: false,
        runs: [...results, ...st.runs].slice(0, 200),
        activeView: "report",
        serialMsg: `失败复跑完成：${pass}/${results.length} 通过`,
      }));
    },

    clearRuns: () => {
      set({ runs: [] });
      try {
        clearRunsTable();
        void import("./db").then((m) => m.flush());
      } catch {
        /* noop */
      }
    },

    /* ---------- UI ---------- */
    // 兼容旧入口：setView("suite") 现在落到「测试 → 套件」
    setView: (v) => set({ activeView: v }),
    setFilter: (f) => set({ filter: f }),
    setViewMode: (m) => set({ viewMode: m }),
    setInspectorTab: (t) => set({ inspectorTab: t }),
    selectFrame: (id) => set({ selectedFrameId: id }),
    togglePause: () => set((s) => ({ paused: !s.paused })),
    toggleAutoSend: () => {
      set((s) => ({ autoSend: !s.autoSend, serialMsg: !s.autoSend ? "自动发送已开启" : "自动发送已关闭" }));
      if (get().autoSend) {
        const now = Date.now();
        for (const r of get().rules) ruleLastFire.set(r.id, now);
      }
    },
    setSendInput: (v) => set({ sendInput: v }),
    clearFrames: () => set({ frames: [], selectedFrameId: null }),
    setActiveRole: (id) => set({ activeRoleId: id }),
    setActiveProtocol: (id) => set({ activeProtocolId: id }),
    setActiveCase: (id) => set({ activeCaseId: id }),
    setActiveSuite: (id) => set({ activeSuiteId: id }),
    toggleRule: (id) => {
      set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) }));
      scheduleSave();
    },
    pushFrame: (f) =>
      set((s) => {
        if (s.paused) return {};
        const fr = mkFrame(f);
        const next = [...s.frames, fr];
        const bLen = fr.bytes.length;
        return {
          frames: next.length > 2500 ? next.slice(next.length - 2500) : next,
          rxCount: s.rxCount + (fr.dir === "rx" ? bLen : 0),
          txCount: s.txCount + (fr.dir === "tx" ? bLen : 0),
          totalFrames: s.totalFrames + 1,
          selectedFrameId: s.selectedFrameId ?? fr.id,
        };
      }),
    sendCurrent: () => {
      const s = get();
      if (!s.sendInput.trim()) {
        set({ serialMsg: "发送内容为空" });
        return;
      }
      let bytes: number[] = [];
      if (s.sendMode === "text") {
        let text = s.sendInput;
        if (s.sendNewline && !text.endsWith("\r\n")) {
          text += "\r\n";
        }
        bytes = stringToBytes(text, true);
      } else {
        let hexStr = s.sendInput;
        if (s.sendNewline) {
          hexStr += " 0D 0A";
        }
        bytes = parseHex(hexStr);
        if (!bytes.length) {
          set({ serialMsg: "发送内容不是合法的十六进制" });
          return;
        }
        if (s.autoChecksum) {
          const proto = s.protocols.find((p) => p.id === s.activeProtocolId) ?? RAW_PROTOCOL;
          const alg = s.checksumAlgorithm || proto.checksum.algorithm;
          const probe = decodeFrame(proto, bytes);
          if (!(probe.matched && probe.crcOk)) {
            const before = bytes.length;
            bytes = appendChecksum(proto, bytes, alg);
            set({ serialMsg: `已自动补 ${alg}（${before} → ${bytes.length} 字节）` });
          }
        }
      }
      void s.sendBytes(bytes, "manual");
      if (s.clearOnSend) {
        set({ sendInput: "" });
      }
    },
    setSendMode: (m) => set({ sendMode: m }),
    setSendNewline: (v) => set({ sendNewline: v }),
    setClearOnSend: (v) => set({ clearOnSend: v }),
    setPeriodMs: (ms) => set({ periodMs: Math.max(10, ms) }),
    togglePeriodSend: () => {
      const s = get();
      if (s.periodSend) {
        if (periodTimer) clearInterval(periodTimer);
        periodTimer = null;
        set({ periodSend: false, serialMsg: "已停止定时发送" });
      } else {
        if (periodTimer) clearInterval(periodTimer);
        periodTimer = setInterval(() => {
          get().sendCurrent();
        }, Math.max(20, s.periodMs));
        set({ periodSend: true, serialMsg: `已开启定时发送（每 ${s.periodMs}ms）` });
      }
    },
    setTermViewMode: (m) => set({ termViewMode: m }),
    setShowTimestamp: (v) => set({ showTimestamp: v }),
    setAutoScroll: (v) => set({ autoScroll: v }),
    resetCounters: () => set({ rxCount: 0, txCount: 0, totalFrames: 0 }),
    addQuickSend: (item) => {
      const s = get();
      const newItem: QuickSendItem = {
        id: `qs_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        enabled: true,
        hex: false,
        content: "AT",
        note: "快捷指令",
        ...item,
      };
      const next = [...s.quickSends, newItem];
      set({ quickSends: next });
      saveQuickSends(next);
    },
    updateQuickSend: (id, patch) => {
      const s = get();
      const next = s.quickSends.map((q) => (q.id === id ? { ...q, ...patch } : q));
      set({ quickSends: next });
      saveQuickSends(next);
    },
    deleteQuickSend: (id) => {
      const s = get();
      const next = s.quickSends.filter((q) => q.id !== id);
      set({ quickSends: next });
      saveQuickSends(next);
    },
    setLoopIntervalMs: (ms) => set({ loopIntervalMs: Math.max(10, ms) }),
    toggleLoopQuickSend: () => {
      const s = get();
      if (s.loopingQuick) {
        if (loopQuickTimer) clearInterval(loopQuickTimer);
        loopQuickTimer = null;
        set({ loopingQuick: false, currentLoopIndex: -1, serialMsg: "已停止快捷轮询" });
      } else {
        const enabled = s.quickSends.filter((q) => q.enabled && q.content.trim());
        if (!enabled.length) {
          set({ serialMsg: "没有勾选任何快捷指令" });
          return;
        }
        let idx = 0;
        set({ loopingQuick: true, currentLoopIndex: 0, serialMsg: `开始循环轮询 ${enabled.length} 条指令` });
        if (loopQuickTimer) clearInterval(loopQuickTimer);
        loopQuickTimer = setInterval(() => {
          const curS = get();
          const list = curS.quickSends.filter((q) => q.enabled && q.content.trim());
          if (!list.length || !curS.loopingQuick) {
            if (loopQuickTimer) clearInterval(loopQuickTimer);
            loopQuickTimer = null;
            set({ loopingQuick: false, currentLoopIndex: -1 });
            return;
          }
          if (idx >= list.length) idx = 0;
          const item = list[idx];
          set({ currentLoopIndex: idx });
          let bytes: number[] = [];
          if (item.hex) {
            let h = item.content;
            if (curS.sendNewline) h += " 0D 0A";
            bytes = parseHex(h);
          } else {
            let t = item.content;
            if (curS.sendNewline && !t.endsWith("\r\n")) t += "\r\n";
            bytes = stringToBytes(t, true);
          }
          if (bytes.length) {
            void curS.sendBytes(bytes, "period");
          }
          idx++;
        }, Math.max(20, s.loopIntervalMs));
      }
    },
    setRoundTripFailed: (v) => set({ roundTripFailed: v }),
    setShowRoundTripModal: (v) => set({ showRoundTripModal: v }),
    setShowSelfTest: (v) => set({ showSelfTest: v }),
  setHealth: (rec) => {
    const saved = saveHealth(rec);
    set({ health: saved, history: pushHistory(saved) });
  },
  setCaseTab: (v) => set({ caseTab: v, activeView: "case" }),
  clearAcceptanceHistory: () => {
    clearHistory();
    set({ health: null, history: [] });
  },
  };
});