/**
 * SQLite（sql.js + 持久化）
 * 持久化顺序：IndexedDB → localStorage → 仅内存（都会在状态栏/自检里标出来）
 * 表结构与迁移在 migrate.ts
 */
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { migrate } from "./migrate";

const KEY = "serialmind.db.v1";
const LS_KEY = "serialmind.db.v1.b64";
const META_TENANT = "local";

let db: Database | null = null;
let ready = false;

/** 持久化方式：idb / ls / memory */
export type StorageMode = "idb" | "ls" | "memory";
let storageMode: StorageMode = "memory";
let storageError = "";

export function getStorageMode(): StorageMode {
  return storageMode;
}
export function getStorageError(): string {
  return storageError;
}

/* ---------------- IndexedDB ---------------- */

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境没有 IndexedDB"));
      return;
    }
    const req = indexedDB.open("serialmind", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const idb = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = idb.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
  });
}

async function idbSet(key: string, value: Uint8Array): Promise<void> {
  const idb = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 写入失败"));
  });
}

/* ---------------- localStorage 兜底 ---------------- */

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function lsGet(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? b64ToBytes(raw) : null;
  } catch {
    return null;
  }
}

function lsSet(bytes: Uint8Array): boolean {
  try {
    localStorage.setItem(LS_KEY, bytesToB64(bytes));
    return true;
  } catch {
    return false;
  }
}

/* ---------------- 生命周期 ---------------- */

export async function initDb(): Promise<void> {
  if (ready) return;

  // 1) 载入 wasm（失败要给出明确原因，不要只说"SQLite 异常"）
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  try {
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  } catch (e) {
    throw new Error(`SQLite 引擎加载失败（wasm）：${(e as Error).message}`);
  }

  // 2) 读旧数据：先 IndexedDB，再 localStorage
  let saved: Uint8Array | null = null;
  try {
    saved = await idbGet(KEY);
    storageMode = "idb";
  } catch (e) {
    storageError = (e as Error).message;
    saved = lsGet();
    storageMode = saved ? "ls" : "memory";
  }

  db = saved && saved.length ? new SQL.Database(saved) : new SQL.Database();
  migrate(db);
  ready = true;

  // 3) 立刻落一次盘（失败不影响使用）
  await flush();
}

/** 清空本地数据库（重来） */
export async function wipeDb(): Promise<void> {
  try {
    const idb = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* noop */
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
  db = null;
  ready = false;
  storageMode = "memory";
}

export function rawDb(): Database {
  if (!db) throw new Error("数据库未初始化");
  return db;
}

/** 落盘：IndexedDB 失败自动退 localStorage；都失败就只留内存（不报错） */
export async function flush(): Promise<void> {
  if (!db) return;
  const data = db.export();

  if (storageMode === "idb") {
    try {
      await idbSet(KEY, data);
      return;
    } catch (e) {
      storageError = (e as Error).message;
    }
  }
  if (lsSet(data)) {
    storageMode = "ls";
    return;
  }
  storageMode = "memory";
}
export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const d = rawDb();
  const stmt = d.prepare(sql);
  try {
    stmt.bind(params as never);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}

export function run(sql: string, params: unknown[] = []): void {
  const d = rawDb();
  const stmt = d.prepare(sql);
  try {
    stmt.bind(params as never);
    stmt.step();
  } finally {
    stmt.free();
  }
}

export function exec(sql: string): void {
  rawDb().run(sql);
}

export function tableCount(table: string): number {
  const rows = query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
  return Number(rows[0]?.c ?? 0);
}

export function tx(fn: () => void): void {
  const d = rawDb();
  d.run("BEGIN");
  try {
    fn();
    d.run("COMMIT");
  } catch (e) {
    try {
      d.run("ROLLBACK");
    } catch {
      /* noop */
    }
    throw e;
  }
}

/* ---------------- 工具 ---------------- */

/** UUIDv7 风格（时间有序） */
export function uuid(): string {
  const ts = Date.now().toString(16).padStart(12, "0");
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${rnd().slice(0, 3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${rnd().slice(0, 3)}-${rnd()}${rnd()}${rnd()}`;
}

export function utcNow(): string {
  return new Date().toISOString();
}

export const TENANT_ID = META_TENANT;