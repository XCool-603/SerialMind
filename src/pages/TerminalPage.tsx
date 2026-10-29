import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Frame, type Source } from "../engine/store";
import { toHex, asciiView, bytesToString, parseHex, stringToBytes } from "../engine/bytes";
import { Icon, IC } from "../components/Icon";
import type { PdlProtocol } from "../engine/pdl";
import { download, stampName } from "../lib/download";
import { ALGORITHM_GROUPS, ALGORITHM_META } from "../engine/crc";

const SOURCE_LABEL: Record<Source, string> = {
  device: "设备",
  manual: "手动",
  period: "周期",
  trigger: "触发",
  case: "用例",
  reply: "应答",
  ai: "AI",
};

const FILTERS: { key: "all" | Source; label: string; icon?: string; color?: string }[] = [
  { key: "all", label: "全部" },
  { key: "manual", label: "手动", icon: IC.manual },
  { key: "case", label: "用例", icon: IC.useCase },
  { key: "reply", label: "应答", icon: IC.reply },
  { key: "ai", label: "AI", icon: IC.ai, color: "var(--purple)" },
];

function DirCell({ dir }: { dir: "rx" | "tx" }) {
  return (
    <div className={`dir-cell ${dir}`}>
      <Icon cp={dir === "rx" ? IC.arrowRight : IC.arrowLeft} size={12} />
      <span>{dir === "rx" ? "RX" : "TX"}</span>
    </div>
  );
}

function FieldPairs({ frame, proto }: { frame: Frame; proto?: PdlProtocol }) {
  const currentProtoName = frame.protocolName || proto?.name || "未指定协议";
  const pairs: { k: string; v: string; ok?: boolean }[] = [
    { k: "所属协议", v: currentProtoName, ok: true },
  ];
  for (const f of frame.fields ?? []) {
    if (f.field.type === "crc") continue;
    pairs.push({ k: f.field.name, v: `=${f.display}`, ok: f.ok ? undefined : false });
  }
  if (frame.matched === false) {
    pairs.length = 0;
    pairs.push({ k: "提示", v: frame.banner ?? "未匹配到预设协议，按原始数据解析", ok: false });
    return (
      <div className="field-list">
        {pairs.map((p, i) => (
          <span className="field-pair" key={i}>
            <span className="k">{p.k}</span>
            <span className="v">{p.v}</span>
          </span>
        ))}
      </div>
    );
  }
  const hasCrc = (frame.fields ?? []).some((f) => f.field.type === "crc");
  if (hasCrc) {
    pairs.push({
      k: proto?.checksum.algorithm ?? "校验",
      v: frame.crcOk ? "校验通过" : `校验失败（期望 ${frame.crcExpected}，实际 ${frame.crcActual}）`,
      ok: frame.crcOk,
    });
  }
  if (frame.banner) pairs.push({ k: "提示", v: frame.banner, ok: false });
  if (!pairs.length) pairs.push({ k: "原始", v: `${frame.bytes.length} 字节` });
  return (
    <div className="field-list">
      {pairs.map((p, i) => (
        <span className="field-pair" key={i}>
          <span className="k">{p.k}</span>
          <span className={p.ok ? "ok" : "v"}>{p.v}</span>
        </span>
      ))}
    </div>
  );
}

export function TerminalPage() {
  const {
    frames,
    filter,
    setFilter,
    viewMode,
    setViewMode,
    termViewMode,
    setTermViewMode,
    showTimestamp,
    setShowTimestamp,
    autoScroll,
    setAutoScroll,
    paused,
    togglePause,
    clearFrames,
    selectedFrameId,
    selectFrame,
    sendInput,
    setSendInput,
    sendCurrent,
    sendMode,
    setSendMode,
    sendNewline,
    setSendNewline,
    clearOnSend,
    setClearOnSend,
    periodSend,
    togglePeriodSend,
    periodMs,
    setPeriodMs,
    autoChecksum,
    setAutoChecksum,
    checksumAlgorithm,
    setChecksumAlgorithm,
    totalFrames,
    connection,
    setView,
    quickSends,
    addQuickSend,
    updateQuickSend,
    deleteQuickSend,
    loopingQuick,
    toggleLoopQuickSend,
    loopIntervalMs,
    setLoopIntervalMs,
    currentLoopIndex,
    sendBytes,
    resetCounters,
  } = useStore();

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [quickPanelOpen, setQuickPanelOpen] = useState(true);
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  const link = connection;
  const { protocols, activeProtocolId, setActiveProtocol } = useStore();
  const proto = protocols.find((p) => p.id === activeProtocolId);

  useEffect(() => {
    if (proto) setChecksumAlgorithm(proto.checksum.algorithm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proto?.id]);

  const shown = useMemo(
    () => frames.filter((f) => filter === "all" || f.source === filter),
    [frames, filter],
  );

  // 自动滚屏
  useEffect(() => {
    if (autoScroll && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [shown.length, autoScroll]);

  const isExpanded = (f: Frame) => expanded.has(f.id) || f.id === selectedFrameId;

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hexText = (f: Frame) => (viewMode === "ascii" ? asciiView(f.bytes) : toHex(f.bytes));

  const sendLen = useMemo(() => {
    if (sendMode === "text") {
      let t = sendInput;
      if (sendNewline && !t.endsWith("\r\n")) t += "\r\n";
      return stringToBytes(t, true).length;
    }
    const h = sendInput.replace(/[^0-9a-fA-F]/g, "");
    return Math.floor(h.length / 2) + (sendNewline ? 2 : 0);
  }, [sendInput, sendMode, sendNewline]);

  return (
    <div className="term">
      {/* 顶栏工具栏 */}
      <div className="term-toolbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? "chip active" : "chip"}
            onClick={() => setFilter(f.key)}
          >
            {f.icon && <Icon cp={f.icon} size={12} color={f.color ?? (filter === f.key ? "var(--t1)" : "var(--t2)")} />}
            <span>{f.label}</span>
          </button>
        ))}

        {/* 当前解析协议选择器（用户添加的协议） */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px", background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 6 }}>
          <Icon cp={IC.protocol} size={12} color="var(--accent)" />
          <span style={{ fontSize: 11, color: "var(--t2)", fontWeight: 500 }}>解析协议:</span>
          <select
            className="cell-select"
            style={{ height: 22, fontSize: 11, background: "transparent", border: "none", color: "#fff", fontWeight: 600, outline: "none", cursor: "pointer" }}
            value={activeProtocolId}
            onChange={(e) => setActiveProtocol(e.target.value)}
            title="选择用于串口终端解析与组包的协议（来自我添加的协议）"
          >
            {protocols.map((p) => (
              <option key={p.id} value={p.id} style={{ background: "var(--bg-panel-1)", color: "#fff" }}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <span className="spacer" />

        {/* 视图模式：SSCom 流式控制台 vs 协议表格 */}
        <div style={{ display: "flex", gap: 2, background: "var(--bg-panel-2)", padding: 2, borderRadius: 6 }}>
          <button
            className={termViewMode === "stream" ? "chip active" : "chip"}
            style={{ height: 22, fontSize: 11 }}
            onClick={() => setTermViewMode("stream")}
            title="像 SSCom 一样的平滑连续控制台流式视图"
          >
            <Icon cp={IC.terminal} size={11} color={termViewMode === "stream" ? "var(--accent)" : "var(--t3)"} />
            控制台视图
          </button>
          <button
            className={termViewMode === "table" ? "chip active" : "chip"}
            style={{ height: 22, fontSize: 11 }}
            onClick={() => setTermViewMode("table")}
            title="结构化协议报文表格视图"
          >
            <Icon cp={IC.protocol} size={11} color={termViewMode === "table" ? "var(--accent)" : "var(--t3)"} />
            报文表格
          </button>
        </div>

        {/* 编码切换 HEX / ASCII */}
        {(["hex", "ascii"] as const).map((m) => (
          <button
            key={m}
            className={viewMode === m ? "chip active" : "chip"}
            onClick={() => setViewMode(m)}
          >
            {m === "hex" ? "HEX 接收" : "字符 接收"}
          </button>
        ))}

        {/* 时间戳与自动滚屏 */}
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--t2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showTimestamp}
            onChange={(e) => setShowTimestamp(e.target.checked)}
          />
          时间戳
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--t2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          自动滚屏
        </label>

        {/* 暂停 */}
        <button className="tool-btn" onClick={togglePause} title={paused ? "继续" : "暂停"}>
          <Icon cp={IC.pause} size={13} color={paused ? "var(--amber)" : "var(--t2)"} />
        </button>

        {/* 导出 */}
        <button
          className="tool-btn"
          title="导出日志到文件"
          onClick={() => {
            if (!frames.length) return;
            const lines = frames.map((f) => {
              const text = bytesToString(f.bytes);
              const hex = toHex(f.bytes);
              return `[${f.time}] [${f.dir === "rx" ? "RX" : "TX"}] ${text.trim()} | HEX: ${hex}`;
            });
            download(stampName("serialmind", "log"), lines.join("\n"));
          }}
        >
          <Icon cp={IC.download} size={13} color="var(--t2)" />
        </button>

        {/* 清屏 */}
        <button className="tool-btn" onClick={clearFrames} title="清空接收区">
          <Icon cp={IC.clear} size={13} color="var(--t2)" />
        </button>
      </div>

      {/* 视图渲染区 */}
      {termViewMode === "stream" ? (
        /* SSCom 纯文本连续流式控制台 */
        <div className="stream-console">
          {shown.length === 0 && (
            <div style={{ color: "var(--t4)", textAlign: "center", marginTop: 40 }}>
              {link.connected ? "串口已就绪，等待数据输入或回显..." : "串口未连接，请在顶栏连接串口设备"}
            </div>
          )}
          {shown.map((f) => (
            <div key={f.id} className={`stream-line ${f.dir}`}>
              {showTimestamp && <span className="stream-time">[{f.time}]</span>}
              <span className={`stream-badge ${f.dir}`}>{f.dir === "rx" ? "RX" : "TX"}</span>
              <span className="stream-proto" style={{ fontSize: 10, color: "var(--accent)", padding: "1px 5px", background: "rgba(88,166,255,0.12)", borderRadius: 3, fontWeight: 500, marginRight: 6 }}>
                {f.protocolName || proto?.name || "协议"}
              </span>
              <span className="stream-text">
                {viewMode === "ascii" ? bytesToString(f.bytes) : toHex(f.bytes)}
              </span>
            </div>
          ))}
          <div ref={streamEndRef} />
        </div>
      ) : (
        /* 报文结构化表格视图 */
        <>
          <div className="term-head">
            <span className="c-time">时间</span>
            <span className="c-dir">方向</span>
            <span className="c-no">帧号</span>
            <span style={{ width: 110, fontSize: 11, color: "var(--t3)", padding: "0 6px" }}>所属协议</span>
            <span className="c-src">来源</span>
            <span className="c-hex">报文</span>
            <span className="c-len">长度</span>
          </div>

          <div className="term-list">
            {shown.length === 0 && (
              <div className="empty-state">
                <Icon cp={IC.terminal} size={26} color="var(--t5)" />
                <div className="empty-title">还没有任何报文</div>
              </div>
            )}
            {shown.map((f) => (
              <div key={f.id}>
                <div
                  className={`msg-row${f.id === selectedFrameId ? " selected" : ""}`}
                  onClick={() => {
                    selectFrame(f.id);
                    toggleExpand(f.id);
                  }}
                >
                  <span className="c-time">{f.time}</span>
                  <span className="c-dir">
                    <DirCell dir={f.dir} />
                  </span>
                  <span className="c-no">#{f.no}</span>
                  <span style={{ width: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--accent)", fontSize: 11, padding: "0 6px", fontWeight: 500 }}>
                    {f.protocolName || proto?.name || "—"}
                  </span>
                  <span className="c-src">{SOURCE_LABEL[f.source]}</span>
                  <span className="c-hex hex-cell">{hexText(f)}</span>
                  <span className="c-len">{f.bytes.length}B</span>
                </div>
                {f.fields && isExpanded(f) && (
                  <div className="field-row">
                    <span className="indent" />
                    <span className="branch">
                      <Icon cp={IC.branch} size={13} color="#2a3a4c" />
                    </span>
                    <FieldPairs frame={f} proto={proto} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 底部统计栏 */}
      <div className="term-foot" style={{ display: "flex", alignItems: "center" }}>
        <span>已记录 {shown.length} 帧</span>
        <span style={{ margin: "0 8px", color: "var(--t5)" }}>|</span>
        <button
          className="btn sm"
          style={{ height: 18, fontSize: 10, padding: "0 6px" }}
          onClick={resetCounters}
          title="将 RX / TX 字节计数清零"
        >
          清零计数
        </button>
        <span className="spacer" />
        <button
          className="chip"
          style={{ height: 20, fontSize: 10 }}
          onClick={() => setQuickPanelOpen(!quickPanelOpen)}
        >
          <Icon cp={quickPanelOpen ? IC.chevronDown : IC.chevronRight} size={10} color="var(--accent)" />
          <span>SSCom 多条快捷指令 ({quickSends.length})</span>
        </button>
      </div>

      {/* SSCom 多条快捷指令发送面板 */}
      {quickPanelOpen && (
        <div className="quick-panel">
          <div className="quick-panel-head">
            <span className="quick-panel-title">
              <Icon cp={IC.rule} size={12} color="var(--accent)" />
              多条预设指令
            </span>
            <span className="spacer" />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--t2)" }}>
                <span>轮询间隔</span>
                <input
                  type="number"
                  style={{ width: 55, height: 20, background: "#090d14", border: "1px solid var(--line-2)", color: "#fff", borderRadius: 3, padding: "0 4px", fontSize: 10 }}
                  value={loopIntervalMs}
                  onChange={(e) => setLoopIntervalMs(Number(e.target.value))}
                />
                <span>ms</span>
              </label>
              <button
                className={loopingQuick ? "btn sm danger" : "btn sm"}
                style={{ height: 22, fontSize: 10, background: loopingQuick ? "var(--red)" : "var(--accent)", color: "#fff" }}
                onClick={toggleLoopQuickSend}
              >
                <Icon cp={loopingQuick ? IC.close : IC.play} size={10} color="#fff" />
                <span>{loopingQuick ? "停止轮询" : "循环发送勾选项"}</span>
              </button>
              <button
                className="btn sm"
                style={{ height: 22, fontSize: 10 }}
                onClick={() => addQuickSend()}
              >
                <Icon cp={IC.plus} size={10} color="var(--t2)" />
                添加
              </button>
            </div>
          </div>

          <div className="quick-panel-body">
            {quickSends.map((q, idx) => (
              <div
                key={q.id}
                className={`quick-row${loopingQuick && currentLoopIndex === idx ? " active-loop" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={q.enabled}
                  onChange={(e) => updateQuickSend(q.id, { enabled: e.target.checked })}
                  title="勾选后参与循环轮询发送"
                />
                <button
                  className={`quick-mode-btn ${q.hex ? "hex" : "text"}`}
                  onClick={() => updateQuickSend(q.id, { hex: !q.hex })}
                  title="点击切换 HEX / 字符模式"
                >
                  {q.hex ? "HEX" : "字符"}
                </button>
                <input
                  className="quick-input-content"
                  value={q.content}
                  placeholder={q.hex ? "十六进制数据，如 01 03 00 00 00 02" : "文本数据，如 AT+CSQ (支持 \\r\\n)"}
                  onChange={(e) => updateQuickSend(q.id, { content: e.target.value })}
                />
                <input
                  className="quick-input-note"
                  value={q.note}
                  placeholder="指令备注"
                  onChange={(e) => updateQuickSend(q.id, { note: e.target.value })}
                />
                <button
                  className="quick-send-btn"
                  onClick={() => {
                    let bytes: number[] = [];
                    if (q.hex) {
                      let h = q.content;
                      if (sendNewline) h += " 0D 0A";
                      bytes = parseHex(h);
                    } else {
                      let t = q.content;
                      if (sendNewline && !t.endsWith("\r\n")) t += "\r\n";
                      bytes = stringToBytes(t, true);
                    }
                    if (bytes.length) void sendBytes(bytes, "manual");
                  }}
                >
                  发送
                </button>
                <button
                  className="quick-del-btn"
                  onClick={() => deleteQuickSend(q.id)}
                  title="删除此行"
                >
                  <Icon cp={IC.trash} size={11} color="var(--t4)" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 单条发送主区域（SSCom 级全能输入栏） */}
      <div className="sendbar">
        <div className="send-input-row">
          {/* HEX / 文本 模式切换按钮 */}
          <button
            className={`quick-mode-btn ${sendMode === "hex" ? "hex" : "text"}`}
            style={{ width: 52, height: 26, fontSize: 11, fontWeight: "bold" }}
            onClick={() => setSendMode(sendMode === "hex" ? "text" : "hex")}
            title="点击切换 发送模式（文本或十六进制）"
          >
            {sendMode === "hex" ? "HEX" : "字符"}
          </button>

          {/* 发送输入框 */}
          <input
            className="send-input"
            value={sendInput}
            onChange={(e) => setSendInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendCurrent();
            }}
            placeholder={
              sendMode === "text"
                ? "输入普通文本或 AT 指令（如 AT+CSQ、支持 \\r\\n），回车直接发送"
                : "输入十六进制字节（如 01 03 00 00 00 02），回车发送"
            }
          />

          <span className="send-meta">
            <span>{sendLen} 字节</span>
            <span>·</span>

            {/* 加回车换行勾选框 */}
            <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, cursor: "pointer", color: sendNewline ? "var(--accent)" : "var(--t3)" }}>
              <input
                type="checkbox"
                checked={sendNewline}
                onChange={(e) => setSendNewline(e.target.checked)}
              />
              加\r\n
            </label>

            {/* 发送后清空输入框 */}
            <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, cursor: "pointer", color: clearOnSend ? "var(--accent)" : "var(--t3)" }}>
              <input
                type="checkbox"
                checked={clearOnSend}
                onChange={(e) => setClearOnSend(e.target.checked)}
              />
              清空
            </label>

            {/* 定时周期发送 */}
            <button
              className={periodSend ? "chip active" : "chip"}
              style={{ height: 22, color: periodSend ? "#fff" : undefined, background: periodSend ? "var(--green)" : undefined }}
              onClick={togglePeriodSend}
              title="定时循环发送当前内容"
            >
              <Icon cp={IC.refresh} size={10} color={periodSend ? "#fff" : "var(--t3)"} />
              定时
            </button>
            <input
              type="number"
              style={{ width: 50, height: 20, background: "#090d14", border: "1px solid var(--line-2)", color: "#fff", borderRadius: 3, padding: "0 4px", fontSize: 10 }}
              value={periodMs}
              onChange={(e) => setPeriodMs(Number(e.target.value))}
              title="定时周期 (ms)"
            />
            <span style={{ fontSize: 10 }}>ms</span>

            {/* 自动校验和 */}
            <button
              className={autoChecksum ? "chip active" : "chip"}
              style={{ height: 22 }}
              title="发送时自动在末尾追加校验和"
              onClick={() => setAutoChecksum(!autoChecksum)}
            >
              <Icon cp={IC.check} size={10} color={autoChecksum ? "var(--green)" : "var(--t4)"} />
              自动校验
            </button>
            {autoChecksum && (
              <select
                className="cell-select"
                style={{ height: 22, fontSize: 9, width: 140, border: "1px solid var(--line-2)", borderRadius: 4, background: "var(--bg-panel-2)" }}
                value={checksumAlgorithm}
                onChange={(e) => setChecksumAlgorithm(e.target.value)}
                title="校验算法"
              >
                {ALGORITHM_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((a) => (
                      <option key={a} value={a} title={ALGORITHM_META[a].formula}>
                        {ALGORITHM_META[a].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </span>

          <button
            className="btn-primary"
            style={{ height: 28, padding: "0 14px", fontSize: 12, fontWeight: "bold" }}
            onClick={sendCurrent}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
