/**
 * Repository 层（定稿 §9.2 第 6 条）
 * 所有 SQL 集中在这里，将来换成本地/远端双实现只改这一层。
 *
 * 结构：产品 → 子产品（固定协议）→ 角色 / 用例 / 规则；套件在产品级。
 */
import { flush, query, run, tableCount, tx, uuid, utcNow, exec } from "./db";
import type { CaseItem, CaseStep, ProductItem, RoleItem, RuleItem, RunResult, SubProductItem, SuiteItem } from "./types";

const TENANT = "local";

export interface Workspace {
  products: ProductItem[];
  subProducts: SubProductItem[];
  roles: RoleItem[];
  protocols: { id: string; productId: string; subProductId: string; name: string; version: string; pdlJson: string }[];
  cases: CaseItem[];
  suites: SuiteItem[];
  rules: RuleItem[];
}

function rows<T>(sql: string): T[] {
  return query<T>(sql);
}

function safeJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/* ---------------- 读取 ---------------- */

export function loadWorkspace(): Workspace {
  const products = rows<Record<string, unknown>>(`SELECT * FROM product WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at`).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    description: r.description ? String(r.description) : undefined,
  }));

  const subProducts = rows<Record<string, unknown>>(`SELECT * FROM subproduct WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at`).map((r) => ({
    id: String(r.id),
    productId: String(r.product_id),
    name: String(r.name ?? ""),
    protocolId: String(r.protocol_id ?? ""),
    note: r.note ? String(r.note) : undefined,
    order: Number(r.sort_order ?? 0),
  }));

  const roles = rows<Record<string, unknown>>(`SELECT * FROM role WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at`).map((r) => ({
    id: String(r.id),
    subProductId: String(r.subproduct_id),
    name: String(r.name ?? ""),
    address: Number(r.address ?? 0),
    note: r.note ? String(r.note) : undefined,
    order: Number(r.sort_order ?? 0),
  }));

  const protocols = rows<Record<string, unknown>>(`SELECT * FROM protocol WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at`).map((r) => ({
    id: String(r.id),
    productId: String(r.product_id),
    subProductId: String(r.subproduct_id ?? ""),
    name: String(r.name ?? ""),
    version: String(r.version ?? "v1"),
    pdlJson: String(r.pdl_json ?? "{}"),
    order: Number(r.sort_order ?? 0),
  }));

  const cases = rows<Record<string, unknown>>(`SELECT * FROM case_item WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at`).map((r) => {
    const steps = safeJson<CaseStep[]>(r.steps_json, []);
    return {
      id: String(r.id),
      subProductId: String(r.subproduct_id ?? ""),
      name: String(r.name ?? ""),
      roleId: String(r.role_id ?? ""),
      tags: safeJson<string[]>(r.tags, []),
      status: "idle" as const,
      statusText: "未运行",
      order: Number(r.sort_order ?? 0),
      stepCount: steps.length,
      assertionCount: steps.filter((s) => s.kind === "expect" || s.kind === "assertNo").length,
      dataDriven: r.data_source ? String(r.data_source) : undefined,
      steps,
      yaml: String(r.yaml ?? ""),
    };
  });

  const suites = rows<Record<string, unknown>>(`SELECT * FROM suite WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at`).map((r) => ({
    id: String(r.id),
    productId: String(r.product_id),
    name: String(r.name ?? ""),
    count: safeJson<string[]>(r.case_ids, []).length,
    desc: String(r.description ?? ""),
    tag: r.tag ? String(r.tag) : undefined,
    order: Number(r.sort_order ?? 0),
  }));

  const rules = rows<Record<string, unknown>>(`SELECT * FROM rule WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at`).map((r) => ({
    id: String(r.id),
    subProductId: String(r.subproduct_id ?? ""),
    name: String(r.name ?? ""),
    icon: String(r.icon ?? "\uF215"),
    iconColor: String(r.icon_color ?? "var(--green)"),
    trigger: String(r.trigger_text ?? ""),
    action: String(r.action_text ?? ""),
    enabled: Number(r.enabled ?? 1) === 1,
    hits: Number(r.hits ?? 0),
    lastRun: String(r.last_run ?? "—"),
    order: Number(r.sort_order ?? 0),
  }));

  return { products, subProducts, roles, protocols, cases, suites, rules };
}

export function isEmpty(): boolean {
  return tableCount("product") === 0;
}

/* ---------------- 写入（整体覆盖，数据量小、事务保证原子） ---------------- */

export function saveWorkspace(w: Workspace): void {
  const now = utcNow();
  tx(() => {
    exec(
      `DELETE FROM product; DELETE FROM subproduct; DELETE FROM role; DELETE FROM protocol;
       DELETE FROM case_item; DELETE FROM suite; DELETE FROM rule;`,
    );

    for (const p of w.products) {
      run(`INSERT INTO product (id, tenant_id, name, description, created_at, updated_at, rev, sort_order) VALUES (?,?,?,?,?,?,1,?)`, [
        p.id,
        TENANT,
        p.name,
        p.description ?? null,
        now,
        now,
        w.products.indexOf(p),
      ]);
    }

    for (const sp of w.subProducts) {
      run(
        `INSERT INTO subproduct (id, product_id, tenant_id, name, protocol_id, note, created_at, updated_at, rev, sort_order)
         VALUES (?,?,?,?,?,?,?,?,1,?)`,
        [sp.id, sp.productId, TENANT, sp.name, sp.protocolId, sp.note ?? null, now, now, w.subProducts.indexOf(sp)],
      );
    }

    for (const r of w.roles) {
      run(
        `INSERT INTO role (id, subproduct_id, tenant_id, name, address, note, created_at, updated_at, rev, sort_order)
         VALUES (?,?,?,?,?,?,?,?,1,?)`,
        [r.id, r.subProductId, TENANT, r.name, r.address, r.note ?? null, now, now, w.roles.indexOf(r)],
      );
    }

    for (const p of w.protocols) {
      run(
        `INSERT INTO protocol (id, product_id, subproduct_id, tenant_id, name, version, pdl_json, source_doc, created_at, updated_at, rev, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
        [p.id, p.productId, p.subProductId, TENANT, p.name, p.version, p.pdlJson, null, now, now, w.protocols.indexOf(p)],
      );
    }

    for (const c of w.cases) {
      const sub = w.subProducts.find((s) => s.id === c.subProductId);
      run(
        `INSERT INTO case_item (id, product_id, subproduct_id, role_id, tenant_id, name, tags, steps_json, yaml, data_source, created_at, updated_at, rev)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          c.id,
          sub?.productId ?? "",
          c.subProductId,
          c.roleId,
          TENANT,
          c.name,
          JSON.stringify(c.tags),
          JSON.stringify(c.steps),
          c.yaml,
          c.dataDriven ?? null,
          now,
          now,
        ],
      );
    }

    for (const s of w.suites) {
      run(
        `INSERT INTO suite (id, product_id, tenant_id, name, case_ids, description, tag, created_at, updated_at, rev, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
        [s.id, s.productId, TENANT, s.name, JSON.stringify([]), s.desc, s.tag ?? null, now, now, w.suites.indexOf(s)],
      );
    }

    for (const r of w.rules) {
      const sub = w.subProducts.find((s) => s.id === r.subProductId);
      run(
        `INSERT INTO rule (id, product_id, subproduct_id, tenant_id, name, icon, icon_color, trigger_text, action_text, enabled, hits, last_run, created_at, updated_at, rev, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
        [
          r.id,
          sub?.productId ?? "",
          r.subProductId,
          TENANT,
          r.name,
          r.icon,
          r.iconColor,
          r.trigger,
          r.action,
          r.enabled ? 1 : 0,
          r.hits,
          r.lastRun,
          now,
          now,
          w.rules.indexOf(r),
        ],
      );
    }
  });
}

export async function persist(w: Workspace): Promise<void> {
  saveWorkspace(w);
  await flush();
}

/* ---------------- 运行结果（报告持久化） ---------------- */

export function loadRuns(limit = 200): RunResult[] {
  return rows<Record<string, unknown>>(`SELECT * FROM run_result ORDER BY created_at DESC LIMIT ${limit}`).map((r) => ({
    id: String(r.id),
    caseId: String(r.case_id ?? ""),
    caseName: String(r.case_name ?? ""),
    suite: String(r.suite ?? ""),
    startedAt: String(r.started_at ?? ""),
    durationMs: Number(r.duration_ms ?? 0),
    status: (r.status === "pass" ? "pass" : "fail") as RunResult["status"],
    items: safeJson<RunResult["items"]>(r.items_json, []),
    reason: r.reason ? String(r.reason) : undefined,
  }));
}

export function appendRun(r: RunResult): void {
  run(
    `INSERT OR REPLACE INTO run_result (id, case_id, case_name, suite, status, duration_ms, started_at, reason, items_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      r.id,
      r.caseId,
      r.caseName,
      r.suite,
      r.status,
      r.durationMs,
      r.startedAt,
      r.reason ?? null,
      JSON.stringify(r.items),
      new Date().toISOString(),
    ],
  );
}

export function clearRunsTable(): void {
  exec("DELETE FROM run_result");
}

export { uuid };
