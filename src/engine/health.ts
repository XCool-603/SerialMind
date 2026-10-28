/**
 * 系统健康状态：把最近一次整机验收的结果留在本机。
 *
 * 目的：客户关掉软件再打开，顶栏还能看到「上次验收 19/19 通过」，
 * 不用每次重新跑一遍才知道软件是好的。
 */
import { APP_VERSION } from "./version";

const KEY = "serialmind.health";

export interface HealthRecord {
  /** 验收时间（本地化字符串） */
  at: string;
  /** 通过项数 */
  pass: number;
  /** 总项数 */
  total: number;
  /** 失败项名称（用于提示） */
  failed: string[];
  /** 运行环境 */
  env: string;
  /** 验收时的软件版本 */
  version: string;
}

export function loadHealth(): HealthRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as HealthRecord;
    if (!r || typeof r.pass !== "number" || typeof r.total !== "number") return null;
    return r;
  } catch {
    return null;
  }
}

export function saveHealth(rec: Omit<HealthRecord, "version">): HealthRecord {
  const full: HealthRecord = { ...rec, version: APP_VERSION };
  try {
    localStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    /* 存不进就算了，不影响本次使用 */
  }
  return full;
}

export function clearHealth(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/* ---------------- 验收历史（项目交付记录） ---------------- */

const HKEY = "serialmind.acceptanceHistory";
const MAX_HISTORY = 20;

/** 读验收历史（新的在前） */
export function loadHistory(): HealthRecord[] {
  try {
    const raw = localStorage.getItem(HKEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && typeof r.pass === "number" && typeof r.total === "number");
  } catch {
    return [];
  }
}

/** 追加一条验收记录，返回最新历史 */
export function pushHistory(rec: HealthRecord): HealthRecord[] {
  const list = [rec, ...loadHistory()].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HKEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HKEY);
  } catch {
    /* ignore */
  }
}

/** 健康状态判定：ok / bad / stale（版本变了要重验）/ none */
export function healthState(rec: HealthRecord | null): "ok" | "bad" | "stale" | "none" {
  if (!rec) return "none";
  if (rec.version !== APP_VERSION) return "stale";
  return rec.failed.length === 0 && rec.pass === rec.total ? "ok" : "bad";
}
