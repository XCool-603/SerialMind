import { useEffect, useMemo, useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import { localDraft, remoteDraft, loadAiConfig, saveAiConfig, testAiConfig, draftToProtocol, previewBytes, type AiConfig, type DraftResult } from "../engine/ai";
import { toHex } from "../engine/bytes";

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

export function AiDraftPanel() {
  const { aiOpen, toggleAi, applyDraft } = useStore();
  const [doc, setDoc] = useState(DEMO_DOC);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cfg, setCfg] = useState<AiConfig>(() => loadAiConfig());
  const [showCfg, setShowCfg] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState("AI 草稿协议");

  const preview = useMemo(() => (draft ? previewBytes(draft) : "—"), [draft]);

  // 演示/直达：?ai=1 时自动跑一次本地抽取
  useEffect(() => {
    if (!aiOpen || draft) return;
    if (new URLSearchParams(window.location.search).get("ai") === "1") {
      try {
        setDraft(localDraft(doc));
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOpen]);

  if (!aiOpen) return null;

  const runLocal = () => {
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

  const runRemote = async () => {
    setErr("");
    if (!cfg.apiKey.trim()) {
      setErr("未配置 API Key：可在下方「模型设置」里填，或直接用本地抽取（无需联网）");
      setShowCfg(true);
      return;
    }
    setBusy(true);
    try {
      saveAiConfig(cfg);
      setDraft(await remoteDraft(doc, cfg));
    } catch (e) {
      setErr(`远程调用失败：${(e as Error).message}　已自动回退本地抽取`);
      try {
        setDraft(localDraft(doc));
      } catch {
        /* noop */
      }
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!draft) return;
    const productId = useStore.getState().activeProductId;
    applyDraft(draftToProtocol(draft, productId, name.trim() || "AI 草稿协议"));
    setDraft(null);
  };

  const sampleHex = draft ? toHex(draft.sample) : "";

  return (
    <div className="ai-mask" onClick={toggleAi}>
      <div className="ai-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ai-head">
          <Icon cp={IC.ai} size={14} color="var(--purple)" />
          <span className="ai-title">AI 草稿区</span>
          <span className="pill purple" style={{ height: 16 }}>
            L1 只建议
          </span>
          <span className="ai-sub">AI 产出草稿，你点「应用到协议」才生效</span>
          <span className="spacer" />
          <button className="modal-close" onClick={toggleAi}>
            <Icon cp={IC.close} size={13} color="var(--t3)" />
          </button>
        </div>

        <div className="ai-body">
          {/* 左：输入 */}
          <div className="ai-col">
            <div className="ai-col-title">
              ① 粘贴协议文档
              <span className="spacer" />
              <button className="btn sm" onClick={() => setDoc(DEMO_DOC)}>
                填入示例
              </button>
            </div>
            <textarea className="ai-textarea" value={doc} onChange={(e) => setDoc(e.target.value)} spellCheck={false} />
            <div className="ai-hint">
              支持：字段表格 / C 结构体 / 样例帧。本地抽取是**确定性解析**（不联网、不猜），远程模型仅在填了 Key 时使用。
            </div>
            <div className="row gap-8">
              <button className="btn" onClick={runLocal} disabled={busy}>
                <Icon cp={IC.search} size={11} color="var(--t2)" />
                本地抽取（无需 Key）
              </button>
              <button className="btn" onClick={() => void runRemote()} disabled={busy}>
                <Icon cp={IC.ai} size={11} color="var(--purple)" />
                调用模型生成
              </button>
              <button className="btn sm" onClick={() => setShowCfg((v) => !v)}>
                模型设置
              </button>
            </div>

            {showCfg && (
              <div className="ai-cfg">
                <div className="dlg-row">
                  <span className="dlg-label">Base URL</span>
                  <input className="dlg-input" value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} />
                </div>
                <div className="dlg-row">
                  <span className="dlg-label">API Key</span>
                  <input
                    className="dlg-input"
                    type="password"
                    placeholder="sk-..."
                    value={cfg.apiKey}
                    onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                  />
                </div>
                <div className="dlg-row">
                  <span className="dlg-label">模型</span>
                  <input className="dlg-input" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
                </div>
                <div className="ai-hint">
                  兼容 OpenAI 协议：DeepSeek / 通义 / Kimi / Ollama 均可。Key 只存本机 localStorage，不上传。
                </div>
                <div className="row gap-8" style={{ marginTop: 8, alignItems: "center" }}>
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
                    <Icon cp={IC.link} size={10} color="var(--t2)" />
                    {testing ? "测试中…" : "测试连接"}
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
                    <span className="ai-hint" style={{ color: testMsg.ok ? "var(--green)" : "var(--red)", margin: 0 }}>
                      {testMsg.message}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 中：草稿 */}
          <div className="ai-col">
            <div className="ai-col-title">
              ② 草稿字段
              {draft && <span className="tag-mini">{draft.protocol.messages[0].fields.length} 字段</span>}
              <span className="spacer" />
              {draft && <span className="pill gray">{draft.source === "remote" ? "远程模型" : "本地抽取"}</span>}
            </div>
            <div className="ai-scroll">
              {!draft && <div className="ai-empty">还没有草稿 —— 先点左边的「本地抽取」</div>}
              {draft && (
                <table className="dt" style={{ background: "transparent" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>offset</th>
                      <th>字段名</th>
                      <th style={{ width: 66 }}>类型</th>
                      <th style={{ width: 42 }}>长度</th>
                      <th style={{ width: 58 }}>字节序</th>
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
                        <td>{f.byteOrder ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 右：校验 */}
          <div className="ai-col">
            <div className="ai-col-title">
              ③ 校验（不通过不许保存）
              <span className="spacer" />
              {draft && (
                <span className={draft.roundTripOk ? "pill green" : "pill red"}>
                  {draft.roundTripOk ? "round-trip 通过" : "round-trip 未通过"}
                </span>
              )}
            </div>
            <div className="ai-scroll">
              {draft && (
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
                  {draft.checksumCandidates.length > 0 && (
                    <div className="ai-cands">
                      {draft.checksumCandidates.map((c) => (
                        <span key={c.alg} className={c.ok ? "alg-chip active" : "alg-chip"}>
                          {c.alg}
                          {c.ok ? " ✓" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="ai-issues">
                    {draft.issues.map((it, i) => (
                      <div className={`ai-issue ${it.level}`} key={i}>
                        <Icon
                          cp={it.level === "error" ? IC.error : it.level === "warn" ? IC.warn : IC.check}
                          size={10}
                          color={it.level === "error" ? "var(--red)" : it.level === "warn" ? "var(--amber)" : "var(--green)"}
                        />
                        <span>{it.text}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {!draft && <div className="ai-empty">校验结果会显示在这里</div>}
            </div>
          </div>
        </div>

        {err && (
          <div className="ai-err">
            <Icon cp={IC.warn} size={11} color="var(--red)" />
            <span>{err}</span>
          </div>
        )}

        <div className="ai-foot">
          <span className="ai-hint">应用后可在「协议」页继续编辑；AI 不会自动改已有配置。</span>
          <span className="spacer" />
          <input className="dlg-input" style={{ width: 200 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="协议名称" />
          <button className="btn" onClick={() => setDraft(null)}>
            丢弃草稿
          </button>
          <button className="btn-primary" disabled={!draft} onClick={apply}>
            <Icon cp={IC.check} size={12} color="#fff" />
            应用到协议
          </button>
        </div>
      </div>
    </div>
  );
}
