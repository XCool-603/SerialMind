/** 领域类型：store / repo / UI 共用，避免循环依赖 */

export type Source = "device" | "manual" | "period" | "trigger" | "case" | "reply" | "ai";
export type ViewKey = "terminal" | "protocol" | "case" | "report";
export type ViewMode = "hex" | "ascii" | "field";

export interface ProductItem {
  id: string;
  name: string;
  description?: string;
}

/** 兼容旧版数据模型 */
export interface SuiteItem {
  id: string;
  productId: string;
  name: string;
  count: number;
  desc: string;
  tag?: string;
  order?: number;
}

/** 兼容旧版数据模型 */
export interface RuleItem {
  id: string;
  subProductId: string;
  name: string;
  icon: string;
  iconColor: string;
  trigger: string;
  action: string;
  enabled: boolean;
  hits: number;
  lastRun: string;
  order?: number;
}

/** SSCom 风格的多条快捷发送项 */
export interface QuickSendItem {
  id: string;
  enabled: boolean;
  hex: boolean;
  content: string;
  note: string;
}

/** 子产品 */
export interface SubProductItem {
  id: string;
  productId: string;
  name: string;
  protocolId: string;
  note?: string;
  order?: number;
}

/** 角色 */
export interface RoleItem {
  id: string;
  subProductId: string;
  name: string;
  address: number;
  note?: string;
  order?: number;
}

/** 运行时连接：当前用哪个串口、什么参数 */
export interface Connection {
  port: string;
  baud: number;
  dataBits: number;
  stopBits: number;
  parity: "none" | "odd" | "even";
  flowControl: "none" | "hardware" | "software";
  frame: string;
  connected: boolean;
  dtr?: boolean;
  rts?: boolean;
}

export interface Frame {
  id: number;
  time: string;
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
  matched?: boolean;
  protocolName?: string;
  protocolId?: string;
}

/** 纯界面配置：报文字段值与增量规则 */
export interface FieldActionRule {
  fieldName: string;
  initValue: number;
  step: number; // 每次加多少（如 10）
}

/** 纯界面配置：报文动作发送任务（如：每秒发送心跳协议、每秒车辆行走协议+10米） */
export interface CasePacketAction {
  id: string;
  name: string;
  protocolId: string; // 关联的用户添加的协议 ID
  messageId?: string; // 协议内的特定报文 ID
  intervalMs: number; // 周期毫秒（如 1000 代表每秒）
  enabled: boolean;
  fields: FieldActionRule[];
}

export type StepKind =
  | "set"
  | "expect"
  | "assert"
  | "extract"
  | "assertNo"
  | "delay"
  | "loop"
  | "parallel"
  | "send"
  | "call"
  | "script"
  | "if"
  | "while"
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
  cond?: string;
  children?: CaseStep[];
  elseChildren?: CaseStep[];
  targetVar?: string;
  extractType?: "regex" | "slice" | "field";
  extractRule?: string;
  sendMode?: "hex" | "text";
}

export interface FieldStepRule {
  fieldName: string;
  initValue: number;
  step: number;
}

export interface CaseItem {
  id: string;
  subProductId: string;
  name: string;
  order?: number;
  repeat?: number;
  intervalMs?: number;
  retries?: number;
  maxDurationMs?: number;
  stopOnFail?: boolean;
  vars?: { name: string; init: number; step: number }[];
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

  /** 纯界面配置的报文发送任务列表（免代码） */
  actions?: CasePacketAction[];

  /** 兼容协议字段增量 */
  targetMessageId?: string;
  fieldRules?: FieldStepRule[];
}

/** 单步执行结果 */
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
  extractedVars?: Record<string, string | number>;
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
  stats?: { sent: number; received: number; lost: number; avgMs: number; maxMs: number };
}
