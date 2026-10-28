import { Fragment, useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import { runSelfTest, type SelfTestItem } from "../engine/selftest";
import { runAcceptance, acceptanceToText, groupSummary, ACCEPTANCE_GROUPS, envLabel } from "../engine/acceptance";
import { healthState } from "../engine/health";

type Tab = "engine" | "acceptance";

const TAB_META: Record<Tab, { label: string; desc: string; empty: string }> = {
  engine: {
    label: "引擎自检",
    desc: "校验算法已知向量、字节序四排列、组包解包、位段、断言求值、帧识别。",
    empty: "点下方「开始自检」，会真实执行 14 项断言并给出实际值。",
  },
  acceptance: {
    label: "整机验收",
    desc: "模拟一台会回包的设备，真实跑一遍：组包 → 发送 → 回包 → 解包 → 断言 → 报告。结果可导出成《项目交付验收单》。",
    empty: "点下方「开始验收」，会用内置模拟设备真实跑完整条链路（不占串口、不需要硬件）。",
  },
};

export function SelfTestPanel() {
  const { showSelfTest, setShowSelfTest, health, setHealth, history, clearAcceptanceHistory } = useStore();
  const [tab, setTab] = useState<Tab>("acceptance");
  const [items, setItems] = useState<Record<Tab, SelfTestItem[]>>({ engine: [], acceptance: [] });
  const [ranAt, setRanAt] = useState<Record<Tab, string>>({ engine: "", acceptance: "" });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!showSelfTest) return null;

  const list = items[tab];
  const pass = list.filter((i) => i.ok).length;
  const meta = TAB_META[tab];

  const run = async () => {
    setBusy(true);
    setCopied(false);
    try {
      const res = tab === "engine" ? runSelfTest() : await runAcceptance();
      const at = new Date().toLocaleString();
      setItems((s) => ({ ...s, [tab]: res }));
      setRanAt((s) => ({ ...s, [tab]: at }));
      if (tab === "acceptance") {
        setHealth({
          at,
          pass: res.filter((x) => x.ok).length,
          total: res.length,
          failed: res.filter((x) => !x.ok).map((x) => x.name),
          env: envLabel(),
        });
      }
    } catch (e) {
      setItems((s) => ({
        ...s,
        [tab]: [{ name: "运行失败", ok: false, detail: String((e as Error).message ?? e), ms: 0 }],
      }));
    } finally {
      setBusy(false);
    }
  };

  const text = () => acceptanceToText(list, ranAt[tab] || new Date().toLocaleString(), tab === "acceptance" ? history.length : undefined);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
    } catch {
      // 剪贴板不可用时退化为选中文本
      setCopied(false);
    }
  };

  const exportTxt = () => {
    const blob = new Blob([text()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `serialmind-${tab === "engine" ? "自检" : "验收"}-${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="modal-mask" onClick={() => setShowSelfTest(false)}>
      <div className="modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-icon" style={{ background: "var(--bg-blue)" }}>
            <Icon cp={IC.check} size={12} color="var(--accent)" />
          </span>
          <div style={{ flex: 1 }}>
            <div className="row gap-8">
              <span className="modal-title">自检 / 验收</span>
              {list.length > 0 && (
                <span className={pass === list.length ? "pill green" : "pill red"}>
                  {pass}/{list.length} 通过
                </span>
              )}
            </div>
            <div className="modal-sub">{meta.desc}</div>
          </div>
          <button className="modal-close" onClick={() => setShowSelfTest(false)}>
            <Icon cp={IC.close} size={13} color="var(--t3)" />
          </button>
        </div>

        <div className="modal-body" style={{ paddingTop: 8 }}>
          <div className="side-tabs" style={{ marginBottom: 10 }}>
            {(["acceptance", "engine"] as Tab[]).map((k) => (
              <button key={k} className={tab === k ? "chip active" : "chip"} onClick={() => setTab(k)}>
                {TAB_META[k].label}
                {items[k].length > 0 && (
                  <span className="tag-mini" style={{ marginLeft: 4 }}>
                    {items[k].filter((x) => x.ok).length}/{items[k].length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {health && (
            <div className={`health-banner ${healthState(health)}`}>
              <Icon
                cp={healthState(health) === "ok" ? IC.check : IC.error}
                size={11}
                color={healthState(health) === "ok" ? "var(--green)" : "var(--red)"}
              />
              <span>
                上次验收：{health.pass}/{health.total} {healthState(health) === "ok" ? "通过" : "有失败项"} · {health.at}
                {healthState(health) === "stale" ? ` · 版本已变更（当时 v${health.version}）` : ""}
              </span>
              {health.failed.length > 0 && <span className="health-banner-failed">失败：{health.failed.join("、")}</span>}
            </div>
          )}

          {history.length > 0 && (
            <div className="accept-history">
              <div className="accept-history-head">
                <span>项目交付记录（最近 {history.length} 次验收）</span>
                <button className="link-btn" onClick={clearAcceptanceHistory}>
                  清空
                </button>
              </div>
              {history.slice(0, 5).map((h, i) => (
                <div className="accept-history-row" key={i}>
                  <Icon
                    cp={h.failed.length ? IC.error : IC.check}
                    size={9}
                    color={h.failed.length ? "var(--red)" : "var(--green)"}
                  />
                  <span className="r">
                    {h.pass}/{h.total}
                  </span>
                  <span className="t">{h.at}</span>
                  <span className="v">v{h.version}</span>
                </div>
              ))}
              {history.length > 5 && <div className="accept-history-more">还有 {history.length - 5} 条更早的记录</div>}
            </div>
          )}

          {list.length === 0 && (
            <div className="empty-block" style={{ padding: 32 }}>
              <Icon cp={IC.check} size={24} color="var(--t5)" />
              <div className="empty-title">还没有运行</div>
              <div className="empty-desc">{meta.empty}</div>
            </div>
          )}

          {list.length > 0 && tab === "acceptance" && (
            <div className="accept-groups">
              {groupSummary(list).map((g) => (
                <span key={g.group} className={g.ok ? "accept-chip ok" : "accept-chip bad"}>
                  <Icon cp={g.ok ? IC.check : IC.error} size={9} color={g.ok ? "var(--green)" : "var(--red)"} />
                  <span>
                    {g.group} {g.pass}/{g.total}
                  </span>
                </span>
              ))}
              {ACCEPTANCE_GROUPS.filter((g) => !list.some((x) => x.group === g)).map((g) => (
                <span key={g} className="accept-chip bad">
                  <Icon cp={IC.error} size={9} color="var(--red)" />
                  <span>{g} 未覆盖</span>
                </span>
              ))}
            </div>
          )}

          {list.length > 0 && (
            <div className="selfcheck">
              {list.map((it, i) => {
                const newGroup = !!it.group && (i === 0 || list[i - 1].group !== it.group);
                return (
                  <Fragment key={i}>
                    {newGroup && <div className="selfcheck-group">{it.group}</div>}
                    <div className="selfcheck-row">
                      <Icon cp={it.ok ? IC.check : IC.error} size={11} color={it.ok ? "var(--green)" : "var(--red)"} />
                      <span className="n">{it.name}</span>
                      <span className={`v ${it.ok ? "ok" : "bad"}`} style={{ maxWidth: 280, textAlign: "right" }}>
                        {it.detail}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--t4)", width: 42, textAlign: "right" }}>{it.ms}ms</span>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          )}

          {list.length > 0 && (
            <div className="row gap-8" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={copy}>
                <Icon cp={IC.copy} size={10} color="var(--t2)" />
                {copied ? "已复制" : "复制结果"}
              </button>
              <button className="btn sm" onClick={exportTxt}>
                <Icon cp={IC.export} size={10} color="var(--t2)" />
                导出报告
              </button>
              {ranAt[tab] && <span className="var-hint">运行于 {ranAt[tab]}</span>}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={() => setShowSelfTest(false)}>
            关闭
          </button>
          <button className="btn-primary" onClick={() => void run()} disabled={busy}>
            <Icon cp={IC.play} size={12} color="#fff" />
            <span>{busy ? "运行中…" : list.length ? "重新运行" : tab === "engine" ? "开始自检" : "开始验收"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
