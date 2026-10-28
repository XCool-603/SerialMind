import { useMemo, useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import { toHex } from "../engine/bytes";

/** 真实曲线：数据来自「当前帧解出的某个数值字段」在最近帧里的序列 */
function CurveChart({ values, label }: { values: number[]; label: string }) {
  if (!values.length) {
    return (
      <div className="ai-empty" style={{ padding: "28px 8px" }}>
        暂无数据 —— 收到含「{label}」字段的帧后自动绘制
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 288;
  const h = 76;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 16) - 8).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1];
  return (
    <div className="curve-box">
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <line x1="0" y1={h - 8} x2={w} y2={h - 8} stroke="var(--line-3)" strokeWidth="1" />
        <polyline points={pts} fill="none" stroke="var(--green)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="curve-legend">
        <span className="dot" style={{ background: "var(--green)" }} />
        <span>{label}</span>
        <span className="spacer" />
        <span className="num">
          {last}（{values.length} 点）
        </span>
      </div>
    </div>
  );
}

export function Inspector() {
  const { frames, selectedFrameId, inspectorTab, setInspectorTab, setView } = useStore();
  const [curveField, setCurveField] = useState("");

  const frame = useMemo(
    () => frames.find((f) => f.id === selectedFrameId) ?? frames[frames.length - 1],
    [frames, selectedFrameId],
  );

  const fields = frame?.fields ?? [];

  /** 可画曲线的数值字段（枚举/固定字节不算） */
  const numericNames = useMemo(() => {
    const set = new Set<string>();
    for (const fr of frames.slice(-60)) {
      for (const f of fr.fields ?? []) {
        if (typeof f.value === "number" && f.field.type !== "crc" && !f.field.hex) set.add(f.field.name);
      }
    }
    return [...set];
  }, [frames]);

  const activeCurve = curveField || numericNames[0] || "";

  const series = useMemo(() => {
    if (!activeCurve) return [];
    return frames
      .slice(-60)
      .map((fr) => {
        const f = (fr.fields ?? []).find((x) => x.field.name === activeCurve);
        return f && typeof f.value === "number" ? f.value : null;
      })
      .filter((v): v is number => v !== null);
  }, [frames, activeCurve]);

  const TABS = [
    { key: "fields" as const, label: "字段树" },
    { key: "curve" as const, label: "曲线" },

  ];

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={inspectorTab === t.key ? "chip active" : "chip"}
            onClick={() => setInspectorTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {inspectorTab === "fields" && (
        <div className="inspector-body">
          {!frame ? (
            <div className="ai-empty" style={{ padding: "28px 8px" }}>
              还没有选中报文
            </div>
          ) : (
            <>
              <div className="insp-card">
                <div className="insp-card-head">
                  <span className="insp-card-title">
                    {frame.dir === "rx" ? "RX" : "TX"} #{frame.no} · {frame.time}
                  </span>
                  <span className={frame.matched === false ? "pill amber" : frame.crcOk ? "pill green" : "pill red"} style={{ height: 16 }}>
                    {frame.matched === false ? "不符合协议" : frame.crcOk ? "校验通过" : "校验失败"}
                  </span>
                </div>
                <div className="insp-hex">{toHex(frame.bytes)}</div>
                <div className="insp-meta">
                  {frame.bytes.length} 字节 · {frame.dir === "rx" ? "接收" : "发送"}
                  {frame.banner ? ` · ${frame.banner}` : ""}
                </div>
              </div>

              <div className="insp-card">
                <div className="insp-card-head">
                  <Icon cp={IC.protocolDoc} size={11} color="var(--t3)" />
                  <span className="insp-card-title">{frame.matched === false ? "解包字段（不适用）" : `解包字段（${fields.length}）`}</span>
                  <span className="spacer" />
                  <button className="mini-btn" onClick={() => setView("protocol")}>
                    改协议
                  </button>
                </div>
                {frame.matched === false ? (
                  <div className="ai-empty" style={{ padding: "18px 8px", color: "var(--amber)", lineHeight: 1.6 }}>
                    {frame.banner ?? "这帧不符合当前协议，字段解析无意义"}
                  </div>
                ) : fields.length === 0 ? (
                  <div className="ai-empty" style={{ padding: "18px 8px" }}>
                    当前没有协议在解析 —— 去「协议」页选中你的协议
                  </div>
                ) : (
                  <div className="insp-fields">
                    {fields.map((f, i) => (
                      <div className={`insp-field${f.ok ? "" : " bad"}`} key={`${f.field.id}-${i}`}>
                        <span className="name">{f.field.name}</span>
                        <span className="raw">{toHex(f.raw)}</span>
                        <span className="value num">{f.display}</span>
                        {!f.ok && <span className="err">{f.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {inspectorTab === "curve" && (
        <div className="inspector-body">
          <div className="insp-card">
            <div className="insp-card-head">
              <Icon cp={IC.report} size={11} color="var(--t3)" />
              <span className="insp-card-title">曲线</span>
              <span className="spacer" />
              {numericNames.length > 0 && (
                <select
                  className="cell-select"
                  style={{ width: 96, height: 20, fontSize: 9 }}
                  value={activeCurve}
                  onChange={(e) => setCurveField(e.target.value)}
                >
                  {numericNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {numericNames.length === 0 ? (
              <div className="ai-empty" style={{ padding: "28px 8px" }}>
                还没有可画曲线的数值字段 —— 先收到几帧，或去协议页确认字段类型
              </div>
            ) : (
              <CurveChart values={series} label={activeCurve} />
            )}
          </div>
        </div>
      )}

    </aside>
  );
}