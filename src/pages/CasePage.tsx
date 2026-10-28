import { TestModeSwitch } from "../components/TestModeSwitch";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, stepsToYaml, type CaseStep } from "../engine/store";
import { yamlToSteps } from "../engine/yaml";
import { Icon, IC } from "../components/Icon";
import { EmptyState } from "../components/Empty";

function YamlView({ yaml }: { yaml: string }) {
  const lines = yaml.split("\n");
  return (
    <div className="yaml-body">
      {lines.map((line, i) => {
        const m = line.match(/^(\s*-?\s*)([\w_]+):(.*)$/);
        if (m) {
          return (
            <div key={i}>
              <span>{m[1]}</span>
              <span className="k">{m[2]}</span>
              <span>:</span>
              <span className="s">{m[3]}</span>
            </div>
          );
        }
        return <div key={i}>{line || "\u00a0"}</div>;
      })}
    </div>
  );
}

function StepRow({
  step,
  index,
  current,
  onClick,
  onDelete,
  onAddChild,
  onAddElse,
  onDeleteChild,
}: {
  step: CaseStep;
  index: number;
  current: boolean;
  onClick: () => void;
  onDelete: () => void;
  onAddChild?: () => void;
  onAddElse?: () => void;
  onDeleteChild?: (branch: "then" | "else", id: string) => void;
}) {
  const isBlock = step.kind === "if" || step.kind === "while";

  const branchRows = (list: CaseStep[], branch: "then" | "else", label: string) => (
    <div className="step-branch">
      <div className="step-branch-head">{label}</div>
      {list.map((c, i) => (
        <div key={c.id} className="step-child" onClick={(e) => e.stopPropagation()}>
          <span className="step-num">{i + 1}</span>
          <span className={`kind-badge kind-${c.kind}`}>{c.text}</span>
          <div className="step-body">
            {c.cond && <span className="val">{c.cond}</span>}
            {c.fields?.map((f, j) => (
              <span key={j} className="row gap-4">
                <span className="val">{f.label}</span>
                {f.value && (
                  <>
                    <span className="eq">=</span>
                    <span className="val">{f.value.replace(/^=\s*/, "")}</span>
                  </>
                )}
              </span>
            ))}
            {c.timeout && <span className="step-timeout">{c.timeout}</span>}
          </div>
          <button className="step-child-del" onClick={() => onDeleteChild?.(branch, c.id)} title="删除">
            <Icon cp={IC.trash} size={9} color="var(--red)" />
          </button>
        </div>
      ))}
      <button className="step-add-child" onClick={() => (branch === "else" ? onAddElse?.() : onAddChild?.())}>
        <Icon cp={IC.plus} size={9} color="var(--t3)" />
        <span>{branch === "else" ? "添加否则步骤" : "添加子步骤"}</span>
      </button>
    </div>
  );

  return (
    <>
      <div className={`step-row${current ? " current" : ""}`} onClick={onClick}>
        <span className="step-num">{index + 1}</span>
        <span className="step-drag">
          <Icon cp={IC.branch} size={9} color="var(--t5)" />
        </span>
        <span className={`kind-badge kind-${step.kind}`}>{step.text}</span>
        <div className="step-body">
          {step.cond && <span className="val">{step.cond}</span>}
          {step.detail && !isBlock && <span className="lbl">{step.detail}</span>}
          {step.kind === "assertNo" ? (
            <span className="row gap-4">
              {step.fields?.map((f, i) => (
                <span key={i} className="step-timeout" style={{ background: "#2a1518", color: "var(--red)" }}>
                  {f.label}
                </span>
              ))}
            </span>
          ) : isBlock ? null : (
            step.fields?.map((f, i) => (
              <span key={i} className="row gap-4">
                <span className="val">{f.label}</span>
                {f.value && (
                  <>
                    {!f.value.startsWith("=") && <span className="eq">=</span>}
                    <span className="val">{f.value.replace(/^=\s*/, "")}</span>
                  </>
                )}
                {i < (step.fields?.length ?? 0) - 1 && <span className="eq">·</span>}
              </span>
            ))
          )}
        </div>
        {step.timeout && !step.timeout.startsWith("自动") && <span className="step-timeout">{step.timeout}</span>}
        {step.timeout?.startsWith("自动") && (
          <span className="lbl" style={{ fontSize: 10, color: "var(--t4)" }}>
            {step.timeout}
          </span>
        )}
        <span className="step-more" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="删除">
          <Icon cp={IC.trash} size={11} color="var(--t4)" />
        </span>
      </div>
      {isBlock && (step.children?.length || step.elseChildren?.length || step.kind === "if") && (
        <div className="step-branches">
          {branchRows(step.children ?? [], "then", step.kind === "if" ? "条件成立" : "循环体")}
          {step.kind === "if" && branchRows(step.elseChildren ?? [], "else", "否则")}
        </div>
      )}
    </>
  );
}

export function CasePage() {
  const { cases, roles, subProducts, activeSubProductId, updateCase, activeCaseId, setActiveCase, createCase, duplicateCase, deleteCase, openDialog, runActiveCase, running, runs, liveSteps, updateCaseSteps, requestStop, protocols, activeProtocolId } = useStore();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("全部");
  const [currentStep, setCurrentStep] = useState(1);
  const [tab, setTab] = useState<"assert" | "data" | "setting">("assert");
  const [csvDraft, setCsvDraft] = useState("");
  const [yamlEdit, setYamlEdit] = useState<string | null>(null);
  const [yamlErr, setYamlErr] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRowCount = csvDraft.trim() ? csvDraft.trim().split(/\r?\n/).filter((l) => l.trim()).length - 1 : 0;

  const active = cases.find((c) => c.id === activeCaseId) ?? cases[0];

  /** 断言类型覆盖：从真实步骤统计，不再写死 */
  const assertStats = useMemo(() => {
    const steps = active?.steps ?? [];
    const count = (k: string) => steps.filter((s) => s.kind === k).length;
    const expectLike = (re: RegExp) => steps.filter((s) => s.kind === "expect" && re.test(s.detail ?? "")).length;
    return {
      equals: steps.filter((s) => s.kind === "expect" && !/range|\bin\b|>|<|\.\.|整帧|frame/i.test(s.detail ?? "")).length,
      range: expectLike(/range|\bin\b|>|<|\.\./i),
      frame: expectLike(/整帧|frame|帧/i),
      assertNo: count("assertNo"),
      set: count("set"),
      flow: count("delay") + count("loop") + count("parallel"),
    };
  }, [active?.steps]);

  /** 读 CSV 文件：支持 UTF-8 / UTF-8 BOM / GBK 兜底，读完直接填进编辑框并保存 */
  const loadCsvFile = async (f: File) => {
    try {
      let text = await f.text();
      // 乱码检测：UTF-8 解出大量替换符时按 GBK 重读
      if (/\uFFFD/.test(text)) {
        try {
          const buf = await f.arrayBuffer();
          text = new TextDecoder("gbk").decode(buf);
        } catch {
          /* 浏览器不支持 gbk 时保留 UTF-8 结果 */
        }
      }
      text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
      setCsvDraft(text);
      setCsvFileName(f.name);
      updateCase(active.id, { dataDriven: text || undefined });
      openDialog({ kind: "confirm", title: "已载入 CSV", desc: `${f.name} · ${Math.max(0, text.split("\n").filter((l) => l.trim()).length - 1)} 行数据，已保存到用例`, okText: "知道了", onOk: () => {} });
    } catch (e) {
      openDialog({ kind: "confirm", title: "读取失败", desc: String((e as Error).message ?? e), okText: "知道了", onOk: () => {} });
    }
  };

  /** 下载 CSV 模板：表头直接用当前协议的字段名，客户照着填就能跑 */
  const downloadCsvTemplate = () => {
    const proto = protocols.find((p) => p.id === activeProtocolId) ?? protocols[0];
    const fields = proto?.messages?.[0]?.fields ?? [];
    const cols = fields.filter((f) => !["crc", "checksum", "reserved"].includes(f.type)).map((f) => f.name);
    const header = (cols.length ? cols : ["字段1", "字段2"]).join(",");
    const sample = (cols.length ? cols : ["字段1", "字段2"]).map(() => "0").join(",");
    const csv = `${header}\n${sample}\n${sample}\n`;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `数据驱动模板-${proto?.name ?? "协议"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const filtered = useMemo(() => {
    return cases.filter((c) => {
      if (query && !c.name.includes(query)) return false;
      if (tagFilter === "全部") return true;
      return c.tags.includes(tagFilter);
    });
  }, [cases, query, tagFilter]);

  /** 按对话框输入构造步骤对象 */
  const buildStep = (v: Record<string, string>, existing?: CaseStep): CaseStep => {
    const kind = (v.kind || "expect") as CaseStep["kind"];
    const id = existing?.id ?? `s${Date.now()}`;
    switch (kind) {
      case "set":
        return { id, kind, text: "set", detail: "field", fields: [{ label: v.field, value: `= ${v.value.replace(/^=\s*/, "")}` }], timeout: "自动组包发送" };
      case "expect":
        return { id, kind, text: "expect", detail: "field", fields: [{ label: v.field, value: v.value }], timeout: `within ${v.timeout}` };
      case "assertNo":
        return { id, kind, text: "assertNo", detail: "无异常", fields: v.value.split(/[,，\s]+/).filter(Boolean).map((x) => ({ label: x, value: "" })) };
      case "send":
        return { id, kind, text: "send", detail: v.value };
      case "delay":
        return { id, kind, text: "delay", detail: `等待 ${v.value}` };
      case "loop":
        return { id, kind, text: "loop", detail: v.value };
      case "parallel":
        return { id, kind, text: "parallel", detail: "多字段", fields: [{ label: v.field, value: `= ${v.value}` }] };
      case "setVar":
        return { id, kind, text: "setVar", detail: v.field, fields: [{ label: v.field, value: `= ${v.value.replace(/^=\s*/, "")}` }] };
      case "if":
        return { id, kind, text: "if", cond: v.value, children: existing?.children ?? [], elseChildren: existing?.elseChildren ?? [] };
      case "while":
        return {
          id,
          kind,
          text: "while",
          cond: v.value,
          children: existing?.children ?? [],
          timeout: `max ${v.timeout.replace(/[^\d]/g, "") || "100"}`,
        };
      case "break":
        return { id, kind, text: "break", detail: "" };
      case "continue":
        return { id, kind, text: "continue", detail: "" };
      default:
        return { id, kind, text: kind, detail: v.value };
    }
  };

  const STEP_FIELDS = (existing?: CaseStep) => {
    const f0 = existing?.fields?.[0];
    return [
      {
        key: "kind",
        label: "类型",
        type: "select" as const,
        value: existing?.kind ?? "expect",
        options: [
          { value: "expect", label: "expect — 等待并断言" },
          { value: "set", label: "set — 改字段并组包发送" },
          { value: "assertNo", label: "assertNo — 窗口内无异常" },
          { value: "send", label: "send — 发原始字节" },
          { value: "delay", label: "delay — 延时" },
          { value: "loop", label: "loop — 空循环" },
          { value: "parallel", label: "parallel — 多字段一次发送" },
          { value: "setVar", label: "setVar — 变量赋值（score = score + 1）" },
          { value: "if", label: "if — 条件分支（else 可选）" },
          { value: "while", label: "while — 条件循环" },
          { value: "break", label: "break — 跳出循环" },
          { value: "continue", label: "continue — 进入下一轮" },
        ],
      },
      { key: "field", label: "字段 / 变量", value: f0?.label ?? "position", placeholder: "position / score" },
      { key: "value", label: "值 / 断言 / 条件", value: f0?.value ?? "equals 3000", placeholder: "equals 3000 / score < 3" },
      { key: "timeout", label: "超时 / 上限", value: existing?.timeout ?? "3s", placeholder: "3s / 200ms / 100" },
    ];
  };

  /** 在树里找到某个块步骤，往它的 then / else 追加一步 */
  const addChildTo = (steps: CaseStep[], parentId: string, branch: "then" | "else", child: CaseStep): CaseStep[] =>
    steps.map((s) => {
      if (s.id === parentId) {
        return branch === "else"
          ? { ...s, elseChildren: [...(s.elseChildren ?? []), child] }
          : { ...s, children: [...(s.children ?? []), child] };
      }
      if (s.children?.length || s.elseChildren?.length) {
        return {
          ...s,
          children: s.children ? addChildTo(s.children, parentId, branch, child) : s.children,
          elseChildren: s.elseChildren ? addChildTo(s.elseChildren, parentId, branch, child) : s.elseChildren,
        };
      }
      return s;
    });

  const removeChildFrom = (steps: CaseStep[], parentId: string, branch: "then" | "else", childId: string): CaseStep[] =>
    steps.map((s) => {
      if (s.id === parentId) {
        return branch === "else"
          ? { ...s, elseChildren: (s.elseChildren ?? []).filter((c) => c.id !== childId) }
          : { ...s, children: (s.children ?? []).filter((c) => c.id !== childId) };
      }
      if (s.children?.length || s.elseChildren?.length) {
        return {
          ...s,
          children: s.children ? removeChildFrom(s.children, parentId, branch, childId) : s.children,
          elseChildren: s.elseChildren ? removeChildFrom(s.elseChildren, parentId, branch, childId) : s.elseChildren,
        };
      }
      return s;
    });

  /** 给 if / while 加子步骤 */
  const addChildStep = (parentId: string, branch: "then" | "else") => {
    openDialog({
      kind: "form",
      title: branch === "else" ? "添加「否则」步骤" : "添加子步骤",
      desc: "条件成立时按顺序执行这些步骤；while 会反复执行到条件不成立（有次数上限）。",
      fields: STEP_FIELDS(),
      okText: "添加",
      onOk: (v) => updateCaseSteps(active.id, addChildTo(active.steps, parentId, branch, buildStep(v))),
    });
  };

  /** 步骤编辑器：新增 / 编辑共用 */
  const editStep = (index: number | null) => {
    const existing = index !== null ? active.steps[index] : undefined;
    openDialog({
      kind: "form",
      title: index === null ? "添加步骤" : `编辑步骤 ${index + 1}`,
      desc: "断言：equals 3000 / range 1000..4000 / in 1,3,5 / > 100；条件：position > 100、score < 3。",
      fields: STEP_FIELDS(existing),
      okText: index === null ? "添加" : "保存",
      onOk: (v) => {
        const step = buildStep(v, existing);
        const next = index === null ? [...active.steps, step] : active.steps.map((x, i) => (i === index ? step : x));
        updateCaseSteps(active.id, next);
      },
    });
  };

  /** 应用手写 YAML：解析成步骤，报错时不改动原步骤 */
  const applyYaml = () => {
    if (yamlEdit === null) return;
    const { steps, errors } = yamlToSteps(yamlEdit);
    if (errors.length) {
      setYamlErr(errors);
      return;
    }
    if (!steps.length) {
      setYamlErr(["至少要有一个步骤"]);
      return;
    }
    updateCaseSteps(active.id, steps);
    setYamlErr([]);
    setYamlEdit(null);
  };

  const stepCount = active?.steps.length || active?.stepCount || 0;


  // 当前用例最近一次真实执行结果
  const lastRun = runs.find((r) => r.caseId === active?.id);
  const lastStepResult = lastRun?.items?.[Math.min(currentStep, (lastRun.items.length || 1) - 1)];

  if (!active) {
    return (
      <div className="page">
        <TestModeSwitch />
      <div className="content">
          <EmptyState
            icon={IC.case}
            title="还没有用例"
            desc="用例 = 发什么 + 断言什么。点下面「一键生成示例用例」，会用当前协议的默认帧自动建一个能跑的用例，跑通后再改。"
          >
            <button className="btn-primary" onClick={() => void import("../lib/actions").then((m) => m.createSampleCase())}>
              <Icon cp={IC.play} size={11} color="#fff" />
              一键生成示例用例
            </button>
            <button
              className="btn"
              onClick={() =>
                openDialog({
                  kind: "form",
                  title: "新建用例",
                  fields: [{ key: "name", label: "用例名", value: "", placeholder: "例如：读位置并断言" }],
                  okText: "创建",
                  onOk: (v) => v.name?.trim() && createCase(v.name.trim()),
                })
              }
            >
              <Icon cp={IC.plus} size={11} color="var(--t2)" />
              新建空用例
            </button>
          </EmptyState>
        </div>
      </div>
    );
  }
  return (
    <div className="page" style={{ padding: 0 }}>
      <TestModeSwitch />
      <div className="case-layout">
        {/* 左：用例列表 */}
        <div className="case-list" style={{ paddingTop: 14 }}>
          <div className="search-box">
            <Icon cp={IC.search} size={12} color="var(--t4)" />
            <input placeholder="搜索用例" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button
              className="add-btn"
              style={{ width: 18, height: 18 }}
              onClick={() =>
                openDialog({
                  kind: "form",
                  title: "新建用例",
                  desc: "用例 = 步骤 + 断言。创建后可在中间区域编辑步骤。",
                  fields: [{ key: "name", label: "用例名", value: "", placeholder: "例如：急停响应" }],
                  okText: "创建",
                  onOk: (v) => v.name?.trim() && createCase(v.name.trim()),
                })
              }
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
                {t === "冒烟" && <span style={{ color: "var(--t4)" }}>2</span>}
                {t === "专项" && <span style={{ color: "var(--t4)" }}>3</span>}
              </button>
            ))}
          </div>
          <div className="case-items">
            {filtered.map((c) => (
              <div key={c.id} className={`case-card${c.id === activeCaseId ? " active" : ""}`} onClick={() => setActiveCase(c.id)}>
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
                  {c.dataDriven ? `CSV ${c.dataDriven.trim().split(/\r?\n/).filter((l) => l.trim()).length - 1} 行` : "未绑定数据"} · {c.stepCount} 步骤 · {c.assertionCount} 断言
                </div>
                <div className={`case-card-status ${c.status === "passed" ? "pass" : c.status === "failed" ? "fail" : "idle"}`}>
                  <Icon
                    cp={c.status === "passed" ? IC.check : c.status === "failed" ? IC.error : IC.history}
                    size={9}
                    color={c.status === "passed" ? "var(--green)" : c.status === "failed" ? "var(--red)" : "var(--t3)"}
                  />
                  <span>{c.statusText}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 中：编辑器 */}
        <div className="case-main">
          <div className="case-head">
            <div>
              <div className="row gap-8">
                <span className="case-title">{active.name}</span>
                {active.tags[0] && (
                  <span className="tag-mini" style={{ height: 16, fontSize: 9 }}>
                    {active.tags[0]}
                  </span>
                )}
              </div>
              <div className="case-sub">
                case: {active.name} · 子产品 {subProducts.find((x) => x.id === active.subProductId)?.name ?? "—"} · {stepCount} 步骤 · {active.assertionCount} 断言
              </div>
            </div>
            <div className="case-head-actions">
              <button className="btn-primary" style={{ height: 28, padding: "0 12px", whiteSpace: "nowrap" }} disabled={!running && active.steps.length === 0} onClick={() => (running ? requestStop() : void runActiveCase())}>
                <Icon cp={IC.play} size={12} color="#fff" />
                <span>{running ? "停止" : "运行用例"}</span>
              </button>
            </div>
          </div>

          <div className="steps-card">
            <div className="steps-head">
              <span className="steps-title">步骤</span>
              <span className="tag-mini">{stepCount}</span>
              <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => editStep(null)}>
                <Icon cp={IC.plus} size={10} color="var(--t2)" />
                <span>步骤</span>
              </button>
              <span className="steps-hint">expect / set / send / delay / assertNo / if / while / setVar / break / continue（也可直接写 YAML）</span>
            </div>
            {active.steps.length > 0 ? (
              active.steps.map((s, i) => (
                <StepRow
                  key={s.id}
                  step={s}
                  index={i}
                  current={i === currentStep}
                  onClick={() => {
                    setCurrentStep(i);
                    editStep(i);
                  }}
                  onDelete={() => updateCaseSteps(active.id, active.steps.filter((_, idx) => idx !== i))}
                  onAddChild={() => addChildStep(s.id, "then")}
                  onAddElse={() => addChildStep(s.id, "else")}
                  onDeleteChild={(branch, id) => updateCaseSteps(active.id, removeChildFrom(active.steps, s.id, branch, id))}
                />
              ))
            ) : (
              <div style={{ padding: 16, fontSize: 11, color: "var(--t4)" }}>还没有步骤 —— 点上方「+ 步骤」添加，或直接编辑下方 YAML</div>
            )}
          </div>

          <div className="yaml-card" style={{ flex: 1 }}>
            <div className="yaml-head">
              <Icon cp={IC.code} size={11} color="var(--t3)" />
              <span>{yamlEdit !== null ? "编辑 YAML（改完点「应用」）" : "YAML（与可视化双向同步）"}</span>
              <span className="spacer" />
              {yamlEdit === null ? (
                <button
                  className="btn sm"
                  style={{ height: 20 }}
                  onClick={() => {
                    setYamlEdit(stepsToYaml(active.steps));
                    setYamlErr([]);
                  }}
                >
                  <Icon cp={IC.edit} size={9} color="var(--t2)" />
                  <span>编辑</span>
                </button>
              ) : (
                <>
                  <button
                    className="btn sm"
                    style={{ height: 20 }}
                    onClick={() => {
                      setYamlEdit(null);
                      setYamlErr([]);
                    }}
                  >
                    <span>取消</span>
                  </button>
                  <button className="btn-primary" style={{ height: 20, padding: "0 9px" }} onClick={applyYaml}>
                    <span>应用</span>
                  </button>
                </>
              )}
            </div>
            {yamlErr.length > 0 && <div className="yaml-err">{yamlErr.join("；")}</div>}
            {yamlEdit !== null ? (
              <textarea
                className="yaml-editor"
                value={yamlEdit}
                onChange={(e) => setYamlEdit(e.target.value)}
                spellCheck={false}
                placeholder={"steps:\n  - expect: { field: position, equals 3000, within 2s }\n  - delay:  500ms"}
              />
            ) : active.yaml ? (
              <YamlView yaml={active.yaml} />
            ) : (
              <div className="yaml-body" style={{ color: "var(--t4)" }}>
                # 该用例使用数据驱动，步骤由 points.csv 生成
              </div>
            )}
          </div>

          <div className="runbar">
            <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 4 }}>
              步骤 {Math.min(currentStep + 1, stepCount)}/{stepCount}
            </span>
            <span className="run-step-chip">
              <Icon cp={IC.useCase} size={9} color="#9db6e8" />
              {active.steps[currentStep]?.text} {active.steps[currentStep]?.detail ?? ""}{" "}
              {active.steps[currentStep]?.fields?.map((f) => `${f.label} ${f.value}`).join(" ")}
            </span>
              <span
                className="run-actual"
                style={{
                  color: lastStepResult
                    ? lastStepResult.status === "pass"
                      ? "var(--green)"
                      : "var(--red)"
                    : "var(--t4)",
                }}
              >
                {lastStepResult
                  ? `实际 ${lastStepResult.actual ?? "—"}${lastStepResult.status === "pass" ? " ✓" : " ✗"}`
                  : "尚未运行"}
              </span>
          </div>

          <div className="case-foot">
            <span className="item">
              <Icon cp={IC.history} size={11} color="var(--t3)" />
              {stepCount} 步骤 · {active.assertionCount} 断言
            </span>
            <span className="item" onClick={() => duplicateCase(active.id)}>
              <Icon cp={IC.copy} size={11} color="var(--t3)" />
              复制用例
            </span>
            <span
              className="item"
              onClick={() =>
                openDialog({
                  kind: "confirm",
                  title: "删除用例",
                  desc: `确定删除「${active.name}」？将移入回收站（30 天可恢复）。`,
                  danger: true,
                  okText: "删除",
                  onOk: () => deleteCase(active.id),
                })
              }
            >
              <Icon cp={IC.trash} size={11} color="var(--red)" />
              <span style={{ color: "var(--red)" }}>删除用例</span>
            </span>
          </div>
        </div>

        {/* 右：断言/数据/设置 */}
        <div className="case-side">
          <div className="side-tabs">
            {(
              [
                ["assert", "断言"],
                ["data", "数据驱动"],
                ["setting", "设置"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? "chip active" : "chip"} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "assert" && (
            <>
              <div className="card" style={{ background: "transparent", border: "none" }}>
                <div className="card-title" style={{ marginBottom: 8 }}>
                  断言类型覆盖
                </div>
                <div className="assert-list">
                  {(
                    [
                      ["expect · equals", assertStats.equals],
                      ["expect · range / in / >", assertStats.range],
                      ["expect · 整帧 / 字段", assertStats.frame],
                      ["assertNo · 无异常", assertStats.assertNo],
                      ["set · 改字段后发", assertStats.set],
                      ["delay / loop / parallel", assertStats.flow],
                    ] as const
                  ).map(([name, n]) => (
                    <div className={`assert-row${n ? "" : " off"}`} key={name}>
                      <span className="dot" style={{ background: n ? "var(--green)" : "var(--t5)" }} />
                      <span className="n">{name}</span>
                      <span className="c">{n ? `${n} 处` : "未使用"}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pdl-card">
                <div className="pdl-card-head">
                  <Icon cp={IC.export} size={11} color="var(--t3)" />
                  <span className="pdl-card-title">绑定 CSV</span>
                  <span className="pdl-card-note">{active.dataDriven ? `${csvRowCount} 行` : "未绑定"}</span>
                </div>
                <div className="drop-zone" style={{ cursor: "pointer" }} onClick={() => setTab("data")}>
                  <Icon cp={IC.download} size={14} color={active.dataDriven ? "var(--green)" : "var(--t4)"} />
                  <span>{active.dataDriven ? "已绑定，点击查看/替换" : "拖入 points.csv 或点击选择"}</span>
                </div>
                <div className="var-hint">引用语法 <code>{"${列名}"}</code></div>
              </div>

              <div className="pdl-card">
                <div className="pdl-card-head">
                  <Icon cp={IC.settings} size={11} color="var(--t3)" />
                  <span className="pdl-card-title">运行设置</span>
                  <span className="spacer" />
                  <span className="pdl-card-note" style={{ cursor: "pointer" }} onClick={() => setTab("setting")}>去修改</span>
                </div>
                <div className="setting-row">
                  <span>失败即停</span>
                  <span className="spacer" />
                  <span className="var-hint">{active.stopOnFail !== false ? "开" : "关"}</span>
                </div>
                <div className="setting-row">
                  <span>重复次数</span>
                  <span className="spacer" />
                  <span className="var-hint">{active.repeat === 0 ? "无限循环" : `${active.repeat ?? 1} 次`}</span>
                </div>
                <div className="setting-row">
                  <span>最长运行</span>
                  <span className="spacer" />
                  <span className="var-hint">{active.maxDurationMs ? `${Math.round(active.maxDurationMs / 1000)} 秒` : "不限"}</span>
                </div>
              </div>
            </>
          )}

          {tab === "data" && (
            <div className="pdl-card">
              <div className="pdl-card-head">
                <Icon cp={IC.export} size={11} color="var(--t3)" />
                <span className="pdl-card-title">数据驱动（CSV）</span>
                <span className="spacer" />
                <span className="pdl-card-note">{csvRowCount} 行数据</span>
              </div>
              <div style={{ padding: 10 }}>
                <div className="row gap-8" style={{ marginBottom: 8 }}>
                  <button className="btn" style={{ height: 26 }} onClick={() => fileRef.current?.click()}>
                    <Icon cp={IC.download} size={11} color="var(--t2)" />
                    选择 CSV 文件
                  </button>
                  <button className="btn" style={{ height: 26 }} onClick={downloadCsvTemplate} title="按当前协议的字段名生成表头，照着填即可">
                    <Icon cp={IC.export} size={11} color="var(--t2)" />
                    下载模板
                  </button>
                  {csvFileName && <span className="var-hint">已载入 {csvFileName}</span>}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.txt,text/csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void loadCsvFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
                <textarea
                  className="csv-input"
                  rows={7}
                  value={csvDraft}
                  onChange={(e) => setCsvDraft(e.target.value)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) void loadCsvFile(f);
                  }}
                  style={dragOver ? { borderColor: "var(--accent)", background: "rgba(99,140,255,.08)" } : undefined}
                  placeholder={"want,note\n96,第一行\n96,第二行\n\n（也可以把 .csv 文件直接拖进来）"}
                />
                <div className="var-hint" style={{ marginTop: 6, lineHeight: 1.6 }}>
                  首行是列名，一行数据跑一次；步骤里用 <code>{"${want}"}</code> 引用该列的值。全部行通过才算用例通过。
                </div>
                <div className="row gap-8" style={{ marginTop: 8 }}>
                  <button
                    className="btn-primary"
                    style={{ height: 26 }}
                    onClick={() => updateCase(active.id, { dataDriven: csvDraft.trim() || undefined })}
                  >
                    保存数据
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setCsvDraft("");
                      setCsvFileName("");
                      updateCase(active.id, { dataDriven: undefined });
                    }}
                  >
                    清空
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "setting" && (
            <div className="pdl-card">
              <div className="pdl-card-head">
                <Icon cp={IC.settings} size={11} color="var(--t3)" />
                <span className="pdl-card-title">运行设置</span>
              </div>
              <div className="setting-row">
                <span>标签</span>
                <span className="var-hint" style={{ marginLeft: 6 }}>套件按标签筛用例</span>
                <span className="spacer" />
                <input
                  className="mini-input"
                  style={{ width: 150 }}
                  value={(active.tags ?? []).join(",")}
                  placeholder="冒烟,回归"
                  title="多个标签用逗号分隔；套件按标签挑选用例"
                  onChange={(e) => updateCase(active.id, { tags: e.target.value.split(/[,，\s]+/).filter(Boolean) })}
                />
              </div>
              <div className="setting-row">
                <span>重复次数</span>
                <span className="var-hint" style={{ marginLeft: 6 }}>0 = 无限循环（心跳）</span>
                <span className="spacer" />
                <input
                  className="mini-input"
                  style={{ width: 70 }}
                  value={String(active.repeat ?? 1)}
                  title="整条用例跑几轮；填 0 = 无限循环，直到失败或点停止"
                  onChange={(e) => updateCase(active.id, { repeat: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span className="var-hint">次</span>
              </div>
              <div className="setting-row">
                <span>轮间隔</span>
                <span className="var-hint" style={{ marginLeft: 6 }}>心跳填 1000 = 每秒一次</span>
                <span className="spacer" />
                <input
                  className="mini-input"
                  style={{ width: 70 }}
                  value={String(active.intervalMs ?? 0)}
                  title="每轮之间等多久（毫秒）"
                  onChange={(e) => updateCase(active.id, { intervalMs: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span className="var-hint">ms</span>
              </div>
              <div className="setting-row">
                <span>失败重试</span>
                <span className="spacer" />
                <input
                  className="mini-input"
                  style={{ width: 70 }}
                  value={String(active.retries ?? 0)}
                  title="某步失败后重跑几次"
                  onChange={(e) => updateCase(active.id, { retries: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span className="var-hint">次</span>
              </div>
              <div className="setting-row">
                <span>失败即停</span>
                <span className="var-hint" style={{ marginLeft: 6 }}>关掉后失败也跑完剩余轮次</span>
                <span className="spacer" />
                <span
                  className={`switch-track${active.stopOnFail !== false ? " on" : ""}`}
                  role="switch"
                  aria-checked={active.stopOnFail !== false}
                  title="失败后是否立刻停止"
                  onClick={() => updateCase(active.id, { stopOnFail: active.stopOnFail === false })}
                >
                  <span className="switch-knob" />
                </span>
              </div>
              <div className="setting-row">
                <span>最长运行</span>
                <span className="var-hint" style={{ marginLeft: 6 }}>到点自动停（无限循环兜底）</span>
                <span className="spacer" />
                <input
                  className="mini-input"
                  style={{ width: 70 }}
                  value={String(Math.round((active.maxDurationMs ?? 0) / 1000))}
                  title="单位秒；0 = 不限。填 3600 = 最多跑 1 小时自动停"
                  onChange={(e) => updateCase(active.id, { maxDurationMs: Math.max(0, Number(e.target.value) || 0) * 1000 })}
                />
                <span className="var-hint">秒</span>
              </div>
              <div className="setting-row" style={{ alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 2 }}>
                  <span>变量</span>
                  <span className="var-hint">名=初值+每轮增量</span>
                </div>
                <span className="spacer" />
                <textarea
                  className="csv-input"
                  rows={3}
                  style={{ width: 210 }}
                  placeholder={"score=0+1"}
                  title="每行一个：名称=初值+每轮增量；步骤里用 ${score} 引用"
                  value={(active.vars ?? []).map((v) => `${v.name}=${v.init}+${v.step}`).join("\n")}
                  onChange={(e) => {
                    const vars = e.target.value
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line) => {
                        const m = line.match(/^([A-Za-z_][\w]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*([+-]\s*\d+(?:\.\d+)?)?$/);
                        if (!m) return null;
                        return { name: m[1], init: Number(m[2]), step: m[3] ? Number(m[3].replace(/\s/g, "")) : 0 };
                      })
                      .filter((x): x is { name: string; init: number; step: number } => !!x);
                    updateCase(active.id, { vars });
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="page-foot">
        <span>用例已保存</span>
        <span>·</span>
        <span>{active.tags.length ? `标签 ${active.tags.join(" / ")}` : "未打标签"}</span>
        <span className="right">
          <span>⌘S 保存</span>
          <span>⌘F 运行</span>
          <span>⌘↑ 折叠</span>
        </span>
      </div>
    </div>
  );
}
