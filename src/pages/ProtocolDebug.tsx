import { useEffect, useMemo, useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import { decodeFrame, encodeMessage, resolveLayout } from "../engine/codec";
import { messageLength, type PdlMessage, type PdlProtocol } from "../engine/pdl";
import { readBigEndian, toHex, undoOrder } from "../engine/bytes";

interface Props {
  proto: PdlProtocol;
  msg: PdlMessage;
}

/** 协议调试面板：填字段 → 组包预览 → 发送 → 看解析回包 */
export function ProtocolDebug({ proto, msg }: Props) {
  const { sendBytes, frames, connection, paused, togglePause, clearFrames } = useStore();
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  /** 固定字节字段的可编辑值（不落库，只影响本次发送） */
  const [hexEdits, setHexEdits] = useState<Record<string, string>>({});
  /** 每个字段在调试面板里可以单独切 HEX / 十进制 */
  const [formats, setFormats] = useState<Record<string, "hex" | "dec">>({});

  /** 字段结构 + 默认值的签名，变了就重新初始化表单 */
  const fieldSig = msg.fields.map((f) => `${f.id}:${f.value ?? ""}:${f.size}:${f.type}`).join("|");

  // 切换报文/协议时，用字段默认值初始化表单
  useEffect(() => {
    const init: Record<string, number> = {};
    for (const f of msg.fields) {
      if (f.type === "crc" || f.hex) continue;
      init[f.name] = Number(f.value ?? 0);
    }
    // 变长协议：长度字段给个默认（样例帧长度或 8）
    const lenField = msg.fields.find((f) => f.name === "len" || f.name === "length");
    if (lenField && msg.fields.some((f) => f.sizeExpr)) {
      init[lenField.name] = Number(lenField.value ?? 8);
    }
    setValues(init);
    setError("");
    // 字段默认值/结构变了也要重新同步（否则改了默认值，这里还是旧值）
  }, [fieldSig, proto.id]);

  const layout = useMemo(() => {
    const total = messageLength(msg);
    const frameLen = total > 0 ? total : Number(values["len"] ?? values["length"] ?? 0) || 8;
    return resolveLayout(msg, frameLen, values);
  }, [msg, values]);

  /** 带上用户改过的固定字节 */
  const effMsg = useMemo(
    () => ({ ...msg, fields: msg.fields.map((f) => (hexEdits[f.id] !== undefined ? { ...f, hex: hexEdits[f.id] } : f)) }),
    [msg, hexEdits],
  );

  const preview = useMemo(() => {
    try {
      const bytes = encodeMessage(proto, effMsg, values);
      return { hex: toHex(bytes), bytes, err: "" };
    } catch (e) {
      return { hex: "", bytes: [], err: (e as Error).message };
    }
  }, [proto, effMsg, values]);

  /** 从组包结果里读回每个字段的实际值（自动字段也能看到） */
  const computed = useMemo(() => {
    const out: Record<string, number> = {};
    if (!preview.bytes.length) return out;
    try {
      const lay = resolveLayout(effMsg, preview.bytes.length, values);
      for (const l of lay) {
        const raw = preview.bytes.slice(l.offset, l.offset + l.size);
        if (raw.length !== l.size || !l.size) continue;
        out[l.field.name] = readBigEndian(undoOrder(raw, l.field.byteOrder ?? "ABCD"), false);
      }
    } catch {
      /* noop */
    }
    return out;
  }, [preview.bytes, effMsg, values]);

  const send = async () => {
    setError("");
    if (!preview.bytes.length) {
      setError(preview.err || (msg.fields.length === 0 ? "这个协议还没有字段，先在协议里加字段" : "组包失败"));
      return;
    }
    await sendBytes(preview.bytes, "manual");
  };

  const recent = frames.slice(-40).reverse();

  const editable = layout.filter((l) => !(l.field.type === "crc" || l.field.auto === "frameLength" || l.field.valueExpr));

  return (
    <div className="pdbg">
      <div className="pdbg-head">
        <Icon cp={IC.terminal} size={12} color="var(--t3)" />
        <span className="pdbg-title">调试发送</span>
        <span className="tag-mini">{msg.name}</span>
        <span className="spacer" />
        <span className={connection.connected ? "pill green" : "pill gray"}>
          {connection.connected ? `${connection.port} 已连接` : "串口未连接"}
        </span>
        <button className="btn sm" onClick={togglePause}>
          <Icon cp={paused ? IC.play : IC.pause} size={10} color="var(--t2)" />
          {paused ? "继续" : "暂停"}
        </button>
        <button className="btn sm" onClick={clearFrames}>
          清空记录
        </button>
      </div>

      <div className="pdbg-body">
        {/* 字段表单 */}
        <div className="pdbg-form">
          <div className="pdbg-sub">
            字段
            <span className="spacer" />
            <span style={{ fontSize: 8, color: "var(--t5)" }}>每个字段都能切 HEX / 十进制</span>
          </div>
          <div className="pdbg-grid">
            {layout
              .filter((l) => l.field.offset >= 0)
              .map(({ field: f, offset, size }) => {
                const base = formats[f.name] ?? "hex";
                const isAuto = f.type === "crc" || f.auto === "frameLength" || !!f.valueExpr;
                const enumEntries = f.enumMap ? Object.entries(f.enumMap) : [];
                const num = Number(values[f.name] ?? 0);
                // 自动字段：从组包结果里读回真实值，便于切换进制查看
                const autoNum = computed[f.name] ?? 0;
                const shown = isAuto ? autoNum : num;
                const asHex = shown.toString(16).toUpperCase().padStart(Math.max(2, size * 2), "0");
                const asDec = String(shown);
                return (
                  <label className="pdbg-field" key={f.id}>
                    <span className="pdbg-label" title={f.desc ?? ""}>
                      {f.name}
                      <span className="pdbg-type">{size}B</span>
                      <button
                        className="pdbg-fmt"
                        title="切换 HEX / 十进制"
                        onClick={() => setFormats((x) => ({ ...x, [f.name]: (x[f.name] ?? "hex") === "hex" ? "dec" : "hex" }))}
                      >
                        {base === "hex" ? "HEX" : "10进制"}
                      </button>
                    </span>

                    {isAuto ? (
                      <span className="pdbg-fixed" title={f.type === "crc" ? "自动校验" : f.auto === "frameLength" ? "自动整帧长度" : `自动 ${f.valueExpr}`}>
                        {base === "hex" ? asHex : asDec}
                        <span style={{ color: "var(--t5)", marginLeft: 4 }}>自动</span>
                      </span>
                    ) : f.hex !== undefined ? (
                      base === "hex" ? (
                        <input
                          className="cell-input pdbg-input"
                          value={hexEdits[f.id] ?? f.hex}
                          title="固定字节（HEX），可直接改"
                          onChange={(e) => setHexEdits((h) => ({ ...h, [f.id]: e.target.value }))}
                        />
                      ) : (
                        <input
                          className="cell-input num pdbg-input"
                          value={String(parseInt((hexEdits[f.id] ?? f.hex ?? "").replace(/[^0-9a-fA-F]/g, "") || "0", 16))}
                          title="十进制，改完自动转回 HEX 字节"
                          onChange={(e) => {
                            const n = Number(e.target.value.trim()) || 0;
                            const hex = n
                              .toString(16)
                              .toUpperCase()
                              .padStart(size * 2, "0")
                              .match(/../g)
                              ?.join(" ");
                            setHexEdits((h) => ({ ...h, [f.id]: hex ?? "00" }));
                          }}
                        />
                      )
                    ) : enumEntries.length ? (
                      <select
                        className="cell-select pdbg-input"
                        value={String(num)}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: Number(e.target.value) }))}
                      >
                        {enumEntries.map(([k, label]) => (
                          <option key={k} value={k}>
                            {base === "hex"
                              ? `${Number(k).toString(16).padStart(2, "0").toUpperCase()} ${label}`
                              : `${Number(k)} ${label}`}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "bool" ? (
                      <button
                        className={values[f.name] ? "switch-track on" : "switch-track"}
                        style={{ marginTop: 3 }}
                        onClick={() => setValues((v) => ({ ...v, [f.name]: v[f.name] ? 0 : 1 }))}
                      >
                        <span className="switch-knob" />
                      </button>
                    ) : (
                      <input
                        className="cell-input num pdbg-input"
                        value={base === "hex" ? asHex : asDec}
                        title={`${base === "hex" ? "十六进制" : "十进制"} · ${size} 字节 · 实际字节 ${asHex.match(/../g)?.join(" ") ?? ""}`}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!raw) {
                            setValues((v) => ({ ...v, [f.name]: 0 }));
                            return;
                          }
                          const n = base === "hex" ? parseInt(raw.replace(/^0x/i, ""), 16) : Number(raw.replace(/^0x/i, "0x"));
                          setValues((v) => ({ ...v, [f.name]: Number.isFinite(n) ? n : 0 }));
                        }}
                      />
                    )}
                  </label>
                );
              })}
          </div>
        </div>

        {/* 组包预览 + 发送 */}
        <div className="pdbg-send">
          <div className="pdbg-sub">组包预览</div>
          <div className="pdbg-preview">{preview.hex || "—"}</div>
          <div className="pdbg-meta">
            {preview.bytes.length} 字节 · {proto.checksum.algorithm}
          </div>
          {(error || preview.err) && (
            <div className="result-bad" style={{ marginTop: 6, fontSize: 9 }}>
              <Icon cp={IC.warn} size={10} color="var(--red)" />
              <span>{error || preview.err}</span>
            </div>
          )}
          <button className="btn-primary" style={{ marginTop: 8, height: 30, justifyContent: "center" }} onClick={() => void send()}>
            <Icon cp={IC.arrowLeft} size={12} color="#fff" />
            <span>发送</span>
          </button>
          {!connection.connected && <div className="ai-hint" style={{ marginTop: 6 }}>串口未连接：仍会记录 TX，但不会真的写出去</div>}
        </div>

        {/* 收发记录 */}
        <div className="pdbg-log">
          <div className="pdbg-sub">
            收发记录
            <span className="spacer" />
            <span style={{ color: "var(--t4)", fontSize: 9 }}>按当前协议解析</span>
          </div>
          <div className="pdbg-loglist">
            {recent.length === 0 && <div className="ai-hint">还没有报文</div>}
            {recent.map((fr) => {
              let summary = "";
              try {
                const d = decodeFrame(proto, fr.bytes);
                summary = d.fields
                  .filter((f) => f.field.type !== "crc")
                  .map((f) => `${f.field.name}=${f.display}`)
                  .join("  ");
              } catch {
                summary = "";
              }
              return (
                <div className={`pdbg-row${fr.crcOk ? "" : " bad"}`} key={fr.id}>
                  <span className="t">{fr.time}</span>
                  <span className={fr.dir === "rx" ? "dir rx" : "dir tx"}>{fr.dir === "rx" ? "← RX" : "→ TX"}</span>
                  <span className="hex">{toHex(fr.bytes)}</span>
                  <span className="sum">{summary}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}