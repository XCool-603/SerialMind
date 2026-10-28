import { TestModeSwitch } from "../components/TestModeSwitch";
import { useEffect } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import { EmptyState } from "../components/Empty";

/* ================= 套件 ================= */
export function SuitePage() {
  const { suites, cases, activeSuiteId, setActiveSuite, setView, runActiveSuite, running, runs } = useStore();
  const countOf = (tag?: string) => (tag ? cases.filter((c) => c.tags.includes(tag)).length : cases.length);

  return (
    <div className="page">
        <TestModeSwitch />
      <div className="page-head">
        <div className="page-title-wrap">
          <div className="page-title">
            <span>套件</span>
            <span className="tag-mini" style={{ height: 16, fontSize: 10 }}>
              {suites.length}
            </span>
          </div>
          <div className="page-sub">
            <span>用例集合 → 一键跑 → 报告</span>
            <span style={{ color: "var(--t5)" }}>·</span>
            <span>套件按标签筛选用例，跑的是真实步骤</span>
          </div>
        </div>
        <div className="page-actions">
          <button
            className="btn-primary"
            style={{ height: 28, padding: "0 12px" }}
            disabled={running || cases.length === 0}
            onClick={() => void runActiveSuite()}
          >
            <Icon cp={IC.play} size={12} color="#fff" />
            <span>{running ? "运行中…" : "运行套件"}</span>
          </button>
        </div>
      </div>

      <div className="page-body" style={{ flexDirection: "column" }}>
        <div className="panel" style={{ flex: 1 }}>
          <div className="panel-head">
            <span className="panel-title">套件列表</span>
            <span className="spacer" />
            <span style={{ fontSize: 10, color: "var(--t4)" }}>共 {cases.length} 条用例</span>
          </div>
          <div className="panel-body">
            {suites.length === 0 ? (
              <EmptyState icon={IC.product} title="还没有套件" desc="套件在产品创建时会自动带两个默认项（冒烟 / 全量回归）。" />
            ) : (
              <table className="dt">
                <thead>
                  <tr>
                    <th style={{ width: 200 }}>套件</th>
                    <th style={{ width: 90 }}>用例数</th>
                    <th>说明</th>
                    <th style={{ width: 120 }}>最近运行</th>
                    <th style={{ width: 120 }} className="right">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {suites.map((s) => {
                    const lastRun = runs.find((r) => r.suite === s.name);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setActiveSuite(s.id)}
                        style={s.id === activeSuiteId ? { background: "#16233a" } : undefined}
                      >
                        <td className="name">
                          <span className="row gap-6">
                            <Icon cp={IC.product} size={12} color="var(--accent)" />
                            {s.name}
                          </span>
                        </td>
                        <td className="num">{countOf(s.tag)}</td>
                        <td>{s.desc || (s.tag ? `按标签「${s.tag}」筛选` : "全部用例")}</td>
                        <td>{lastRun ? lastRun.startedAt : "未运行"}</td>
                        <td className="right">
                          <button
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSuite(s.id);
                              void runActiveSuite();
                            }}
                          >
                            运行
                          </button>
                          <button
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setView("report");
                            }}
                          >
                            报告
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-head">
            <span className="panel-title">成员用例</span>
            <span className="spacer" />
            <span style={{ fontSize: 10, color: "var(--t4)" }}>{cases.length} 条</span>
          </div>
          <div className="panel-body">
            {cases.length === 0 ? (
              <EmptyState icon={IC.case} title="还没有用例" desc="到「用例」页新建用例后，套件会自动包含它们。">
                <button className="btn" onClick={() => setView("case")}>
                  去用例页
                </button>
              </EmptyState>
            ) : (
              cases.map((c) => (
                <div className="link-card" key={c.id}>
                  <Icon
                    cp={c.status === "passed" ? IC.check : c.status === "failed" ? IC.error : IC.history}
                    size={11}
                    color={c.status === "passed" ? "var(--green)" : c.status === "failed" ? "var(--red)" : "var(--t3)"}
                  />
                  <div>
                    <div className="link-name">{c.name}</div>
                    <div className="link-meta">
                      {c.steps.length} 步骤 · 标签 {c.tags.join(" / ") || "无"}
                    </div>
                  </div>
                  <div className="link-actions">
                    <span style={{ fontSize: 10, color: "var(--t3)" }}>{c.statusText}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="page-foot">
        <span>共 {suites.reduce((a, b) => a + countOf(b.tag), 0)} 项</span>
        <span className="right">
          <span>运行结果会写入报告页</span>
        </span>
      </div>
    </div>
  );
}

/* ================= 报告 ================= */
function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ReportPage() {
  const { runs, suites, activeSuiteId, running, runFailedCases, clearRuns, setView, runningSuiteName, cases } = useStore();
  const suite = suites.find((s) => s.id === activeSuiteId);
  const total = runs.length;
  const passed = runs.filter((r) => r.status === "pass").length;
  const failed = total - passed;
  const rate = total ? (passed / total) * 100 : 0;
  const last = runs[0];

  /* 趋势统计：近 10 次通过率、平均/最大响应、累计发送 */
  const recent10 = runs.slice(0, 10);
  const recent10Rate = recent10.length ? Math.round((recent10.filter((r) => r.status === "pass").length / recent10.length) * 100) : 0;
  const withStats = runs.filter((r) => r.stats);
  const avgResp = withStats.length ? Math.round(withStats.reduce((a, r) => a + (r.stats?.avgMs ?? 0), 0) / withStats.length) : 0;
  const maxResp = withStats.length ? Math.max(...withStats.map((r) => r.stats?.maxMs ?? 0)) : 0;
  const totalSent = runs.reduce((a, r) => a + (r.stats?.sent ?? 0), 0);
  const maxDur = Math.max(1, ...runs.slice(0, 30).map((x) => x.durationMs));

  const exportHtml = () => {
    const rows = runs
      .map(
        (r) =>
          `<tr><td>${r.status === "pass" ? "✓" : "✗"}</td><td>${r.caseName}</td><td>${r.suite}</td><td>${r.durationMs}ms</td><td>${(r.reason ?? "").replace(/</g, "&lt;")}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html><meta charset="utf-8"><title>SerialMind 报告</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0e13;color:#e6edf3;padding:24px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #243040;padding:8px;text-align:left}
th{color:#8b98a8;font-weight:500}h1{font-size:18px}</style>
<h1>SerialMind 运行报告</h1>
<p>生成时间 ${new Date().toLocaleString()} · 共 ${total} 条 · 通过 ${passed} · 失败 ${failed} · 通过率 ${rate.toFixed(1)}%</p>
<table><thead><tr><th></th><th>用例</th><th>套件</th><th>耗时</th><th>失败原因</th></tr></thead><tbody>${rows}</tbody></table>`;
    download(`serialmind-report-${Date.now()}.html`, html, "text/html");
  };

  const exportJunit = () => {
    const suitesXml = suites
      .map((s) => {
        const rs = runs.filter((r) => r.suite === s.name);
        if (!rs.length) return "";
        const f = rs.filter((r) => r.status === "fail").length;
        const casesXml = rs
          .map((r) => {
            const body =
              r.status === "fail"
                ? `<failure message="${(r.reason ?? "failed").replace(/"/g, "'")}">${r.items
                    .map((i) => `${i.text} ${i.expected ?? ""} / ${i.actual ?? ""}`)
                    .join("\n")
                    .replace(/</g, "&lt;")}</failure>`
                : "";
            return `<testcase classname="${s.name}" name="${r.caseName}" time="${(r.durationMs / 1000).toFixed(3)}">${body}</testcase>`;
          })
          .join("");
        return `<testsuite name="${s.name}" tests="${rs.length}" failures="${f}">${casesXml}</testsuite>`;
      })
      .join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${total}" failures="${failed}">${suitesXml}</testsuites>`;
    download(`serialmind-junit-${Date.now()}.xml`, xml, "application/xml");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title-wrap">
          <div className="page-title">
            <span>套件运行报告</span>
            <span className="product-switch" style={{ height: 26, padding: "0 8px" }}>
              <Icon cp={IC.product} size={12} color="var(--accent)" />
              <span style={{ fontSize: 11, color: "var(--t1)" }}>{suite?.name ?? "全部用例"}</span>
              <span className="badge-count" style={{ height: 14 }}>
                {total} 条记录
              </span>
            </span>
          </div>
          <div className="page-sub">
            {last ? (
              <>
                <span>最近一次 {last.startedAt}</span>
                <span style={{ color: "var(--t5)" }}>·</span>
                <span>{runningSuiteName || last.suite}</span>
              </>
            ) : (
              <span>还没有运行记录 —— 到「套件」或「用例」页点运行</span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={exportHtml} disabled={!total}>
            <Icon cp={IC.export} size={11} color="var(--t2)" />
            <span>HTML</span>
          </button>
          <button className="btn" onClick={exportJunit} disabled={!total}>
            <Icon cp={IC.code} size={11} color="var(--t2)" />
            <span>JUnit XML</span>
          </button>
          <button className="btn" onClick={clearRuns} disabled={!total}>
            清空记录
          </button>
          <button
            className="btn-primary"
            style={{ height: 28, padding: "0 12px" }}
            disabled={!failed || running}
            onClick={() => void runFailedCases()}
          >
            <Icon cp={IC.play} size={12} color="#fff" />
            <span>复跑失败 {failed} 项</span>
          </button>
        </div>
      </div>

      <div className="report-layout">
        <div className="report-main">
          <div className="stat-row">
            <div className="stat-card">
              <span className="stat-label">运行记录</span>
              <span className="stat-value">{total}</span>
              <span className="stat-sub">{cases.length} 条用例可执行</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">通过</span>
              <span className="stat-value green">{passed}</span>
              <span className="stat-sub">真实断言结果</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">失败</span>
              <span className="stat-value red">{failed}</span>
              <span className="stat-sub">含期望 / 实际对比</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">通过率</span>
              <span className="stat-value">{rate.toFixed(1)}%</span>
              <div className="progress">
                <span style={{ width: `${rate}%`, background: "var(--green)" }} />
                <span style={{ width: `${100 - rate}%`, background: "var(--red)" }} />
              </div>
            </div>
          </div>
          {/* 趋势：最近 N 次运行 */}
          {runs.length > 0 && (
            <div className="panel" style={{ flex: "0 0 auto" }}>
              <div className="panel-head">
                <Icon cp={IC.history} size={11} color="var(--t3)" />
                <span>趋势</span>
                <span className="pill gray">最近 {Math.min(runs.length, 30)} 次</span>
                <span className="spacer" />
                <span className="panel-sub">柱高=耗时 · 绿=通过 · 红=失败</span>
              </div>
              <div style={{ padding: "10px 12px 12px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56, justifyContent: "flex-start", overflow: "hidden" }}>
                  {runs
                    .slice(0, 30)
                    .reverse()
                    .map((r) => {
                      return (
                        <span
                          key={r.id}
                          title={`${r.startedAt} · ${r.caseName} · ${r.status === "pass" ? "通过" : "失败"} · ${r.durationMs}ms`}
                          style={{
                            width: 14,
                            flex: "0 0 auto",
                            height: `${Math.max(10, (r.durationMs / maxDur) * 100)}%`,
                            borderRadius: 2,
                            background: r.status === "pass" ? "var(--green)" : "var(--red)",
                            opacity: 0.85,
                          }}
                        />
                      );
                    })}
                </div>
                <div className="row gap-16" style={{ marginTop: 10, fontSize: 11, color: "var(--t3)" }}>
                  <span>
                    近 10 次通过率 <b style={{ color: "var(--t1)" }}>{recent10Rate}%</b>
                  </span>
                  <span>
                    平均响应 <b style={{ color: "var(--t1)" }}>{withStats.length ? `${avgResp}ms` : "—"}</b>
                  </span>
                  <span>
                    最大响应 <b style={{ color: "var(--t1)" }}>{withStats.length ? `${maxResp}ms` : "—"}</b>
                  </span>
                  <span>
                    累计发送 <b style={{ color: "var(--t1)" }}>{totalSent}</b> 帧
                  </span>
                </div>
              </div>
            </div>
          )}


          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-head">
              <span className="panel-title">执行结果</span>
              <span className="spacer" />
              <span style={{ fontSize: 10, color: "var(--t4)" }}>点「详情」查看每一步的期望 / 实际</span>
            </div>
            <div className="panel-body">
              {total === 0 ? (
                <EmptyState
                  icon={IC.report}
                  title="还没有运行记录"
                  desc="报告只由真实执行产生。先到「用例」页新建用例并运行，或到「套件」页跑一个套件。"
                >
                  <button className="btn" onClick={() => setView("case")}>
                    去用例页
                  </button>
                  <button className="btn" onClick={() => setView("suite")}>
                    去套件页
                  </button>
                </EmptyState>
              ) : (
                <table className="dt">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }} />
                      <th style={{ width: 220 }}>用例</th>
                      <th style={{ width: 100 }}>套件</th>
                      <th style={{ width: 80 }} className="right">
                        耗时
                      </th>
                      <th>失败原因</th>
                      <th style={{ width: 80 }} className="right">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} data-status={r.status} title={r.status === "pass" ? "通过" : "失败"}>
                        <td>
                          <Icon
                            cp={r.status === "pass" ? IC.check : IC.error}
                            size={11}
                            color={r.status === "pass" ? "var(--green)" : "var(--red)"}
                          />
                        </td>
                        <td className="name">{r.caseName}</td>
                        <td>{r.suite}</td>
                        <td className="right num">
                          {r.durationMs}ms
                          {r.stats && (
                            <div style={{ fontSize: 9, color: "var(--t4)", whiteSpace: "nowrap" }}>
                              发 {r.stats.sent} · 收 {r.stats.received} · 丢 {r.stats.lost} · 均 {r.stats.avgMs}ms
                            </div>
                          )}
                        </td>
                        <td style={{ color: r.status === "fail" ? "var(--red)" : "var(--t3)" }}>{r.reason ?? "—"}</td>
                        <td className="right">
                          <button className="btn sm" onClick={() => setView("case")}>
                            详情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="report-side">
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">失败用例</span>
              <span className="pill red" style={{ marginLeft: 6 }}>
                {failed}
              </span>
            </div>
            <div className="panel-body">
              {failed === 0 && <div className="empty-block" style={{ padding: 24 }}>没有失败用例</div>}
              {runs
                .filter((r) => r.status === "fail")
                .map((r) => (
                  <div className="fail-item" key={r.id}>
                    <span className="fail-icon">
                      <Icon cp={IC.error} size={10} color="var(--red)" />
                    </span>
                    <div className="fail-body">
                      <span className="fail-name">{r.caseName}</span>
                      <span className="fail-reason">{r.reason}</span>
                      <span className="fail-meta">
                        <span>{r.suite}</span>
                        <span>·</span>
                        <span>{r.durationMs}ms</span>
                        <span className="spacer" />
                        <button className="btn sm" onClick={() => setView("case")}>
                          查看
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="pdl-card">
            <div className="pdl-card-head">
              <Icon cp={IC.list} size={11} color="var(--t3)" />
              <span className="pdl-card-title">失败步骤明细</span>
            </div>
            <div className="assert-list">
              {runs
                .filter((r) => r.status === "fail")
                .slice(0, 4)
                .flatMap((r) =>
                  r.items
                    .filter((i) => i.status === "fail")
                    .map((i, idx) => (
                      <div className="assert-row" key={`${r.id}-${idx}`}>
                        <span className="dot" style={{ background: "var(--red)" }} />
                        <span className="n">
                          {r.caseName} · {i.text}
                        </span>
                        <span className="c">{i.durationMs}ms</span>
                      </div>
                    )),
                )}
              {failed === 0 && <div className="ai-hint">暂无</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="page-foot">
        <span>
          共 {total} 条 · 通过 {passed} · 失败 {failed}
        </span>
        <span className="right">
          <span>HTML / JUnit XML 可导出</span>
          <span>全部数据来自真实执行</span>
        </span>
      </div>
    </div>
  );
}