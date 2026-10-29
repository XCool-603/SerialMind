import { useEffect, useMemo, useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import {
  localDraft,
  remoteDraft,
  loadAiConfig,
  saveAiConfig,
  testAiConfig,
  draftToProtocol,
  previewBytes,
  localGenerateCaseDraft,
  remoteGenerateCaseDraft,
  localGenerateProductDraft,
  remoteGenerateProductDraft,
  type AiConfig,
  type DraftResult,
  type GeneratedCaseDraft,
  type GeneratedProductDraft,
} from "../engine/ai";
import { toHex } from "../engine/bytes";

type AiMode = "protocol" | "case" | "product";

const DEMO_DOC = `3.2 帧格式（起升PLC 控制协议 v3）

| offset | 字段名      | 类型     | 长度 | 说明                 |
| 0      | addr        | uint8    | 1    | 从站地址 1~247       |
| 1      | func        | uint8    | 1    | 功能码 03 读 / 06 写 |
| 2      | byte_count  | uint8    | 1    | 数据字节数           |
| 3      | position    | uint16   | 2    | 当前位置 mm          |
| 5      | in_position | uint8    | 1    | 在位标志位段         |
| 6      | target_point| uint16   | 2    | 目标点位             |
| 8      | speed_rpm   | int16    | 2    | 转速 有符号补码      |
| 10     | err_code    | uint8    | 1    | 故障码               |
| 11     | reserved    | uint8    | 2    | 保留字段             |
| 13     | crc16       | uint16   | 2    | CRC16/MODBUS 低字节先 |

样例帧：01 03 02 0B B8 01 00 03 FF 88 00 00 7B 88`;

const DEMO_CASE_PROMPT = `每秒发送心跳，并且车辆得分每秒+1，车辆行走距离每秒+10米，持续循环运行`;

const DEMO_PRODUCT_PROMPT = `四轮差速智能物流小车，支持心跳通信、行车得分与里程上报、速度控制`;

export function AiDraftPanel() {
  const {
    aiOpen,
    toggleAi,
    applyDraft,
    protocols,
    activeProductId,
    createCase,
    updateCase,
    setView,
    setActiveCase,
    createProduct,
    createProtocol,
    updateProtocol,
  } = useStore();

  const [mode, setMode] = useState<AiMode>("case");
  const [doc, setDoc] = useState(DEMO_DOC);
  const [casePrompt, setCasePrompt] = useState(DEMO_CASE_PROMPT);
  const [productPrompt, setProductPrompt] = useState(DEMO_PRODUCT_PROMPT);

  // 产物草稿
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [caseDraft, setCaseDraft] = useState<GeneratedCaseDraft | null>(null);
  const [productDraft, setProductDraft] = useState<GeneratedProductDraft | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cfg, setCfg] = useState<AiConfig>(() => loadAiConfig());
  const [showCfg, setShowCfg] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState("AI 通信协议");

  const preview = useMemo(() => (draft ? previewBytes(draft) : "—"), [draft]);

  // 打开面板时若在用例模式且无草稿，自动跑一次示例
  useEffect(() => {
    if (!aiOpen) return;
    if (mode === "case" && !caseDraft) {
      setCaseDraft(localGenerateCaseDraft(casePrompt, protocols));
    }
  }, [aiOpen, mode]);

  if (!aiOpen) return null;

  /* ---------- 1. 协议生成 ---------- */
  const runProtocolLocal = () => {
    setErr("");
    setBusy(true);
    try {
      setDraft(localDraft(doc));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runProtocolRemote = async () => {
    setErr("");
    if (!cfg.apiKey.trim()) {
      setErr("未配置 API Key：可在下方「DeepSeek 模型设置」中填写，或使用本地确定性抽取");
      setShowCfg(true);
      return;
    }
    setBusy(true);
    try {
      saveAiConfig(cfg);
      setDraft(await remoteDraft(doc, cfg));
    } catch (e) {
      setErr(`DeepSeek 调用失败：${(e as Error).message}，已自动使用本地规则抽取`);
      try {
        setDraft(localDraft(doc));
      } catch {
        /* noop */
      }
    } finally {
      setBusy(false);
    }
  };

  const applyProtocol = () => {
    if (!draft) return;
    applyDraft(draftToProtocol(draft, activeProductId, name.trim() || "AI 协议"));
    setDraft(null);
    toggleAi();
    setView("protocol");
  };

  /* ---------- 2. 自动化测试用例生成 ---------- */
  const runCaseLocal = () => {
    setErr("");
    setBusy(true);
    try {
      setCaseDraft(localGenerateCaseDraft(casePrompt, protocols));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runCaseRemote = async () => {
    setErr("");
    if (!cfg.apiKey.trim()) {
      setErr("未配置 DeepSeek API Key，已为您使用本地离线规则引擎生成");
      runCaseLocal();
      return;
    }
    setBusy(true);
    try {
      saveAiConfig(cfg);
      const res = await remoteGenerateCaseDraft(casePrompt, protocols, cfg);
      setCaseDraft(res);
    } catch (e) {
      setErr(`DeepSeek 调用失败：${(e as Error).message}，已回退本地引擎推演`);
      runCaseLocal();
    } finally {
      setBusy(false);
    }
  };

  const applyTestCase = () => {
    if (!caseDraft) return;
    const caseName = caseDraft.name || "AI 编排自动化用例";
    createCase(caseName);
    // 从 store 读出刚创建的用例 ID
    const latestCase = useStore.getState().cases.find((c) => c.name === caseName) ?? useStore.getState().cases[0];
    if (latestCase) {
      updateCase(latestCase.id, {
        intervalMs: caseDraft.intervalMs,
        repeat: caseDraft.repeat,
        actions: caseDraft.actions.map((act, i) => ({
          id: `act_${Date.now()}_${i}`,
          name: `下发「${act.protocolName}」`,
          protocolId: act.protocolId,
          intervalMs: act.intervalMs,
          enabled: true,
          fields: act.fields.map((f) => ({
            fieldName: f.fieldName,
            step: f.step,
            customInit: f.customInit,
          })),
        })),
      });
      setActiveCase(latestCase.id);
    }
    setCaseDraft(null);
    toggleAi();
    setView("case");
  };

  /* ---------- 3. 产品全套方案生成 ---------- */
  const runProductLocal = () => {
    setErr("");
    setBusy(true);
    try {
      setProductDraft(localGenerateProductDraft(productPrompt));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runProductRemote = async () => {
    setErr("");
    if (!cfg.apiKey.trim()) {
      setErr("未配置 DeepSeek API Key，已为您使用本地离线方案架构引擎");
      runProductLocal();
      return;
    }
    setBusy(true);
    try {
      saveAiConfig(cfg);
      const res = await remoteGenerateProductDraft(productPrompt, cfg);
      setProductDraft(res);
    } catch (e) {
      setErr(`DeepSeek 调用失败：${(e as Error).message}，已回退本地生成`);
      runProductLocal();
    } finally {
      setBusy(false);
    }
  };

  const applyProduct = () => {
    if (!productDraft) return;
    // 1. 创建产品
    createProduct(productDraft.productName);
    const newProd = useStore.getState().products.find((p) => p.name === productDraft.productName);
    if (!newProd) return;

    // 2. 为产品创建协议
    const createdProtoIds: string[] = [];
    productDraft.protocols.forEach((proto) => {
      createProtocol(proto.name);
      const curr = useStore.getState().protocols.find((p) => p.name === proto.name && p.productId === newProd.id);
      if (curr) {
        createdProtoIds.push(curr.id);
        updateProtocol(curr.id, {
          checksum: { ...curr.checksum, algorithm: proto.checksumAlg },
          messages: [{ id: "m1", name: "默认数据包", fields: proto.fields }],
          sampleFrame: proto.sampleFrame,
        });
      }
    });

    // 3. 为产品创建自动化用例
    createCase(productDraft.caseName);
    const cItem = useStore.getState().cases.find((c) => c.name === productDraft.caseName);
    if (cItem) {
      updateCase(cItem.id, {
        intervalMs: 1000,
        repeat: 100,
        actions: productDraft.caseActions.map((ca, idx) => {
          const protoId = createdProtoIds[ca.protocolIndex] ?? createdProtoIds[0] ?? "";
          const targetProto = productDraft.protocols[ca.protocolIndex];
          return {
            id: `act_p_${Date.now()}_${idx}`,
            name: `下发「${targetProto?.name ?? "通信协议"}」`,
            protocolId: protoId,
            intervalMs: ca.intervalMs,
            enabled: true,
            fields: ca.fields,
          };
        }),
      });
      setActiveCase(cItem.id);
    }

    setProductDraft(null);
    toggleAi();
    setView("case");
  };

  const sampleHex = draft ? toHex(draft.sample) : "";

  return (
    <div className="ai-mask" onClick={toggleAi}>
      <div className="ai-panel" onClick={(e) => e.stopPropagation()}>
        {/* 顶栏与模式 Tab */}
        <div className="ai-head">
          <Icon cp={IC.ai} size={15} color="var(--purple)" />
          <span className="ai-title">AI 智能设计中心</span>

          {/* 模式选择 Tab */}
          <div style={{ display: "flex", gap: 4, background: "var(--bg-panel-3)", padding: 3, borderRadius: 6, marginLeft: 12 }}>
            <button
              className={mode === "case" ? "chip active" : "chip"}
              style={{ height: 22, fontSize: 11, background: mode === "case" ? "var(--purple)" : "transparent", color: "#fff" }}
              onClick={() => setMode("case")}
            >
              <Icon cp={IC.useCase} size={11} color="#fff" />
              <span>智能编排自动化用例</span>
            </button>
            <button
              className={mode === "protocol" ? "chip active" : "chip"}
              style={{ height: 22, fontSize: 11, background: mode === "protocol" ? "var(--purple)" : "transparent", color: "#fff" }}
              onClick={() => setMode("protocol")}
            >
              <Icon cp={IC.protocolDoc} size={11} color="#fff" />
              <span>智能生成通信协议</span>
            </button>
            <button
              className={mode === "product" ? "chip active" : "chip"}
              style={{ height: 22, fontSize: 11, background: mode === "product" ? "var(--purple)" : "transparent", color: "#fff" }}
              onClick={() => setMode("product")}
            >
              <Icon cp={IC.product} size={11} color="#fff" />
              <span>智能架构整套产品</span>
            </button>
          </div>

          <span className="spacer" />
          <span className="tag-mini" style={{ color: "var(--purple)", borderColor: "rgba(168,85,247,0.3)" }}>
            ⚡ DeepSeek 原生兼容
          </span>
          <button className="modal-close" onClick={toggleAi}>
            <Icon cp={IC.close} size={13} color="var(--t3)" />
          </button>
        </div>

        {/* 主体根据 mode 动态展示 */}
        <div className="ai-body">
          {/* ===================== TAB 1: 自动化用例 ===================== */}
          {mode === "case" && (
            <>
              {/* 左：需求输入 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ① 输入自动化测试场景
                  <span className="spacer" />
                  <button className="btn sm" onClick={() => setCasePrompt(DEMO_CASE_PROMPT)}>
                    填入心跳与行走示例
                  </button>
                </div>
                <textarea
                  className="ai-textarea"
                  value={casePrompt}
                  onChange={(e) => setCasePrompt(e.target.value)}
                  placeholder="例如：循环发送心跳，并且车辆得分每秒+1，行走距离每秒+10米"
                  spellCheck={false}
                />
                <div className="ai-hint">
                  <strong>核心原则</strong>：自动化中的变量永远是协议里的字段。AI 会自动识别当前产品的所有通信协议，并为字段配置步长（step）与循环下发周期。
                </div>
                <div className="row gap-8">
                  <button className="btn" onClick={runCaseLocal} disabled={busy}>
                    <Icon cp={IC.search} size={11} color="var(--t2)" />
                    本地规则推演（无需Key）
                  </button>
                  <button
                    className="btn"
                    style={{ background: "rgba(168,85,247,0.2)", borderColor: "var(--purple)", color: "#fff" }}
                    onClick={() => void runCaseRemote()}
                    disabled={busy}
                  >
                    <Icon cp={IC.ai} size={11} color="var(--purple)" />
                    DeepSeek 模型生成
                  </button>
                  <button className="btn sm" onClick={() => setShowCfg((v) => !v)}>
                    DeepSeek 设置
                  </button>
                </div>
              </div>

              {/* 中：生成的任务与字段自增列表 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ② 编排的任务与字段自增步长
                  {caseDraft && <span className="tag-mini">{caseDraft.actions.length} 个协议任务</span>}
                  <span className="spacer" />
                </div>
                <div className="ai-scroll">
                  {!caseDraft ? (
                    <div className="ai-empty">在左侧输入需求后点击生成</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ padding: "8px 10px", background: "var(--bg-panel-2)", borderRadius: 6, fontSize: 11 }}>
                        <div style={{ fontWeight: 600, color: "var(--t1)" }}>用例名: {caseDraft.name}</div>
                        <div style={{ color: "var(--t3)", marginTop: 2 }}>
                          周期: {caseDraft.intervalMs}ms · 轮次: {caseDraft.repeat} 轮
                        </div>
                      </div>

                      {caseDraft.actions.map((act, i) => (
                        <div key={i} style={{ padding: 10, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                            <span className="pill green" style={{ fontSize: 9 }}>任务 {i + 1}</span>
                            <span style={{ fontWeight: 600, color: "var(--t1)", fontSize: 12 }}>{act.protocolName}</span>
                          </div>
                          {act.fields.length === 0 ? (
                            <div style={{ fontSize: 10, color: "var(--t4)" }}>协议固定下发（无动态递增字段）</div>
                          ) : (
                            act.fields.map((f, fi) => (
                              <div key={fi} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, padding: "3px 0" }}>
                                <span style={{ color: "var(--t2)" }}>字段「{f.fieldName}」:</span>
                                <span style={{ fontWeight: 600, color: "var(--green)" }}>每秒 +{f.step}</span>
                              </div>
                            ))
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 右：动态推演流水与说明 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ③ 动态推演预测（秒级发包）
                  <span className="spacer" />
                  {caseDraft && <span className="pill green">就地闭环</span>}
                </div>
                <div className="ai-scroll">
                  {caseDraft ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div className="ai-hint" style={{ color: "var(--t2)", background: "rgba(0,0,0,0.2)", padding: 8, borderRadius: 6 }}>
                        💡 {caseDraft.explanation}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--t1)", marginTop: 4 }}>
                        预计发包流水推演：
                      </div>
                      <div style={{ padding: 8, background: "#090d14", borderRadius: 6, border: "1px dashed var(--line-2)", fontSize: 10, fontFamily: "var(--font-mono, monospace)" }}>
                        <div style={{ color: "var(--t4)", marginBottom: 4 }}>// 第 1 轮发送</div>
                        {caseDraft.actions.map((act, idx) => (
                          <div key={idx} style={{ color: "var(--accent)", marginBottom: 2 }}>
                            [TX] {act.protocolName}: {act.fields.map((f) => `${f.fieldName}=${(f.customInit ?? 0)}`).join(", ") || "心跳数据"}
                          </div>
                        ))}
                        <div style={{ color: "var(--t4)", margin: "6px 0 4px" }}>// 第 2 轮发送 (1秒后)</div>
                        {caseDraft.actions.map((act, idx) => (
                          <div key={idx} style={{ color: "var(--green)", marginBottom: 2 }}>
                            [TX] {act.protocolName}: {act.fields.map((f) => `${f.fieldName}=${(f.customInit ?? 0) + f.step}`).join(", ") || "心跳数据"}
                          </div>
                        ))}
                        <div style={{ color: "var(--t4)", margin: "6px 0 4px" }}>// 第 3 轮发送 (2秒后)</div>
                        {caseDraft.actions.map((act, idx) => (
                          <div key={idx} style={{ color: "var(--green)", marginBottom: 2 }}>
                            [TX] {act.protocolName}: {act.fields.map((f) => `${f.fieldName}=${(f.customInit ?? 0) + f.step * 2}`).join(", ") || "心跳数据"}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="ai-empty">等待生成推演流水</div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ===================== TAB 2: 通信协议 ===================== */}
          {mode === "protocol" && (
            <>
              {/* 左：协议文档 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ① 粘贴协议文档 / 表格 / 结构体
                  <span className="spacer" />
                  <button className="btn sm" onClick={() => setDoc(DEMO_DOC)}>
                    填入示例
                  </button>
                </div>
                <textarea className="ai-textarea" value={doc} onChange={(e) => setDoc(e.target.value)} spellCheck={false} />
                <div className="ai-hint">
                  支持字段表格、C 结构体和样例报文。本地规则引擎不联网秒级解析；DeepSeek 可深度推理变长与复杂协议。
                </div>
                <div className="row gap-8">
                  <button className="btn" onClick={runProtocolLocal} disabled={busy}>
                    <Icon cp={IC.search} size={11} color="var(--t2)" />
                    本地抽取（无需Key）
                  </button>
                  <button
                    className="btn"
                    style={{ background: "rgba(168,85,247,0.2)", borderColor: "var(--purple)", color: "#fff" }}
                    onClick={() => void runProtocolRemote()}
                    disabled={busy}
                  >
                    <Icon cp={IC.ai} size={11} color="var(--purple)" />
                    DeepSeek 模型生成
                  </button>
                  <button className="btn sm" onClick={() => setShowCfg((v) => !v)}>
                    DeepSeek 设置
                  </button>
                </div>
              </div>

              {/* 中：提取的字段 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ② 草稿字段
                  {draft && <span className="tag-mini">{draft.protocol.messages[0].fields.length} 字段</span>}
                  <span className="spacer" />
                </div>
                <div className="ai-scroll">
                  {!draft ? (
                    <div className="ai-empty">还没有草稿 —— 先点左侧抽取按钮</div>
                  ) : (
                    <table className="dt" style={{ background: "transparent" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>offset</th>
                          <th>字段名</th>
                          <th style={{ width: 66 }}>类型</th>
                          <th style={{ width: 42 }}>长度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.protocol.messages[0].fields.map((f) => (
                          <tr key={f.id}>
                            <td className="num">{f.offset < 0 ? "—" : f.offset}</td>
                            <td className="name">{f.name}</td>
                            <td>
                              <span className={f.type === "crc" ? "type-pill crc" : "type-pill"}>{f.type}</span>
                            </td>
                            <td className="num">{f.size}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* 右：校验结果 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ③ 校验验证
                  <span className="spacer" />
                  {draft && (
                    <span className={draft.roundTripOk ? "pill green" : "pill red"}>
                      {draft.roundTripOk ? "round-trip 通过" : "round-trip 未通过"}
                    </span>
                  )}
                </div>
                <div className="ai-scroll">
                  {draft ? (
                    <>
                      <div className="ai-kv">
                        <span>样例帧</span>
                        <span className="preview-hex" style={{ color: "var(--t1)" }}>
                          {sampleHex || "—"}
                        </span>
                      </div>
                      <div className="ai-kv">
                        <span>组包结果</span>
                        <span className="preview-hex" style={{ color: draft.roundTripOk ? "var(--green)" : "var(--red)" }}>
                          {preview}
                        </span>
                      </div>
                      <div className="ai-kv">
                        <span>校验算法</span>
                        <span className="preview-hex" style={{ color: "var(--green)" }}>
                          {draft.usedChecksum}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="ai-empty">校验结果会显示在这里</div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ===================== TAB 3: 产品全套 ===================== */}
          {mode === "product" && (
            <>
              {/* 左：输入产品设想 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ① 描述您的产品或设备
                  <span className="spacer" />
                  <button className="btn sm" onClick={() => setProductPrompt(DEMO_PRODUCT_PROMPT)}>
                    填入小车示例
                  </button>
                </div>
                <textarea
                  className="ai-textarea"
                  value={productPrompt}
                  onChange={(e) => setProductPrompt(e.target.value)}
                  placeholder="例如：智能四驱避障巡检小车，具有超声波雷达和得分计算功能"
                  spellCheck={false}
                />
                <div className="ai-hint">
                  根据您的产品设想，一键自动构建：产品名称、子模块MCU、2套标准通信协议（心跳+业务数据），以及对应的自动化自增测试用例。
                </div>
                <div className="row gap-8">
                  <button className="btn" onClick={runProductLocal} disabled={busy}>
                    <Icon cp={IC.search} size={11} color="var(--t2)" />
                    本地方案架构（无需Key）
                  </button>
                  <button
                    className="btn"
                    style={{ background: "rgba(168,85,247,0.2)", borderColor: "var(--purple)", color: "#fff" }}
                    onClick={() => void runProductRemote()}
                    disabled={busy}
                  >
                    <Icon cp={IC.ai} size={11} color="var(--purple)" />
                    DeepSeek 模型架构
                  </button>
                  <button className="btn sm" onClick={() => setShowCfg((v) => !v)}>
                    DeepSeek 设置
                  </button>
                </div>
              </div>

              {/* 中：生成的通信协议 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ② 规划的通信协议
                  {productDraft && <span className="tag-mini">{productDraft.protocols.length} 个协议</span>}
                  <span className="spacer" />
                </div>
                <div className="ai-scroll">
                  {!productDraft ? (
                    <div className="ai-empty">输入产品设想后点击生成</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ padding: "8px 10px", background: "var(--bg-panel-2)", borderRadius: 6, fontSize: 11 }}>
                        <div style={{ fontWeight: 600, color: "var(--t1)" }}>产品: {productDraft.productName}</div>
                        <div style={{ color: "var(--t3)", marginTop: 2 }}>模块: {productDraft.subProductName}</div>
                      </div>
                      {productDraft.protocols.map((p, i) => (
                        <div key={i} style={{ padding: 10, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <span style={{ fontWeight: 600, color: "var(--t1)", fontSize: 12 }}>{p.name}</span>
                            <span className="tag-mini">{p.checksumAlg}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "var(--t3)" }}>
                            字段: {p.fields.map((f) => f.name).join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 右：配套自动化用例 */}
              <div className="ai-col">
                <div className="ai-col-title">
                  ③ 配套自动化测试用例
                  <span className="spacer" />
                </div>
                <div className="ai-scroll">
                  {!productDraft ? (
                    <div className="ai-empty">等待生成配套自动化方案</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ padding: 10, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 6 }}>
                        <div style={{ fontWeight: 600, color: "var(--t1)", fontSize: 12, marginBottom: 4 }}>
                          {productDraft.caseName}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--t3)", marginBottom: 8 }}>
                          💡 {productDraft.explanation}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--green)" }}>
                          自动为业务协议字段绑定每秒自增，无需任何代码即可开箱执行测试。
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 错误提示 */}
        {err && (
          <div className="ai-err">
            <Icon cp={IC.warn} size={11} color="var(--red)" />
            <span>{err}</span>
          </div>
        )}

        {/* DeepSeek API 配置浮层 */}
        {showCfg && (
          <div style={{ padding: "12px 16px", background: "var(--bg-panel-2)", borderTop: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--t1)" }}>DeepSeek / OpenAI 兼容模型设置</span>
              <button className="btn sm" onClick={() => setShowCfg(false)}>收起设置</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span>Base URL:</span>
                <input
                  className="proto-input"
                  style={{ width: 220 }}
                  value={cfg.baseUrl}
                  onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span>API Key:</span>
                <input
                  className="proto-input"
                  type="password"
                  placeholder="sk-..."
                  style={{ width: 200 }}
                  value={cfg.apiKey}
                  onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span>Model:</span>
                <input
                  className="proto-input"
                  style={{ width: 120 }}
                  value={cfg.model}
                  onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                />
              </div>
              <button
                className="btn sm"
                disabled={testing}
                onClick={async () => {
                  setTesting(true);
                  setTestMsg(null);
                  const r = await testAiConfig(cfg);
                  setTestMsg(r);
                  setTesting(false);
                  if (r.ok) saveAiConfig(cfg);
                }}
              >
                {testing ? "测试中…" : "测试连通性"}
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  saveAiConfig(cfg);
                  setTestMsg({ ok: true, message: "已保存到本机" });
                }}
              >
                保存配置
              </button>
              {testMsg && (
                <span style={{ fontSize: 11, color: testMsg.ok ? "var(--green)" : "var(--red)" }}>
                  {testMsg.message}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 底部应用栏 */}
        <div className="ai-foot">
          <span className="ai-hint">生成后直接写入当前工作空间，随时可以在界面中继续调整。</span>
          <span className="spacer" />

          {mode === "case" && (
            <button className="btn-primary" disabled={!caseDraft} onClick={applyTestCase}>
              <Icon cp={IC.check} size={12} color="#fff" />
              <span>应用到自动化测试（立即使用）</span>
            </button>
          )}

          {mode === "protocol" && (
            <>
              <input
                className="dlg-input"
                style={{ width: 180 }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="协议名称"
              />
              <button className="btn-primary" disabled={!draft} onClick={applyProtocol}>
                <Icon cp={IC.check} size={12} color="#fff" />
                <span>应用到通信协议</span>
              </button>
            </>
          )}

          {mode === "product" && (
            <button className="btn-primary" disabled={!productDraft} onClick={applyProduct}>
              <Icon cp={IC.check} size={12} color="#fff" />
              <span>一键架构并创建整套产品</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
