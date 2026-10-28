/** 领域类型：store / repo / UI 共用，避免循环依赖 */

export type Source = "device" | "manual" | "period" | "trigger" | "case" | "reply" | "ai";
export type ViewKey = "terminal" | "protocol" | "rule" | "case" | "suite" | "report" | "role";
export type ViewMode = "hex" | "ascii" | "field";

export interface ProductItem {
  id: string;
  name: string;
  description?: string;
}

/**
 * 子产品：一个被测算的功能单元（起升控制 / 小车控制 / 电池管理）。
 * 每个子产品固定绑定一个协议。
 */
export interface SubProductItem {
  id: string;
  productId: string;
  name: string;
  protocolId: string;
  note?: string;
  /** 排序（拖拽调整） */
  order?: number;
}

/**
 * 角色：总线上的一个身份（起升PLC / 上位机 / 变频器）。
 * 不再持有串口参数——串口是运行时在顶栏选的。
 */
export interface RoleItem {
  id: string;
  subProductId: string;
  name: string;
  /** 站号 / 地址（Modbus 从站地址等），仅作业务标识 */
  address: number;
  note?: string;
  order?: number;
}

/** 运行时连接（不持久化）：当前用哪个串口、什么参数 */
export interface Connection {
  port: string;
  baud: number;
  /** 数据位 5/6/7/8 */
  dataBits: number;
  /** 停止位 1/2 */
  stopBits: number;
  /** 校验 */
  parity: "none" | "odd" | "even";
  /** 流控 */
  flowControl: "none" | "hardware" | "software";
  /** 展示用，如 8N1 / 7E1 */
  frame: string;
  connected: boolean;
}

export interface Frame {
  id: number;
  time: string;
  /** 到达时刻（epoch ms），用于真实帧率统计 */
  ts: number;
  dir: "rx" | "tx";
  no: number;
  source: Source;
  bytes: number[];
  crcOk: boolean;
  crcExpected?: string;
  crcActual?: string;
  fields?: import("./codec").DecodedField[];
  banner?: string;
  diffBytes?: number[];
  /** 这帧是否匹配当前协议（false 时校验结论无意义） */
  matched?: boolean;
}

export interface RuleItem {
  id: string;
  subProductId: string;
  name: string;
  order?: number;
  icon: string;
  iconColor: string;
  trigger: string;
  action: string;
  enabled: boolean;
  hits: number;
  lastRun: string;
}

export type StepKind =
  | "set"
  | "expect"
  | "assertNo"
  | "delay"
  | "loop"
  | "parallel"
  | "send"
  | "call"
  | "script"
  /** 条件分支：cond 成立跑 children，否则跑 elseChildren */
  | "if"
  /** 条件循环：cond 成立就一直跑 children（有次数上限） */
  | "while"
  /** 变量赋值：score = score + 1 */
  | "setVar"
  | "break"
  | "continue";

export interface CaseStep {
  id: string;
  kind: StepKind;
  text: string;
  detail?: string;
  timeout?: string;
  fields?: { label: string; value: string }[];
    /** if / while 的条件，如 position > 100 / score < 3 */
    cond?: string;
    /** if / while 的主体步骤 */
    children?: CaseStep[];
    /** if 的否则分支 */
    elseChildren?: CaseStep[];
}

export interface CaseItem {
  id: string;
  subProductId: string;
  name: string;
  order?: number;
  /** 整条用例重复执行次数（自动化循环发送） */
  repeat?: number;
  /** 每轮之间的间隔（ms） */
  intervalMs?: number;
  /** 单轮失败后重试次数 */
  retries?: number;
  /** 最长运行时长（ms）：到点自动停，0/未填 = 不限。无限循环时靠它兜底 */
  maxDurationMs?: number;
  /** 失败即停（默认 true）；关掉后失败也继续跑完剩余轮次，最后整体判失败 */
  stopOnFail?: boolean;
  /** 变量：每轮自动计算（值 = init + step × 轮序号），步骤里用 ${name} 引用 */
  vars?: { name: string; init: number; step: number }[];
  /** 用例跑在哪个角色上（决定站号与方向） */
  roleId: string;
  tags: string[];
  status: "passed" | "failed" | "idle" | "never";
  statusText: string;
  stepCount: number;
  assertionCount: number;
  dataDriven?: string;
  passRate?: string;
  steps: CaseStep[];
  yaml: string;
}

export interface SuiteItem {
  id: string;
  productId: string;
  name: string;
  order?: number;
  count: number;
  desc: string;
  /** 按标签筛选用例；为空表示全部 */
  tag?: string;
}

/** 单步执行结果（真实产出） */
export interface StepResult {
  stepId: string;
  kind: StepKind;
  text: string;
  status: "pass" | "fail" | "skip";
  startedAt: string;
  durationMs: number;
  expected?: string;
  actual?: string;
  frameHex?: string;
  error?: string;
}

/** 一次用例执行的完整结果 */
export interface RunResult {
  id: string;
  caseId: string;
  caseName: string;
  suite: string;
  startedAt: string;
  durationMs: number;
  status: "pass" | "fail";
  items: StepResult[];
  reason?: string;
  /** 压测统计：发多少、收多少、丢多少、平均/最大响应 */
  stats?: { sent: number; received: number; lost: number; avgMs: number; maxMs: number };
}
