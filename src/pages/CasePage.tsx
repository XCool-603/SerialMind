import { useEffect, useMemo, useRef, useState } from "react";
import { encodeMessage } from "../engine/codec";
import { toHex } from "../engine/bytes";
import { useStore } from "../engine/store";
import type { CasePacketAction, CaseStep } from "../engine/types";
import type { PdlProtocol } from "../engine/pdl";
import { Icon, IC } from "../components/Icon";
import { EmptyState } from "../components/Empty";

/** 实时计算某个协议动作在第 round 轮的组包 HEX 与展示 */
function computeActionPreview(proto: PdlProtocol | undefined, action: CasePacketAction, round: number) {
  if (!proto) return { hex: "—", len: 0, valSummary: "" };
  const msg = (action.messageId ? proto.messages.find((m) => m.id === action.messageId) : null) ?? proto.messages[0];
  if (!msg) return { hex: "—", len: 0, valSummary: "" };

  try {
    // 1. 基准值 100% 动态读取协议中当前定义的最新字段与默认值
    const vals: Record<string, number | string | boolean> = {};
    for (const f of msg.fields) {
      if (f.type === "crc" || f.offset < 0) continue;
      vals[f.name] = Number(f.value ?? 0);
    }
    // 2. 只有当前协议依然存在的字段，才应用用例自定义覆盖与步长
    for (const r of action.fields ?? []) {
      const fld = msg.fields.find((f) => f.name === r.fieldName);
      if (!fld) continue;
      const base = r.customInit !== undefined
        ? r.customInit
        : (r.initValue !== undefined && r.initValue !== null ? r.initValue : Number(fld.value ?? 0));
      const step = r.step ?? 0;
      vals[r.fieldName] = base + (step * round);
    }
    const bytes = encodeMessage(proto, msg, vals);
    const valSummary = msg.fields
      .filter((f) => f.type !== "crc" && f.offset >= 0 && action.fields?.some((af) => af.fieldName === f.name && af.step !== 0))
      .map((f) => `${f.name}=${vals[f.name]}`)
      .join(", ");
    return {
      hex: toHex(bytes),
      len: bytes.length,
      valSummary: valSummary || "基准值",
    };
  } catch (e) {
    return { hex: "组包错误: " + (e as Error).message, len: 0, valSummary: "" };
  }
}

export function CasePage() {
  const {
    cases,
    subProducts,
    protocols,
    activeCaseId,
    setActiveCase,
    createCase,
    duplicateCase,
    deleteCase,
    updateCase,
    runActiveCase,
    running,
    liveSteps,
    runs,
    requestStop,
    clearRuns,
    connection,
  } = useStore();

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("全部");
  const liveStreamEndRef = useRef<HTMLDivElement | null>(null);

  const active = cases.find((c) => c.id === activeCaseId) ?? cases[0];

  useEffect(() => {
    if (running && liveStreamEndRef.current) {
      liveStreamEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveSteps.length, running]);

  const handleRunClick = () => {
    if (running) {
      requestStop();
      return;
    }
    if (!connection.connected) {
      const ok = window.confirm(
        `【提示】当前串口未打开！\n\n点击「确定」将以本地模拟模式执行（在软件中自动计算步长和验证，但不向硬件写入）。\n如需发送到实际硬件，请先在顶栏点击「打开串口」。`,
      );
      if (!ok) return;
    }
    void runActiveCase();
  };

  // 过滤后的用例列表
  const filtered = useMemo(() => {
    return cases.filter((c) => {
      if (query && !c.name.includes(query)) return false;
      if (tagFilter === "全部") return true;
      return c.tags.includes(tagFilter);
    });
  }, [cases, query, tagFilter]);

  // 当前用例最近一次执行结果
  const lastRun = runs.find((r) => r.caseId === active?.id);

  // 初始化或提取当前用例的任务动作列表（每个动作绑定用户添加的一个协议）
  const actions: CasePacketAction[] = useMemo(() => {
    if (active?.actions && active.actions.length > 0) return active.actions;
    // 兼容老版本的 fieldRules
    if (active?.fieldRules && active.fieldRules.length > 0 && protocols[0]) {
      const p = protocols[0];
      const msg = p.messages[0];
      return [
        {
          id: "act-legacy",
          name: `下发「${p.name}」`,
          protocolId: p.id,
          messageId: msg?.id,
          intervalMs: active.intervalMs ?? 1000,
          enabled: true,
          fields: active.fieldRules.map((r) => ({ fieldName: r.fieldName, initValue: r.initValue, step: r.step })),
        },
      ];
    }
    return [];
  }, [active?.actions, active?.fieldRules, active?.intervalMs, protocols]);

  // 更新当前用例动作列表
  const saveActions = (newActions: CasePacketAction[]) => {
    if (!active) return;
    updateCase(active.id, { actions: newActions });
  };

  // 添加一个新的协议下发任务卡片（从用户添加的协议中选）
  const handleAddAction = (protoId?: string) => {
    if (!protocols.length) {
      void import("../lib/actions").then((m) => m.newProtocol());
      return;
    }
    const targetProto =
      (protoId ? protocols.find((p) => p.id === protoId) : null) ??
      protocols.find((p) => p.id === useStore.getState().activeProtocolId) ??
      protocols[0];
    if (!targetProto) return;
    const targetMsg = targetProto.messages[0];

    const newAct: CasePacketAction = {
      id: `act_${Date.now()}`,
      name: `下发「${targetProto.name}」`,
      protocolId: targetProto.id,
      messageId: targetMsg?.id,
      intervalMs: active.intervalMs ?? 1000,
      enabled: true,
      fields: [], // 纯动态：默认 100% 动态读取 targetProto 的字段与默认值，无需存死字段快照！
    };
    saveActions([...actions, newAct]);
  };

  // 断言步骤列表（可视化配置，不写代码）
  const assertionSteps = useMemo(() => {
    return (active?.steps ?? []).filter((s) => s.kind === "expect" || s.kind === "assert");
  }, [active?.steps]);

  // 添加断言步骤
  const handleAddAssertion = () => {
    if (!active) return;
    const newStep: CaseStep = {
      id: `s_assert_${Date.now()}`,
      kind: "assert",
      text: "断言响应回包",
      fields: [{ label: "contains", value: "01 03" }],
      timeout: "2000ms",
    };
    updateCase(active.id, { steps: [...(active.steps ?? []), newStep] });
  };

  // 删除断言步骤
  const handleDeleteAssertion = (stepId: string) => {
    if (!active) return;
    updateCase(active.id, { steps: (active.steps ?? []).filter((s) => s.id !== stepId) });
  };

  if (!active) {
    return (
      <div className="page">
        <div className="content">
          <EmptyState
            icon={IC.case}
            title="还没有自动化用例"
            desc="用例用于自动化循环发送心跳协议、车辆行走协议等任务，完全免代码图形化配置。"
          >
            <button className="btn-primary" onClick={() => createCase("车辆自动化测试")}>
              <Icon cp={IC.plus} size={11} color="#fff" />
              新建用例
            </button>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: 0 }}>
      <div className="case-layout">
        {/* 左侧：用例列表 */}
        <div className="case-list" style={{ paddingTop: 14 }}>
          <div className="search-box">
            <Icon cp={IC.search} size={12} color="var(--t4)" />
            <input placeholder="搜索自动化用例" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button
              className="add-btn"
              style={{ width: 18, height: 18 }}
              title="新建用例"
              onClick={() => {
                const name = window.prompt("请输入用例名称", "心跳与行走自动化");
                if (name?.trim()) createCase(name.trim());
              }}
            >
              <Icon cp={IC.plus} size={11} color="var(--t2)" />
            </button>
          </div>

          <div className="case-chips">
            {["全部", "冒烟", "专项"].map((t) => (
              <button
                key={t}
                className={tagFilter === t ? "chip active" : "chip"}
                onClick={() => setTagFilter(t)}
                style={{ height: 20, fontSize: 10 }}
              >
                {t}
                {t === "全部" && <span style={{ color: "var(--t4)" }}>{cases.length}</span>}
              </button>
            ))}
          </div>

          <div className="case-items">
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`case-card${c.id === activeCaseId ? " active" : ""}`}
                onClick={() => setActiveCase(c.id)}
              >
                <div className="case-card-top">
                  <span className="case-card-name">{c.name}</span>
                  <span className="spacer" />
                  {c.tags[0] && (
                    <span className="tag-mini" style={{ fontSize: 8 }}>
                      {c.tags[0]}
                    </span>
                  )}
                </div>
                <div className="case-card-meta">
                  {(c.actions?.length || (c.fieldRules?.length ? 1 : 0))} 个协议任务 · {c.steps?.length ?? 0} 个断言
                </div>
                <div className={`case-card-status ${c.status === "passed" ? "pass" : c.status === "failed" ? "fail" : "idle"}`}>
                  <Icon
                    cp={c.status === "passed" ? IC.check : c.status === "failed" ? IC.error : IC.history}
                    size={9}
                    color={c.status === "passed" ? "var(--green)" : c.status === "failed" ? "var(--red)" : "var(--t3)"}
                  />
                  <span>{c.statusText || "未运行"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 中间：纯图形化用例编排（免代码，100% 动态读取用户协议的字段） */}
        <div className="case-main" style={{ overflowY: "auto", padding: "16px 20px" }}>
          {/* 用例顶栏 */}
          <div className="case-head" style={{ marginBottom: 14 }}>
            <div>
              <div className="row gap-8" style={{ alignItems: "center" }}>
                <input
                  type="text"
                  className="proto-input"
                  style={{ fontSize: 15, fontWeight: 600, width: 220, height: 28, background: "transparent", border: "1px solid transparent" }}
                  value={active.name}
                  onChange={(e) => updateCase(active.id, { name: e.target.value })}
                />
                <span className="tag-mini" style={{ color: "var(--t3)" }}>
                  子产品: {subProducts.find((x) => x.id === active.subProductId)?.name ?? "主模块"}
                </span>
                <span className="tag-mini" style={{ background: "rgba(88, 166, 255, 0.15)", color: "var(--accent)" }}>
                  可用协议: {protocols.length} 个
                </span>
              </div>
            </div>

            <div className="case-head-actions">
              <button
                className="btn-primary"
                style={{
                  height: 32,
                  padding: "0 18px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: running ? "var(--red)" : "var(--green)",
                  borderColor: running ? "var(--red)" : "var(--green)",
                }}
                onClick={handleRunClick}
              >
                <Icon cp={running ? IC.close : IC.play} size={13} color="#fff" />
                <span>{running ? "停止执行" : "▶ 运行用例"}</span>
              </button>
            </div>
          </div>

          {/* 全局循环与周期控制栏 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 14px", background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)" }}>自动化循环设置：</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--t2)" }}>
              <span>下发周期:</span>
              <input
                type="number"
                className="proto-input"
                style={{ width: 60 }}
                value={active.intervalMs ?? 1000}
                onChange={(e) => updateCase(active.id, { intervalMs: Math.max(10, Number(e.target.value) || 0) })}
              />
              <span>ms (默认1秒)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--t2)" }}>
              <span>循环轮次:</span>
              <input
                type="number"
                className="proto-input"
                style={{ width: 55 }}
                value={active.repeat ?? 100}
                onChange={(e) => updateCase(active.id, { repeat: Math.max(0, Number(e.target.value) || 0) })}
              />
              <span>轮 (设 0 为持续下发直到手动停止)</span>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--t3)", cursor: "pointer", marginLeft: "auto" }}>
              <input
                type="checkbox"
                checked={active.stopOnFail !== false}
                onChange={(e) => updateCase(active.id, { stopOnFail: e.target.checked })}
              />
              <span>断言失败立即停止</span>
            </label>
          </div>

          {/* 实时执行监控控制台（Apifox Runner 核心体验：发包流水、数值自增实时可见） */}
          {(running || liveSteps.length > 0 || (lastRun && lastRun.items.length > 0)) && (
            <div
              style={{
                marginBottom: 16,
                background: "var(--bg-panel-1)",
                border: running ? "1px solid var(--accent)" : "1px solid var(--line-2)",
                borderRadius: 8,
                overflow: "hidden",
                boxShadow: running ? "0 0 12px rgba(88, 166, 255, 0.2)" : "none",
              }}
            >
              {/* 控制台顶栏 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: running ? "rgba(88, 166, 255, 0.1)" : "var(--bg-panel-2)",
                  borderBottom: "1px solid var(--line-2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {running ? (
                    <span className="dot on" style={{ background: "var(--green)", width: 8, height: 8 }} />
                  ) : lastRun?.status === "pass" ? (
                    <Icon cp={IC.check} size={13} color="var(--green)" />
                  ) : (
                    <Icon cp={IC.error} size={13} color="var(--red)" />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)" }}>
                    {running
                      ? "自动化测试正在运行中…"
                      : lastRun?.status === "pass"
                        ? "本轮自动化测试已完成（全部通过）"
                        : `本轮测试结束（${lastRun?.reason || "有断言失败"}）`}
                  </span>
                  <span className="tag-mini">
                    {running
                      ? `已执行 ${liveSteps.length} 次下发`
                      : `共 ${lastRun?.items.length ?? liveSteps.length} 步 · 耗时 ${lastRun?.durationMs ?? 0}ms`}
                  </span>
                  {!connection.connected ? (
                    <span className="pill amber" style={{ fontSize: 9 }}>
                      本地模拟模式 (串口未打开)
                    </span>
                  ) : (
                    <span className="pill green" style={{ fontSize: 9 }}>
                      真实串口下发中 ({connection.port})
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {running ? (
                    <button
                      className="btn sm"
                      style={{ background: "var(--red)", borderColor: "var(--red)", color: "#fff", fontWeight: 600, height: 24, padding: "0 10px" }}
                      onClick={() => requestStop()}
                    >
                      ■ 停止运行
                    </button>
                  ) : (
                    <button
                      className="btn sm"
                      style={{ height: 24, fontSize: 10, padding: "0 8px" }}
                      onClick={() => useStore.setState({ liveSteps: [] })}
                      title="清空流水日志"
                    >
                      清空流水
                    </button>
                  )}
                </div>
              </div>

              {/* 实时流水列表 */}
              <div
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  padding: "6px 10px",
                  fontSize: 11,
                  fontFamily: "var(--font-mono, monospace)",
                  background: "var(--bg-main)",
                }}
              >
                {(running || liveSteps.length > 0 ? liveSteps : lastRun?.items ?? []).map((step, idx) => (
                  <div
                    key={step.stepId || idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 0",
                      borderBottom: "1px solid var(--line-3)",
                      lineHeight: "1.5",
                    }}
                  >
                    <span style={{ color: "var(--t4)", fontSize: 10, width: 55 }}>{step.startedAt}</span>
                    <span style={{ fontWeight: 600, color: "var(--t1)", width: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {step.text}
                    </span>
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 3,
                        background: "var(--bg-panel-2)",
                        color: "var(--accent)",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.5px",
                      }}
                    >
                      {step.frameHex || "—"}
                    </span>
                    <span style={{ color: "var(--green)", fontSize: 11, marginLeft: 4, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {step.expected || ""}
                    </span>
                    <span
                      style={{
                        color: step.status === "pass" ? "var(--green)" : "var(--red)",
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: 3,
                        background: step.status === "pass" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                      }}
                    >
                      {step.status === "pass" ? "成功" : "失败"}
                    </span>
                  </div>
                ))}
                <div ref={liveStreamEndRef} />
              </div>
            </div>
          )}

          {/* 协议任务列表 (免代码图形化卡片，从我添加的协议中选) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon cp={IC.protocol} size={15} color="var(--accent)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>协议自动化下发任务</span>
              <span className="tag-mini">{actions.length} 个任务</span>
            </div>
            {protocols.length > 0 && (
              <button
                className="btn-primary"
                style={{ height: 26, padding: "0 10px", fontSize: 11 }}
                onClick={() => handleAddAction()}
                title="从我添加的协议中新增一个下发任务"
              >
                <Icon cp={IC.plus} size={11} color="#fff" />
                <span>添加协议下发任务</span>
              </button>
            )}
          </div>

          {actions.length === 0 && (
            <div style={{ padding: "32px 20px", textAlign: "center", background: "var(--bg-panel-1)", border: "1px dashed var(--line-2)", borderRadius: 8, margin: "10px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)", marginBottom: 6 }}>
                当前用例还没有配置协议下发任务
              </div>
              <div style={{ fontSize: 11, color: "var(--t3)", marginBottom: 16 }}>
                {protocols.length > 0
                  ? "选择您已添加的通信协议，即可在界面中配置定时发送、每秒字段增量（例如行驶距离每秒+10米、心跳序号+1）。"
                  : "当前系统中还没有任何通信协议，请先前往「协议」页新建您的通信协议。"}
              </div>
              {protocols.length > 0 ? (
                <button
                  className="btn-primary"
                  style={{ height: 30, padding: "0 16px", fontSize: 12, margin: "0 auto", display: "inline-flex", alignItems: "center", gap: 6 }}
                  onClick={() => handleAddAction()}
                >
                  <Icon cp={IC.plus} size={12} color="#fff" />
                  <span>选择我的协议并添加任务</span>
                </button>
              ) : (
                <button
                  className="btn-primary"
                  style={{ height: 30, padding: "0 16px", fontSize: 12, margin: "0 auto", display: "inline-flex", alignItems: "center", gap: 6 }}
                  onClick={() => useStore.getState().setView("protocol")}
                >
                  <Icon cp={IC.protocolDoc} size={12} color="#fff" />
                  <span>去「协议」页新建我的协议</span>
                </button>
              )}
            </div>
          )}

          {actions.map((act, actIdx) => {
            // 直接从用户添加的协议中查找对应的协议！
            const currentProto = protocols.find((p) => p.id === act.protocolId) ?? protocols[0];
            const currentMsg = (act.messageId ? currentProto?.messages.find((m) => m.id === act.messageId) : null) ?? currentProto?.messages[0];
            const prev1 = computeActionPreview(currentProto, act, 0);
            const prev2 = computeActionPreview(currentProto, act, 1);
            const prev3 = computeActionPreview(currentProto, act, 2);

            return (
              <div key={act.id} className={`action-task-card${act.enabled === false ? " disabled" : ""}`}>
                {/* 任务卡片头部：从我添加的协议中选择 */}
                <div className="action-task-head">
                  <input
                    type="checkbox"
                    checked={act.enabled !== false}
                    onChange={(e) => {
                      const next = actions.map((a, i) => (i === actIdx ? { ...a, enabled: e.target.checked } : a));
                      saveActions(next);
                    }}
                    title="启用/禁用此任务"
                  />
                  <input
                    type="text"
                    className="proto-input"
                    style={{ width: 170, fontWeight: 600, color: "var(--t1)" }}
                    value={act.name}
                    onChange={(e) => {
                      const next = actions.map((a, i) => (i === actIdx ? { ...a, name: e.target.value } : a));
                      saveActions(next);
                    }}
                  />

                  {/* 核心：直接从我添加的协议列表中选！ */}
                  <span style={{ fontSize: 11, color: "var(--t2)", marginLeft: 6, fontWeight: 500 }}>选择下发协议:</span>
                  <select
                    className="cell-select"
                    style={{ height: 26, fontSize: 11, background: "var(--bg-panel-2)", border: "1px solid var(--accent)", color: "#fff", fontWeight: 600, borderRadius: 4, padding: "0 6px" }}
                    value={currentProto?.id}
                    onChange={(e) => {
                      const selectedProto = protocols.find((p) => p.id === e.target.value);
                      if (!selectedProto) return;
                      const msg = selectedProto.messages[0];
                      // 切换协议时清空旧协议字段步长，自动动态展示新协议所有最新字段！
                      const next = actions.map((a, i) =>
                        i === actIdx
                          ? {
                              ...a,
                              protocolId: selectedProto.id,
                              messageId: msg?.id,
                              fields: [],
                              name: a.name.startsWith("下发") ? `下发「${selectedProto.name}」` : a.name,
                            }
                          : a,
                      );
                      saveActions(next);
                    }}
                  >
                    {protocols.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <span className="spacer" />

                  <button
                    className="btn sm"
                    style={{ color: "var(--red)", borderColor: "rgba(239,68,68,0.3)" }}
                    title="删除任务"
                    onClick={() => {
                      if (window.confirm(`确定删除任务「${act.name}」吗？`)) {
                        saveActions(actions.filter((_, i) => i !== actIdx));
                      }
                    }}
                  >
                    <Icon cp={IC.trash} size={11} color="var(--red)" />
                    <span>删除</span>
                  </button>
                </div>

                {/* 任务卡片主体：100% 动态读取用户协议的字段！ */}
                <div className="action-task-body">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--t3)", marginBottom: 4 }}>
                    <span>协议字段直接跟随「{currentProto?.name}」的实时定义（协议页增减字段或修改默认值自动生效）：</span>
                    <span style={{ color: "var(--t4)", fontSize: 10 }}>共 {currentMsg?.fields.filter((f) => f.type !== "crc" && f.offset >= 0).length ?? 0} 个可控字段</span>
                  </div>

                  <table className="proto-field-table">
                    <thead>
                      <tr>
                        <th style={{ width: "26%" }}>协议字段</th>
                        <th style={{ width: "22%" }}>初始基准值</th>
                        <th style={{ width: "24%" }}>每秒/每轮变化 (加多少)</th>
                        <th style={{ width: "28%" }}>动态推演 (第1秒 → 第2秒 → 第3秒)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentMsg?.fields
                        .filter((f) => f.type !== "crc" && f.offset >= 0)
                        .map((fld) => {
                          const isFixed = Boolean(fld.hex);
                          const isAuto = Boolean(fld.auto || fld.valueExpr);
                          const rule = (act.fields ?? []).find((r) => r.fieldName === fld.name);
                          // 协议当前最新默认值
                          const protoDefault = Number(fld.value ?? 0);
                          // 当前基准值：未显式自定义时严格跟随协议当前的默认值
                          const initVal = rule?.customInit !== undefined ? rule.customInit : protoDefault;
                          const isCustom = rule?.customInit !== undefined && rule.customInit !== protoDefault;
                          const stepVal = rule?.step ?? 0;

                          const updateFieldInit = (newInit: number) => {
                            const rest = (act.fields ?? []).filter((r) => r.fieldName !== fld.name);
                            if (newInit !== protoDefault || stepVal !== 0) {
                              rest.push({
                                fieldName: fld.name,
                                customInit: newInit === protoDefault ? undefined : newInit,
                                initValue: newInit,
                                step: stepVal,
                              });
                            }
                            const next = actions.map((a, i) => (i === actIdx ? { ...a, fields: rest } : a));
                            saveActions(next);
                          };

                          const updateFieldStep = (newStep: number) => {
                            const rest = (act.fields ?? []).filter((r) => r.fieldName !== fld.name);
                            if (newStep !== 0 || isCustom) {
                              rest.push({
                                fieldName: fld.name,
                                customInit: rule?.customInit,
                                initValue: initVal,
                                step: newStep,
                              });
                            }
                            const next = actions.map((a, i) => (i === actIdx ? { ...a, fields: rest } : a));
                            saveActions(next);
                          };

                          const resetToProtoDefault = () => {
                            const rest = (act.fields ?? []).filter((r) => r.fieldName !== fld.name);
                            if (stepVal !== 0) {
                              rest.push({ fieldName: fld.name, step: stepVal });
                            }
                            const next = actions.map((a, i) => (i === actIdx ? { ...a, fields: rest } : a));
                            saveActions(next);
                          };

                          const displayProtoDefault = fld.hex
                            ? fld.hex
                            : fld.auto
                              ? "整帧长度"
                              : fld.valueExpr
                                ? fld.valueExpr
                                : fld.valueFormat === "hex"
                                  ? `0x${protoDefault.toString(16).toUpperCase()}`
                                  : String(protoDefault);

                          return (
                            <tr key={fld.id}>
                              <td>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontWeight: 600, color: "var(--t1)" }}>{fld.name}</span>
                                  <span style={{ fontSize: 9, color: "var(--t4)" }}>
                                    ({fld.size}B {fld.type}{fld.unit ? ` · ${fld.unit}` : ""})
                                  </span>
                                  {isFixed && <span className="tag-mini" style={{ color: "var(--t4)" }}>固定内容</span>}
                                  {isAuto && <span className="tag-mini" style={{ color: "var(--accent)" }}>协议自动算</span>}
                                </div>
                                <div style={{ fontSize: 9, color: "var(--t4)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                                  {fld.desc && <span>{fld.desc} · </span>}
                                  <span>协议当前定义: {displayProtoDefault}</span>
                                </div>
                              </td>
                              <td>
                                {isFixed ? (
                                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--t2)" }}>
                                    {fld.hex}
                                  </span>
                                ) : isAuto ? (
                                  <span style={{ fontSize: 10, color: "var(--t3)" }}>
                                    {fld.auto ? "整帧长度 (自动)" : fld.valueExpr}
                                  </span>
                                ) : (
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <input
                                      type="number"
                                      className="proto-input"
                                      style={{ width: 80, borderColor: isCustom ? "var(--accent)" : "var(--line-2)" }}
                                      value={initVal}
                                      onChange={(e) => updateFieldInit(Number(e.target.value))}
                                    />
                                    {isCustom && (
                                      <button
                                        className="btn sm"
                                        style={{ height: 20, fontSize: 9, padding: "0 4px", color: "var(--accent)" }}
                                        onClick={resetToProtoDefault}
                                        title="重置为协议定义的最新默认值"
                                      >
                                        跟随协议
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td>
                                {isFixed || isAuto ? (
                                  <span style={{ fontSize: 10, color: "var(--t4)" }}>协议自洽</span>
                                ) : (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <input
                                      type="number"
                                      className="proto-input"
                                      style={{ width: 75 }}
                                      placeholder="0 (不变)"
                                      value={stepVal}
                                      onChange={(e) => updateFieldStep(Number(e.target.value))}
                                    />
                                    {stepVal === 0 ? (
                                      <span style={{ fontSize: 10, color: "var(--t4)" }}>固定</span>
                                    ) : (
                                      <span style={{ fontSize: 10, color: stepVal > 0 ? "var(--green)" : "var(--amber)", fontWeight: 600 }}>
                                        {stepVal > 0 ? `+${stepVal}/秒` : `${stepVal}/秒`}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)" }}>
                                {isFixed ? (
                                  <span style={{ color: "var(--t3)" }}>{fld.hex} (固定不变)</span>
                                ) : isAuto ? (
                                  <span style={{ color: "var(--t3)" }}>随帧长/计算式实时推导</span>
                                ) : (
                                  <>
                                    <span style={{ color: "var(--t1)" }}>{initVal}</span>
                                    <span style={{ margin: "0 4px", color: "var(--t4)" }}>→</span>
                                    <span style={{ color: "var(--accent)" }}>{initVal + stepVal}</span>
                                    <span style={{ margin: "0 4px", color: "var(--t4)" }}>→</span>
                                    <span style={{ color: "var(--accent)" }}>{initVal + stepVal * 2}</span>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>

                  {/* 实时自动封包与校验预览 */}
                  <div className="hex-preview-box">
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--t2)" }}>
                      <Icon cp={IC.terminal} size={11} color="var(--accent)" />
                      <span>「{currentProto?.name}」实时自动封包与校验预览：</span>
                    </div>
                    <div className="hex-preview-line">
                      <span style={{ width: 55 }}>第 1 秒:</span>
                      <span className="hex-code">{prev1.hex}</span>
                      <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--t4)" }}>{prev1.valSummary}</span>
                    </div>
                    <div className="hex-preview-line">
                      <span style={{ width: 55 }}>第 2 秒:</span>
                      <span className="hex-code">{prev2.hex}</span>
                      <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--t4)" }}>{prev2.valSummary}</span>
                    </div>
                    <div className="hex-preview-line">
                      <span style={{ width: 55 }}>第 3 秒:</span>
                      <span className="hex-code">{prev3.hex}</span>
                      <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--t4)" }}>{prev3.valSummary}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 添加协议任务卡片按钮 */}
          <button className="action-add-btn" onClick={() => handleAddAction()}>
            <Icon cp={IC.plus} size={13} color="var(--accent)" />
            <span>+ 添加协议下发任务（直接关联您添加的协议）</span>
          </button>

          {/* 响应断言与验证面板 */}
          <div style={{ marginTop: 20, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon cp={IC.check} size={14} color="var(--green)" />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>响应断言与验证（可选，自动校验回包）</span>
              </div>
              <button className="btn sm" onClick={handleAddAssertion}>
                <Icon cp={IC.plus} size={10} color="var(--t2)" />
                <span>+ 添加断言</span>
              </button>
            </div>

            {assertionSteps.length === 0 ? (
              <div style={{ padding: "10px 14px", background: "var(--bg-panel-2)", border: "1px dashed var(--line-3)", borderRadius: 6, fontSize: 11, color: "var(--t4)" }}>
                未配置断言，下发后将不强制校验回包。点击「+ 添加断言」可检查下位机返回的 HEX 包含、状态码等。
              </div>
            ) : (
              assertionSteps.map((step, sIdx) => {
                const f0 = step.fields?.[0];
                return (
                  <div key={step.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "var(--t3)", width: 20 }}>{sIdx + 1}.</span>
                    <span style={{ fontSize: 11, color: "var(--t2)" }}>校验回包包含:</span>
                    <input
                      type="text"
                      className="proto-input"
                      style={{ flex: 1 }}
                      placeholder="例如：01 03 或 OK 或 06"
                      value={f0?.value ?? ""}
                      onChange={(e) => {
                        const nextSteps = (active.steps ?? []).map((s) =>
                          s.id === step.id ? { ...s, fields: [{ label: "contains", value: e.target.value }] } : s,
                        );
                        updateCase(active.id, { steps: nextSteps });
                      }}
                    />
                    <span style={{ fontSize: 11, color: "var(--t3)" }}>超时:</span>
                    <input
                      type="text"
                      className="proto-input"
                      style={{ width: 65 }}
                      value={step.timeout ?? "2000ms"}
                      onChange={(e) => {
                        const nextSteps = (active.steps ?? []).map((s) =>
                          s.id === step.id ? { ...s, timeout: e.target.value } : s,
                        );
                        updateCase(active.id, { steps: nextSteps });
                      }}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => handleDeleteAssertion(step.id)}
                      title="删除断言"
                    >
                      <Icon cp={IC.trash} size={11} color="var(--red)" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* 底部操作与管理 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24, paddingTop: 14, borderTop: "1px solid var(--line-3)" }}>
            <span style={{ fontSize: 11, color: "var(--t3)" }}>
              当前用例：{actions.length} 个协议下发任务 · {assertionSteps.length} 个断言
            </span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => duplicateCase(active.id)}>
              <Icon cp={IC.copy} size={11} color="var(--t2)" />
              <span>复制用例</span>
            </button>
            <button
              className="btn sm"
              style={{ color: "var(--red)" }}
              onClick={() => {
                if (window.confirm(`确定删除用例「${active.name}」吗？`)) {
                  deleteCase(active.id);
                }
              }}
            >
              <Icon cp={IC.trash} size={11} color="var(--red)" />
              <span>删除用例</span>
            </button>
          </div>
        </div>

        {/* 右侧：实时下发执行流水与报告 */}
        <div className="case-side" style={{ width: 340, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)" }}>自动化执行明细</span>
            <span className="spacer" />
            {lastRun && (
              <button className="btn sm" style={{ height: 20, fontSize: 10 }} onClick={clearRuns}>
                清空日志
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {lastRun ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "8px 10px", background: lastRun.status === "pass" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)", borderRadius: 6, border: `1px solid ${lastRun.status === "pass" ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon
                      cp={lastRun.status === "pass" ? IC.check : IC.error}
                      size={14}
                      color={lastRun.status === "pass" ? "var(--green)" : "var(--red)"}
                    />
                    <span style={{ fontSize: 12, fontWeight: 600, color: lastRun.status === "pass" ? "var(--green)" : "var(--red)" }}>
                      {lastRun.status === "pass" ? "执行通过" : "执行失败"}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--t3)" }}>
                    {lastRun.durationMs}ms · {lastRun.items.length} 轮次
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {lastRun.items.map((it, i) => (
                    <div key={i} className={`apifox-step-card ${it.status}`}>
                      <div className="apifox-step-head">
                        <span style={{ color: it.status === "pass" ? "var(--green)" : "var(--red)", fontSize: 12 }}>
                          {it.status === "pass" ? "✓" : "✗"}
                        </span>
                        <span style={{ color: "var(--t1)", fontWeight: 600 }}>{it.text}</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--t4)" }}>{it.startedAt}</span>
                      </div>
                      <div className="apifox-step-detail">
                        {it.frameHex && (
                          <div style={{ color: "#58a6ff" }}>
                            HEX: {it.frameHex}
                          </div>
                        )}
                        {it.expected && <div>参数: {it.expected}</div>}
                        {it.actual && <div>结果: {it.actual}</div>}
                        {it.error && <div style={{ color: "var(--red)" }}>错误: {it.error}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--t4)", fontSize: 11, textAlign: "center", gap: 8 }}>
                <Icon cp={IC.history} size={28} color="var(--line-2)" />
                <span>点击上方「▶ 运行用例」</span>
                <span>此处将实时滚动呈现每秒下发的协议帧及回包断言结果</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
