import { useEffect, useMemo, useState } from "react";
import { useStore, type Frame, type Source } from "../engine/store";
import { toHex, asciiView } from "../engine/bytes";
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
  // 完全由「当前协议解出的字段」驱动，不写死任何字段名
  const pairs: { k: string; v: string; ok?: boolean }[] = [];
  for (const f of frame.fields ?? []) {
    if (f.field.type === "crc") continue;
    pairs.push({ k: f.field.name, v: `=${f.display}`, ok: f.ok ? undefined : false });
  }
  // 帧和协议都对不上时，校验结论毫无意义，直接说明
  if (frame.matched === false) {
    pairs.length = 0;
    pairs.push({ k: "提示", v: frame.banner ?? "这帧不符合当前协议", ok: false });
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
  // 有校验字段才显示校验结论
  const hasCrc = (frame.fields ?? []).some((f) => f.field.type === "crc");
  if (hasCrc) {
    pairs.push({
      k: proto?.checksum.algorithm ?? "校验",
      v: frame.crcOk ? "校验通过" : `校验失败（期望 ${frame.crcExpected}，实际 ${frame.crcActual}）`,
      ok: frame.crcOk,
    });
  }
  if (frame.banner) pairs.push({ k: "提示", v: frame.banner, ok: false });
  if (!pairs.length) pairs.push({ k: "原始", v: `${frame.bytes.length} 字节（未解析）` });
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
    paused,
    togglePause,
    clearFrames,
    selectedFrameId,
    selectFrame,
    sendInput,
    setSendInput,
    sendCurrent,
    autoChecksum,
    setAutoChecksum,
    checksumAlgorithm,
    setChecksumAlgorithm,
    totalFrames,
    connection,
    setView,
  } = useStore();

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const link = connection;

  const firstWithFields = frames.find((f) => f.fields)?.id;

  // 快捷发送：按当前协议的真实报文生成（一个报文一个按钮）
  const { protocols, activeProtocolId } = useStore();
  const proto = protocols.find((p) => p.id === activeProtocolId);
  // 切协议时把自动校验算法同步成协议的算法
  useEffect(() => {
    if (proto) setChecksumAlgorithm(proto.checksum.algorithm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proto?.id]);

  const quickSends = proto
    ? proto.messages
        .filter((m) => m.fields.length > 0)
        .map((m) => ({
          label: m.name,
          run: async () => {
            const { encodeMessage } = await import("../engine/codec");
            await useStore.getState().sendBytes(encodeMessage(proto, m, {}), "manual");
          },
        }))
    : [];

  const shown = useMemo(
    () => frames.filter((f) => filter === "all" || f.source === filter),
    [frames, filter],
  );

  const isExpanded = (f: Frame) =>
    expanded.has(f.id) || f.id === selectedFrameId || f.id === firstWithFields;

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hexText = (f: Frame) => (viewMode === "ascii" ? asciiView(f.bytes) : toHex(f.bytes));
  const sendBytes = sendInput.replace(/[^0-9a-fA-F]/g, "");
  const sendLen = Math.floor(sendBytes.length / 2);

  return (
    <div className="term">
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
        <span className="spacer" />
        <span
          className={proto ? "pill blue" : "pill gray"}
          title={proto ? `按协议「${proto.name}」解析收发帧` : "没有选中协议，按原始字节显示"}
          style={{ height: 20, cursor: "pointer" }}
          onClick={() => setView("protocol")}
        >
          解析协议：{proto ? `${proto.name} ${proto.version}` : "原始字节"}
        </span>
        {(["hex", "ascii", "field"] as const).map((m) => (
          <button key={m} className={viewMode === m ? "chip active" : "chip"} onClick={() => setViewMode(m)}>
            {m === "hex" ? "HEX" : m === "ascii" ? "ASCII" : "字段"}
          </button>
        ))}
        <button className="tool-btn" onClick={togglePause} title={paused ? "继续" : "暂停"}>
          <Icon cp={IC.pause} size={13} color={paused ? "var(--amber)" : "var(--t2)"} />
        </button>
        <button
          className="tool-btn"
          title="保存日志到文件（带时间戳）"
          onClick={() => {
            if (!frames.length) return;
            const lines = frames.map((f) => {
              const decoded = (f.fields ?? []).filter((x) => x.field.type !== "crc");
              const sum = decoded.length ? decoded.map((x) => `${x.field.name}=${x.display}`).join(" ") : "（未解析）";
              const hasCrc = (f.fields ?? []).some((x) => x.field.type === "crc");
              const crc = !hasCrc
                ? "—"
                : f.matched === false
                  ? "不符合协议"
                  : f.crcOk
                    ? "校验OK"
                    : `校验错(期望${f.crcExpected}/实际${f.crcActual})`;
              return `${f.time}\t${f.dir === "rx" ? "RX" : "TX"}\t#${f.no}\t${f.bytes.length}B\t${toHex(f.bytes)}\t${crc}\t${sum}`;
            });
            const head = [
              `SerialMind 串口日志`,
              `导出时间：${new Date().toLocaleString()}`,
              `端口：${connection.port || "—"} ${connection.baud} ${connection.frame}`,
              `协议：${proto ? proto.name : "原始字节"}`,
              `帧数：${frames.length}（RX ${frames.filter((f) => f.dir === "rx").length} / TX ${frames.filter((f) => f.dir === "tx").length}）`,
              "".padEnd(80, "-"),
              "时间\t方向\t帧号\t长度\t报文(HEX)\t校验\t字段",
            ].join("\n");
            download(stampName("serialmind", "log"), head + "\n" + lines.join("\n"));
          }}
        >
          <Icon cp={IC.download} size={13} color="var(--t2)" />
        </button>
        <button className="tool-btn" onClick={clearFrames} title="清空">
          <Icon cp={IC.clear} size={13} color="var(--t2)" />
        </button>
        </div>

      <div className="term-head">
        <span className="c-time">时间</span>
        <span className="c-dir">方向</span>
        <span className="c-no">帧号</span>
        <span className="c-src">来源</span>
        <span className="c-hex">报文</span>
        <span className="c-len">长度</span>
      </div>

      <div className="term-list">
        {shown.length === 0 && (
          <div className="empty-state">
            <Icon cp={IC.terminal} size={26} color="var(--t5)" />
            <div className="empty-title">还没有任何报文</div>
            <div className="empty-desc">
              {link
                ? link.connected
                  ? "链路已连接，等待设备回包；或在下方输入框发送一帧"
                  : `串口 ${link.port || "未选择"} 未连接 —— 点顶栏串口处选择并连接`
                : "先在顶栏选择一个串口并连接"}
            </div>
            <div className="row gap-8" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => useStore.getState().setView("terminal")}>
                <Icon cp={IC.link} size={11} color="var(--t2)" />
                连接串口
              </button>
              <button className="btn" onClick={() => setView("protocol")}>
                <Icon cp={IC.protocol} size={11} color="var(--t2)" />
                配置协议
              </button>
            </div>
          </div>
        )}
        {shown.map((f) => (
          <div key={f.id}>
            {f.banner && (
              <div className="case-banner">
                <Icon cp={IC.useCase} size={11} color="#9db6e8" />
                <span>{f.banner}</span>
              </div>
            )}
            <div
              className={`msg-row${f.id === selectedFrameId ? " selected" : ""}${!f.crcOk && f.matched !== false ? " error" : ""}`}
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
              <span className="c-src">{SOURCE_LABEL[f.source]}</span>
              <span className="c-hex hex-cell">{hexText(f)}</span>
              <span className="c-len">{f.bytes.length}B</span>
            </div>
            {f.matched === false && (
              <div className="err-banner warn-only">
                <Icon cp={IC.warn} size={11} color="var(--amber)" />
                <span className="title">不符合当前协议</span>
                <span className="detail">{f.banner ?? "长度或帧头对不上，按原始字节显示"}</span>
              </div>
            )}
            {!f.crcOk && f.matched !== false && (
              <div className="err-banner">
                <Icon cp={IC.warn} size={11} color="var(--red)" />
                <span className="title">CRC 校验失败</span>
                <span className="detail">
                  期望 {f.crcExpected} · 实际 {f.crcActual}
                  {f.diffBytes?.length ? ` · 差异字节 #${f.diffBytes.join(" #")}` : ""}
                </span>
              </div>
            )}
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

      <div className="term-foot">
        已显示 {shown.length} / {totalFrames.toLocaleString("en-US")} 帧 · 虚拟滚动已开启
      </div>

      <div className="sendbar">
        <div className="send-input-row">
          <span className="send-mode">HEX</span>
          <input
            className="send-input"
            value={sendInput}
            onChange={(e) => setSendInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendCurrent();
            }}
            placeholder="输入要发送的十六进制字节，回车发送"
          />
          <span className="send-meta">
            <span>{sendLen} 字节</span>
            <span>·</span>
            <button
              className={autoChecksum ? "chip active" : "chip"}
              style={{ height: 20 }}
              title="发送时自动在末尾追加校验和（不要求协议里配了校验字段）"
              onClick={() => setAutoChecksum(!autoChecksum)}
            >
              <Icon cp={IC.check} size={10} color={autoChecksum ? "var(--green)" : "var(--t4)"} />
              自动校验
            </button>
            {autoChecksum && (
              <select
                className="cell-select"
                style={{ height: 20, fontSize: 9, width: 150, border: "1px solid var(--line-2)", borderRadius: 4, background: "var(--bg-panel-2)" }}
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
          <button className="btn-primary" style={{ height: 24, padding: "0 10px", fontSize: 11 }} onClick={sendCurrent}>
            发送
          </button>
        </div>
        {quickSends.length > 0 && (
          <div className="quick-send">
            {quickSends.map((q) => (
              <span key={q.label} className="qs-item primary" onClick={() => void q.run()}>
                {q.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}