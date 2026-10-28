import type { Database } from "sql.js";

/** 全量建表语句（IF NOT EXISTS，可重复执行） */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS product (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS subproduct (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT,
  protocol_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS role (
  id TEXT PRIMARY KEY,
  subproduct_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT,
  address INTEGER DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS protocol (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  subproduct_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT,
  version TEXT,
  pdl_json TEXT,
  source_doc TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS case_item (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  subproduct_id TEXT,
  role_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT,
  tags TEXT,
  steps_json TEXT,
  yaml TEXT,
  data_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS suite (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT,
  case_ids TEXT,
  description TEXT,
  tag TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS rule (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  subproduct_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'local',
  name TEXT,
  icon TEXT,
  icon_color TEXT,
  trigger_text TEXT,
  action_text TEXT,
  enabled INTEGER DEFAULT 1,
  hits INTEGER DEFAULT 0,
  last_run TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT);

-- 自动化测试运行结果（报告持久化）
CREATE TABLE IF NOT EXISTS run_result (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  case_name TEXT,
  suite TEXT,
  status TEXT,
  duration_ms INTEGER,
  started_at TEXT,
  reason TEXT,
  items_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subproduct_product ON subproduct(product_id);
CREATE INDEX IF NOT EXISTS idx_role_subproduct ON role(subproduct_id);
CREATE INDEX IF NOT EXISTS idx_protocol_product ON protocol(product_id);
CREATE INDEX IF NOT EXISTS idx_case_product ON case_item(product_id);
CREATE INDEX IF NOT EXISTS idx_rule_product ON rule(product_id);
CREATE INDEX IF NOT EXISTS idx_run_created ON run_result(created_at);
`;

/** 表是否存在 */
export function hasTable(d: Database, name: string): boolean {
  const res = d.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`);
  return res.length > 0 && res[0].values.length > 0;
}

/** 某表是否有某列 */
export function hasColumn(d: Database, table: string, col: string): boolean {
  if (!hasTable(d, table)) return false;
  const res = d.exec(`PRAGMA table_info(${table})`);
  if (!res.length) return false;
  const nameIdx = res[0].columns.indexOf("name");
  return res[0].values.some((row) => row[nameIdx] === col);
}

/** 某表的列定义（name / notnull / dflt） */
function tableInfo(d: Database, table: string): { name: string; notnull: number; dflt: string | null }[] {
  if (!hasTable(d, table)) return [];
  const res = d.exec(`PRAGMA table_info(${table})`);
  if (!res.length) return [];
  const c = res[0].columns;
  return res[0].values.map((row) => ({
    name: String(row[c.indexOf("name")]),
    notnull: Number(row[c.indexOf("notnull")] ?? 0),
    dflt: row[c.indexOf("dflt_value")] as string | null,
  }));
}

/**
 * 重建表：老版本可能有 `link_id TEXT NOT NULL` 这类约束，
 * 导致新代码写入失败（SQLite 异常）。
 * 做法：先把老数据读进内存 → 换名 → 按新结构建表 → 逐行写回
 */
function rebuildTable(d: Database, table: string, columns: string[]): void {
  const info = tableInfo(d, table);
  if (!info.length) return;

  const common = columns.filter((c) => info.some((i) => i.name === c));
  if (!common.length) return;

  // 1) rename 之前把老数据整表读出来
  const colList = common.join(", ");
  const dump = d.exec(`SELECT ${colList} FROM ${table}`);
  const rows = dump.length ? dump[0].values : [];
  const colCount = common.length;

  // 2) 换名 + 按新结构重建
  const tmp = `${table}__old`;
  d.run(`ALTER TABLE ${table} RENAME TO ${tmp}`);
  d.run(SCHEMA);

  // 3) 逐行写回（NULL 补默认值；坏行跳过，不阻塞其它数据）
  if (rows.length) {
    const placeholders = common.map(() => "?").join(",");
    const stmt = d.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`);
    const now = new Date().toISOString();
    const fallback = (col: string): unknown => {
      if (col === "tenant_id") return "local";
      if (col === "created_at" || col === "updated_at") return now;
      if (col === "rev" || col === "enabled") return 1;
      if (col === "hits" || col === "address") return 0;
      return "";
    };
    let skipped = 0;
    for (const row of rows) {
      const fixed = common.map((col, i) => {
        const v = (row as unknown[])[i];
        return v === null || v === undefined ? fallback(col) : v;
      });
      try {
        stmt.run(fixed as never);
      } catch (e) {
        skipped++;
        console.warn(`[migrate] ${table} 跳过 1 行：`, (e as Error).message);
      }
    }
    stmt.free();
    if (skipped) console.warn(`[migrate] ${table} 共跳过 ${skipped} 行`);
  }

  d.run(`DROP TABLE ${tmp}`);
}

/**
 * 结构迁移：老库缺表/缺列就补，**不丢已有数据**
 * 早期版本用 link 表、protocol 没有 subproduct_id，直接升级会报错
 */
export function migrate(d: Database): void {
  d.run(SCHEMA);

  const addCol = (table: string, col: string, type = "TEXT") => {
    if (hasTable(d, table) && !hasColumn(d, table, col)) {
      d.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  };
  addCol("protocol", "subproduct_id");
  addCol("case_item", "subproduct_id");
  addCol("case_item", "role_id");
  addCol("rule", "subproduct_id");
  addCol("suite", "tag");
  // 拖拽排序
  for (const t of ["product", "subproduct", "role", "protocol", "case_item", "rule", "suite"]) {
    addCol(t, "sort_order", "INTEGER");
  }

  // 老表如果有「新代码不填的 NOT NULL 列」，写入会失败 → 重建表
  const mustHave: Record<string, string[]> = {
    product: ["id", "tenant_id", "name", "description", "created_at", "updated_at", "rev", "deleted_at"],
    subproduct: ["id", "product_id", "tenant_id", "name", "protocol_id", "note", "created_at", "updated_at", "rev", "deleted_at"],
    role: ["id", "subproduct_id", "tenant_id", "name", "address", "note", "created_at", "updated_at", "rev", "deleted_at"],
    protocol: ["id", "product_id", "subproduct_id", "tenant_id", "name", "version", "pdl_json", "source_doc", "created_at", "updated_at", "rev", "deleted_at"],
    case_item: ["id", "product_id", "subproduct_id", "role_id", "tenant_id", "name", "tags", "steps_json", "yaml", "data_source", "created_at", "updated_at", "rev", "deleted_at"],
    suite: ["id", "product_id", "tenant_id", "name", "case_ids", "description", "tag", "created_at", "updated_at", "rev", "deleted_at"],
    rule: ["id", "product_id", "subproduct_id", "tenant_id", "name", "icon", "icon_color", "trigger_text", "action_text", "enabled", "hits", "last_run", "created_at", "updated_at", "rev", "deleted_at"],
  };

  for (const [table, cols] of Object.entries(mustHave)) {
    const info = tableInfo(d, table);
    if (!info.length) continue;
    // 存在新代码不提供、却是 NOT NULL 且无默认值的列 → 必须重建
    const blocking = info.some(
      (i) => i.notnull === 1 && i.dflt === null && !cols.includes(i.name),
    );
    if (blocking) rebuildTable(d, table, cols);
  }

  // 废弃的旧表
  if (hasTable(d, "link")) {
    try {
      d.run("DROP TABLE link");
    } catch {
      /* noop */
    }
  }
}