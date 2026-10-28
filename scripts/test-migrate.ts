/**
 * 迁移 + 枚举解析验证
 * 运行： npx tsx scripts/test-migrate.ts
 */
import initSqlJs from "sql.js";
import { migrate } from "../src/engine/migrate";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

const SQL = await initSqlJs();

function tableNames(db: any): string[] {
  const r = db.exec(`SELECT name FROM sqlite_master WHERE type='table'`);
  return r.length ? r[0].values.map((v: any[]) => v[0]) : [];
}
function columns(db: any, t: string): string[] {
  const r = db.exec(`PRAGMA table_info(${t})`);
  if (!r.length) return [];
  const i = r[0].columns.indexOf("name");
  return r[0].values.map((v: any[]) => v[i]);
}

console.log("\n[1] 全新数据库：建表齐全");
{
  const db = new SQL.Database();
  migrate(db);
  const tables = tableNames(db);
  for (const t of ["product", "subproduct", "role", "protocol", "case_item", "suite", "rule"]) {
    check(`有 ${t} 表`, tables.includes(t), tables.join(","));
  }
  check("protocol 有 subproduct_id", columns(db, "protocol").includes("subproduct_id"));
  check("case_item 有 role_id", columns(db, "case_item").includes("role_id"));
  check("rule 有 subproduct_id", columns(db, "rule").includes("subproduct_id"));
  check("suite 有 tag", columns(db, "suite").includes("tag"));
}

console.log("\n[2] 旧数据库（只有 link 表、protocol 无 subproduct_id）：自动升级不报错");
{
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE product (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, description TEXT,
      created_at TEXT, updated_at TEXT, rev INTEGER, deleted_at TEXT);
    CREATE TABLE link (id TEXT PRIMARY KEY, product_id TEXT, name TEXT, port TEXT, baud INTEGER);
    CREATE TABLE protocol (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, tenant_id TEXT,
      name TEXT, version TEXT, pdl_json TEXT, source_doc TEXT,
      created_at TEXT, updated_at TEXT, rev INTEGER, deleted_at TEXT);
    CREATE TABLE case_item (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, link_id TEXT,
      tenant_id TEXT, name TEXT, tags TEXT, steps_json TEXT, yaml TEXT, data_source TEXT,
      created_at TEXT, updated_at TEXT, rev INTEGER, deleted_at TEXT);
    CREATE TABLE rule (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, tenant_id TEXT, name TEXT,
      icon TEXT, icon_color TEXT, trigger_text TEXT, action_text TEXT,
      enabled INTEGER, hits INTEGER, last_run TEXT,
      created_at TEXT, updated_at TEXT, rev INTEGER, deleted_at TEXT);
    CREATE TABLE suite (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, tenant_id TEXT, name TEXT,
      case_ids TEXT, description TEXT, created_at TEXT, updated_at TEXT, rev INTEGER, deleted_at TEXT);
  `);
  db.run(`INSERT INTO product (id, tenant_id, name, created_at, updated_at, rev) VALUES ('p1','local','起重机','t','t',1)`);
  db.run(`INSERT INTO protocol (id, product_id, name, version, pdl_json, created_at, updated_at, rev) VALUES ('pr1','p1','老协议','v1','{}','t','t',1)`);

  let err = "";
  try {
    migrate(db);
  } catch (e) {
    err = (e as Error).message;
  }
  check("迁移不抛异常", err === "", err);
  const tables = tableNames(db);
  check("link 表已清理", !tables.includes("link"), tables.join(","));
  check("补出了 subproduct 表", tables.includes("subproduct"));
  check("补出了 role 表", tables.includes("role"));
  check("protocol 补了 subproduct_id", columns(db, "protocol").includes("subproduct_id"));
  check("case_item 补了 role_id", columns(db, "case_item").includes("role_id"));
  check("rule 补了 subproduct_id", columns(db, "rule").includes("subproduct_id"));
  check("suite 补了 tag", columns(db, "suite").includes("tag"));

  const prod = db.exec(`SELECT name FROM product WHERE id='p1'`);
  check("旧数据保留", prod[0]?.values[0]?.[0] === "起重机", JSON.stringify(prod[0]?.values));
  const proto = db.exec(`SELECT name FROM protocol WHERE id='pr1'`);
  check("旧协议保留", proto[0]?.values[0]?.[0] === "老协议");
}

console.log("\n[2.5] 老表有 NOT NULL link_id（新代码不填）→ 重建表后能写入");
{
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE product (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, rev INTEGER DEFAULT 1);
    CREATE TABLE case_item (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, link_id TEXT NOT NULL,
      tenant_id TEXT, name TEXT, tags TEXT, steps_json TEXT, yaml TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, rev INTEGER DEFAULT 1);
  `);
  db.run(`INSERT INTO product (id, tenant_id, name, created_at, updated_at, rev) VALUES ('p','local','P','t','t',1)`);
  db.run(`INSERT INTO case_item (id, product_id, link_id, name, created_at, updated_at, rev) VALUES ('c1','p','link-1','老用例','t','t',1)`);

  let err = "";
  try {
    migrate(db);
  } catch (e) {
    err = (e as Error).message;
  }
  check("迁移不抛异常", err === "", err);

  let writeErr = "";
  try {
    db.run(`INSERT INTO case_item (id, product_id, subproduct_id, role_id, tenant_id, name, tags, steps_json, yaml, created_at, updated_at, rev) VALUES ('c2','p','sp','r','local','新用例','[]','[]','',  't','t',1)`);
  } catch (e) {
    writeErr = (e as Error).message;
  }
  check("迁移后能写入新用例（不再被 link_id NOT NULL 卡住）", writeErr === "", writeErr);
  const rows = db.exec(`SELECT name FROM case_item ORDER BY name`);
  const names = rows[0]?.values.map((v: any[]) => v[0]) ?? [];
  check("老用例数据保留", names.includes("老用例"), names.join(","));
  check("新用例写入成功", names.includes("新用例"), names.join(","));
}

console.log("\n[3] 重复迁移是幂等的");
{
  const db = new SQL.Database();
  migrate(db);
  let err = "";
  try {
    migrate(db);
    migrate(db);
  } catch (e) {
    err = (e as Error).message;
  }
  check("连续迁移 3 次不报错", err === "", err);
}

console.log("\n[4] 迁移后能正常写入新结构");
{
  const db = new SQL.Database();
  migrate(db);
  db.run(`INSERT INTO product (id, tenant_id, name, created_at, updated_at, rev) VALUES ('p','local','P','t','t',1)`);
  db.run(`INSERT INTO subproduct (id, product_id, name, protocol_id, created_at, updated_at, rev) VALUES ('sp','p','子产品','pr','t','t',1)`);
  db.run(`INSERT INTO role (id, subproduct_id, name, address, created_at, updated_at, rev) VALUES ('r','sp','起升PLC',1,'t','t',1)`);
  db.run(`INSERT INTO protocol (id, product_id, subproduct_id, name, version, pdl_json, created_at, updated_at, rev) VALUES ('pr','p','sp','协议','v1','{}','t','t',1)`);
  const r = db.exec(`SELECT role.name, role.address, subproduct.name FROM role JOIN subproduct ON role.subproduct_id = subproduct.id`);
  check("新结构可写入并关联查询", r[0]?.values[0]?.[0] === "起升PLC" && r[0]?.values[0]?.[2] === "子产品", JSON.stringify(r[0]?.values));
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
console.log("数据库迁移已可用，老库不会报错 ✅");
