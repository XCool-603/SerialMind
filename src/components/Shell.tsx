import { useState } from "react";
import { useStore, type ViewKey } from "../engine/store";
import { getStorageError, getStorageMode } from "../engine/db";
import { HelpModal } from "./HelpModal";
import { healthState } from "../engine/health";
import { Icon, IC } from "./Icon";

/* ================= 顶栏 ================= */

const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000, 2000000];

function Sparkline() {
  const cyan = "2,16 10,12 18,14 26,7 34,10 42,4 50,8 58,3 66,6 70,5";
  const green = "2,18 10,17 18,15 26,16 34,13 42,14 50,11 58,13 66,10 70,12";
  return (
    <div className="spark">
      <svg width="70" height="10" viewBox="0 0 72 20">
        <polyline points={cyan} fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg width="70" height="7" viewBox="0 0 72 20">
        <polyline points={green} fill="none" stroke="var(--green)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function TopBar() {
  const {
    products,
    activeProductId,
    subProducts,
    connection,
    availablePorts,
    frames,
    rxCount,
    txCount,
    autoSend,
    aiLevel,
    toggleAutoSend,
    switchProduct,
    refreshPorts,
    connectPort,
    disconnectPort,
    setView,
    setSerialParam,
    health,
  } = useStore();

  const hs = healthState(health);
  const [productMenu, setProductMenu] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [portMenu, setPortMenu] = useState(false);
  const [baud, setBaud] = useState(connection.baud);

  const active = products.find((p) => p.id === activeProductId) ?? products[0];
  const fmt = (n: number) => n.toLocaleString("en-US");
  const frameRate = frames.filter((f) => Date.now() - f.ts < 1000).length;

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-logo">SM</div>
        <div className="brand-name">SerialMind</div>
      </div>
      <div className="topbar-sep" />

      {/* 产品切换 */}
      <div style={{ position: "relative" }}>
        <button className="product-switch" onClick={() => setProductMenu((v) => !v)}>
          <Icon cp={IC.product} size={15} color="var(--accent)" />
          <span className="product-name">{active?.name ?? "未命名产品"}</span>
          <span className="badge-count">{subProducts.length} 子产品</span>
          <Icon cp={IC.chevronDown} size={15} color="var(--t2)" />
        </button>
        {productMenu && (
          <>
            <div className="menu-mask" onClick={() => setProductMenu(false)} />
            <div className="menu">
              <div className="menu-title">产品（{products.length}）</div>
              {products.map((p) => (
                <button
                  key={p.id}
                  className={p.id === activeProductId ? "menu-item active" : "menu-item"}
                  onClick={() => {
                    switchProduct(p.id);
                    setProductMenu(false);
                  }}
                >
                  <Icon cp={IC.product} size={11} color={p.id === activeProductId ? "var(--accent)" : "var(--t4)"} />
                  <span>{p.name}</span>
                  {p.id === activeProductId && <Icon cp={IC.check} size={11} color="var(--accent)" style={{ marginLeft: "auto" }} />}
                </button>
              ))}
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  setProductMenu(false);
                  void import("../lib/actions").then((m) => m.newProduct());
                }}
              >
                <Icon cp={IC.plus} size={11} color="var(--t2)" />
                <span>新建产品</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setProductMenu(false);
                  if (active) void import("../lib/actions").then((m) => m.renameProduct(active));
                }}
              >
                <Icon cp={IC.edit} size={11} color="var(--t2)" />
                <span>重命名</span>
              </button>
              <button
                className="menu-item danger"
                onClick={() => {
                  setProductMenu(false);
                  if (active) void import("../lib/actions").then((m) => m.deleteProduct(active));
                }}
              >
                <Icon cp={IC.trash} size={11} color="var(--red)" />
                <span>删除产品</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 串口直接控制栏（SSCom直观体验：端口+波特率+一键开关+参数） */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <select
          className="cell-select"
          style={{ height: 26, fontSize: 11, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", color: "var(--t1)", borderRadius: 4, padding: "0 6px", fontWeight: 600, maxWidth: 160 }}
          value={connection.port}
          onFocus={() => void refreshPorts()}
          onChange={(e) => {
            useStore.setState((s) => ({ connection: { ...s.connection, port: e.target.value } }));
          }}
          disabled={connection.connected}
          title="选择串口设备"
        >
          {availablePorts.length === 0 && <option value="">未检测到串口</option>}
          {availablePorts.map((p) => (
            <option key={p.name} value={p.name}>{p.name} {p.detail ? `(${p.detail})` : ""}</option>
          ))}
          <option value="__mock__">模拟设备 (回环测试)</option>
        </select>

        <select
          className="cell-select"
          style={{ height: 26, fontSize: 11, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", color: "var(--t1)", borderRadius: 4, padding: "0 6px", width: 85 }}
          value={baud}
          onChange={(e) => {
            const b = Number(e.target.value);
            setBaud(b);
            useStore.setState((s) => ({ connection: { ...s.connection, baud: b } }));
          }}
          disabled={connection.connected}
          title="波特率"
        >
          {BAUD_OPTIONS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        {connection.connected ? (
          <button
            className="btn"
            style={{ height: 26, padding: "0 12px", fontSize: 11, background: "var(--red)", borderColor: "var(--red)", color: "#fff", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}
            onClick={() => void disconnectPort()}
            title="点击关闭当前串口"
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
            <span>关闭串口</span>
          </button>
        ) : (
          <button
            className="btn-primary"
            style={{ height: 26, padding: "0 12px", fontSize: 11, background: "var(--green)", borderColor: "var(--green)", color: "#fff", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}
            onClick={() => void connectPort(connection.port || availablePorts[0]?.name, baud)}
            title="点击打开选中的串口"
          >
            <Icon cp={IC.play} size={10} color="#fff" />
            <span>打开串口</span>
          </button>
        )}

        <div style={{ position: "relative" }}>
          <button
            className="btn sm"
            style={{ height: 26, fontSize: 10, padding: "0 6px", color: "var(--t3)" }}
            onClick={() => setPortMenu((v) => !v)}
            title="数据位 / 校验位 / 停止位 / 流控 高级设置"
          >
            <span>{connection.frame}</span>
            <Icon cp={IC.settings} size={10} color="var(--t4)" />
          </button>

          {portMenu && (
            <>
              <div className="menu-mask" onClick={() => setPortMenu(false)} />
              <div className="menu" style={{ minWidth: 260, right: 0, left: "auto" }}>
                <div className="menu-title" style={{ display: "flex", alignItems: "center" }}>
                  <span>串口参数</span>
                  <button
                    className="btn sm"
                    style={{ marginLeft: "auto" }}
                    onClick={() => void refreshPorts()}
                  >
                    <Icon cp={IC.refresh} size={10} color="var(--t2)" />
                    刷新串口
                  </button>
                </div>
                <div className="menu-sep" />
                <div className="menu-title">数据位 / 校验 / 停止位</div>
                <div style={{ display: "flex", gap: 4, padding: "0 8px 6px", flexWrap: "wrap" }}>
                  {(["8N1", "8E1", "7E1", "8O1", "7N2"] as const).map((preset) => (
                    <button
                      key={preset}
                      className={connection.frame === preset ? "alg-chip active" : "alg-chip"}
                      onClick={() => {
                        const db = Number(preset[0]);
                        const par = preset[1] === "E" ? "even" : preset[1] === "O" ? "odd" : "none";
                        const sb = Number(preset[2]);
                        setSerialParam({ dataBits: db, parity: par, stopBits: sb });
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 8px 6px" }}>
                  <select
                    className="cell-select"
                    style={{ height: 22, fontSize: 10, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 4 }}
                    value={connection.dataBits}
                    onChange={(e) => setSerialParam({ dataBits: Number(e.target.value) })}
                  >
                    {[5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>数据位 {n}</option>
                    ))}
                  </select>
                  <select
                    className="cell-select"
                    style={{ height: 22, fontSize: 10, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 4 }}
                    value={connection.parity}
                    onChange={(e) => setSerialParam({ parity: e.target.value as "none" | "odd" | "even" })}
                  >
                    <option value="none">无校验 N</option>
                    <option value="odd">奇校验 O</option>
                    <option value="even">偶校验 E</option>
                  </select>
                  <select
                    className="cell-select"
                    style={{ height: 22, fontSize: 10, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 4 }}
                    value={connection.stopBits}
                    onChange={(e) => setSerialParam({ stopBits: Number(e.target.value) })}
                  >
                    <option value={1}>停止位 1</option>
                    <option value={2}>停止位 2</option>
                  </select>
                  <select
                    className="cell-select"
                    style={{ height: 22, fontSize: 10, background: "var(--bg-panel-2)", border: "1px solid var(--line-2)", borderRadius: 4 }}
                    value={connection.flowControl}
                    onChange={(e) => setSerialParam({ flowControl: e.target.value as "none" | "hardware" | "software" })}
                  >
                    <option value="none">无流控</option>
                    <option value="hardware">硬件流控</option>
                    <option value="software">软件流控</option>
                  </select>
                </div>
                <div style={{ fontSize: 9, color: "var(--t4)", padding: "0 10px 6px" }}>
                  当前：{connection.frame} · 参数自动记忆
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="topbar-mid">
        <div className="counter" title="已接收字节数">
          <Icon cp={IC.arrowRight} size={13} color="var(--green)" />
          <span className="counter-label">RX</span>
          <span className="counter-value">{fmt(rxCount)}</span>
        </div>
        <div className="counter" title="已发送字节数">
          <Icon cp={IC.arrowLeft} size={13} color="var(--cyan)" />
          <span className="counter-label">TX</span>
          <span className="counter-value">{fmt(txCount)}</span>
        </div>
        <button
          className="icon-btn"
          style={{ width: 20, height: 20, padding: 0 }}
          onClick={() => useStore.getState().resetCounters()}
          title="重置 RX/TX 计数器为 0"
        >
          <Icon cp={IC.refresh} size={10} color="var(--t4)" />
        </button>
        <Sparkline />
        <span className="rate">{frameRate} 帧/s</span>
      </div>

      <div className="topbar-actions">
        <button
          className="ai-switch"
          style={{ background: "rgba(168,85,247,0.15)", borderColor: "rgba(168,85,247,0.4)" }}
          onClick={() => useStore.getState().toggleAi()}
          title="点击打开 AI 智能设计中心（支持 DeepSeek 生成协议/测试用例/整套产品）"
        >
          <Icon cp={IC.ai} size={14} color="var(--purple)" />
          <span className="ai-switch-label" style={{ color: "#d8b4fe", fontWeight: 600 }}>✨ AI 助手 (DeepSeek)</span>
        </button>

        <button className="btn-primary" onClick={() => void useStore.getState().runActiveCase()}>
          <Icon cp={IC.play} size={14} color="#fff" />
          <span>运行当前用例</span>
        </button>

        <button className="icon-btn" title="帮助 / 关于" onClick={() => setHelpOpen(true)}>
          <span style={{ fontSize: 13, color: "var(--t2)", fontWeight: 600 }}>?</span>
        </button>
        <button className="icon-btn" title={health ? `上次验收 ${health.pass}/${health.total}${hs === "ok" ? " 通过" : " 有失败项"} · ${health.at}` : "自检 / 验收（不需要硬件）"} onClick={() => useStore.getState().setShowSelfTest(true)} style={{ position: "relative" }}>
          <Icon cp={IC.settings} size={15} color="var(--t2)" />{hs !== "none" && (<span className="health-dot" data-state={hs} style={{ position: "absolute", right: 4, top: 4, width: 6, height: 6, borderRadius: "50%", background: hs === "ok" ? "var(--green)" : hs === "bad" ? "var(--red)" : "#eab308" }} />)}
        </button>
      </div>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </header>
  );
}

/* ================= 视图页签 ================= */

const TABS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "terminal", label: "终端", icon: IC.terminal },
  { key: "protocol", label: "协议", icon: IC.protocol },
  { key: "case", label: "测试", icon: IC.case },
  { key: "report", label: "报告", icon: IC.report },
];

export function TabBar() {
  const { activeView, setView } = useStore();
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button key={t.key} className={activeView === t.key ? "tab active" : "tab"} onClick={() => { setView(t.key); if (t.key === "case") useStore.getState().setCaseTab("cases"); }}>
          <Icon cp={t.icon} size={14} color={activeView === t.key ? "var(--t1)" : "var(--t3)"} />
          <span className="label">{t.label}</span>
        </button>
      ))}
      <div className="tabbar-right">
        </div>
    </nav>
  );
}

/* ================= 左侧：产品 → 子产品 → 角色/协议/规则/用例 ================= */

type CtxItem = { label: string; danger?: boolean; onClick: () => void };
type Ctx = { x: number; y: number; items: CtxItem[] } | null;

export function Sidebar() {
  const {
    products,
    activeProductId,
    subProducts,
    activeSubProductId,
    roles,
    protocols,
    cases,
    activeRoleId,
    activeProtocolId,
    activeCaseId,
    setActiveRole,
    setActiveProtocol,
    setActiveCase,
    setActiveSubProduct,
    setView,
    activeView,
  } = useStore();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [ctx, setCtx] = useState<Ctx>(null);
  const [dragItem, setDragItem] = useState<{ kind: string; id: string } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const moveNode = useStore((s) => s.moveNode);

  /** 树节点拖拽：同类型之间可换位置 */
  const dnd = (kind: "subProduct" | "role" | "case" | "protocol", id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      setDragItem({ kind, id });
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", id);
      } catch {
        /* noop */
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragItem || dragItem.kind !== kind || dragItem.id === id) return;
      e.preventDefault();
      e.stopPropagation();
      setOverId(id);
    },
    onDragLeave: () => setOverId((cur) => (cur === id ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragItem && dragItem.kind === kind && dragItem.id !== id) moveNode(kind, dragItem.id, id);
      setDragItem(null);
      setOverId(null);
    },
    onDragEnd: () => {
      setDragItem(null);
      setOverId(null);
    },
  });
  const dropCls = (id: string) => (overId === id ? " drag-over" : "");

  /** 右键「上移/下移」：找邻居再 moveNode */
  const shift = (kind: "case" | "protocol", id: string, dir: -1 | 1) => {
    const s = useStore.getState();
    const all = kind === "case" ? s.cases : s.protocols;
    const i = all.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    moveNode(kind, id, all[j].id);
  };
  const toggle = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  const isCollapsed = (k: string) => !!collapsed[k];

  const openCtx = (e: React.MouseEvent, items: CtxItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const actionBtn = (items: CtxItem[]) => (
    <button
      className="tree-add"
      title="更多"
      onClick={(e) => {
        e.stopPropagation();
        openCtx(e, items);
      }}
    >
      <Icon cp={IC.more} size={11} color="var(--t4)" />
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">串口自动化工作空间</span>
        <button
          className="add-btn"
          title="新建"
          onClick={(e) =>
            openCtx(e, [
              { label: "新建通信协议", onClick: () => void import("../lib/actions").then((m) => m.newProtocol()) },
              { label: "新建自动化用例", onClick: () => void import("../lib/actions").then((m) => m.newCase()) },
            ])
          }
        >
          <Icon cp={IC.plus} size={13} color="var(--t2)" />
        </button>
      </div>

      <div className="tree" style={{ padding: "6px 0" }}>
        {/* 1. 通信协议列表 */}
        <div className="tree-group" onClick={() => toggle("protocols")}>
          <Icon cp={IC.chevronDown} size={12} color="var(--t3)" style={{ transform: isCollapsed("protocols") ? "rotate(-90deg)" : "none" }} />
          <Icon cp={IC.protocol} size={13} color="var(--accent)" />
          <span className="label" style={{ fontWeight: 600 }}>通信协议</span>
          <span className="tree-count">{protocols.length}</span>
          <span className="spacer" />
          <button
            className="tree-add"
            title="新建通信协议"
            onClick={(e) => {
              e.stopPropagation();
              void import("../lib/actions").then((m) => m.newProtocol());
            }}
          >
            <Icon cp={IC.plus} size={11} color="var(--t4)" />
          </button>
        </div>

        {!isCollapsed("protocols") && (
          <div className="tree-children">
            {protocols.length === 0 && (
              <div
                className="tree-empty"
                onClick={() => void import("../lib/actions").then((m) => m.newProtocol())}
              >
                + 点此添加通信协议
              </div>
            )}
            {protocols.map((pr) => (
              <div
                key={pr.id}
                className={`tree-item indent-1${pr.id === activeProtocolId && activeView === "protocol" ? " active" : ""}${dropCls(pr.id)}`}
                {...dnd("protocol", pr.id)}
                onClick={() => {
                  setActiveProtocol(pr.id);
                  setView("protocol");
                }}
                onContextMenu={(e) =>
                  openCtx(e, [
                    { label: "在终端发送", onClick: () => { setActiveProtocol(pr.id); void useStore.getState().sendProtocol(pr.id); } },
                    { label: "重命名协议", onClick: () => void import("../lib/actions").then((m) => m.renameProtocol(pr.id, pr.name)) },
                    { label: "复制协议", onClick: () => { setActiveProtocol(pr.id); useStore.getState().duplicateProtocol(); } },
                    { label: "上移", onClick: () => shift("protocol", pr.id, -1) },
                    { label: "下移", onClick: () => shift("protocol", pr.id, 1) },
                    { label: "删除协议", danger: true, onClick: () => void import("../lib/actions").then((m) => m.deleteProtocol(pr.id, pr.name)) },
                  ])
                }
              >
                <Icon cp={IC.protocolDoc} size={12} color={pr.id === activeProtocolId && activeView === "protocol" ? "var(--accent)" : "var(--t4)"} />
                <span className="label">{pr.name}</span>
                <span className="tag-mini">{pr.messages[0]?.fields.length ?? 0} 字段</span>
                <span className="spacer" />
                <button
                  className="tree-add tree-send"
                  title="直接在终端发送此协议数据帧"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveProtocol(pr.id);
                    void useStore.getState().sendProtocol(pr.id);
                  }}
                >
                  <Icon cp={IC.arrowLeft} size={11} color="var(--green)" />
                </button>
                {actionBtn([
                  { label: "在终端发送", onClick: () => { setActiveProtocol(pr.id); void useStore.getState().sendProtocol(pr.id); } },
                  { label: "重命名协议", onClick: () => void import("../lib/actions").then((m) => m.renameProtocol(pr.id, pr.name)) },
                  { label: "复制协议", onClick: () => { setActiveProtocol(pr.id); useStore.getState().duplicateProtocol(); } },
                  { label: "上移", onClick: () => shift("protocol", pr.id, -1) },
                  { label: "下移", onClick: () => shift("protocol", pr.id, 1) },
                  { label: "删除协议", danger: true, onClick: () => void import("../lib/actions").then((m) => m.deleteProtocol(pr.id, pr.name)) },
                ])}
              </div>
            ))}
          </div>
        )}

        {/* 2. 自动化测试列表 */}
        <div className="tree-group" style={{ marginTop: 10 }} onClick={() => toggle("cases")}>
          <Icon cp={IC.chevronDown} size={12} color="var(--t3)" style={{ transform: isCollapsed("cases") ? "rotate(-90deg)" : "none" }} />
          <Icon cp={IC.case} size={13} color="var(--green)" />
          <span className="label" style={{ fontWeight: 600 }}>自动化测试</span>
          <span className="tree-count">{cases.length}</span>
          <span className="spacer" />
          <button
            className="tree-add"
            title="新建自动化用例"
            onClick={(e) => {
              e.stopPropagation();
              void import("../lib/actions").then((m) => m.newCase());
            }}
          >
            <Icon cp={IC.plus} size={11} color="var(--t4)" />
          </button>
        </div>

        {!isCollapsed("cases") && (
          <div className="tree-children">
            {cases.length === 0 && (
              <div
                className="tree-empty"
                onClick={() => void import("../lib/actions").then((m) => m.newCase())}
              >
                + 点此新建第一个自动化用例
              </div>
            )}
            {cases.map((c) => (
              <div
                key={c.id}
                className={`tree-item indent-1${c.id === activeCaseId && activeView === "case" ? " active" : ""}${dropCls(c.id)}`}
                {...dnd("case", c.id)}
                onClick={() => {
                  setActiveCase(c.id);
                  setView("case");
                }}
                onContextMenu={(e) =>
                  openCtx(e, [
                    { label: "运行用例", onClick: () => { setActiveCase(c.id); void useStore.getState().runActiveCase(); } },
                    { label: "重命名用例", onClick: () => void import("../lib/actions").then((m) => m.renameCase(c)) },
                    { label: "复制用例", onClick: () => useStore.getState().duplicateCase(c.id) },
                    { label: "上移", onClick: () => shift("case", c.id, -1) },
                    { label: "下移", onClick: () => shift("case", c.id, 1) },
                    { label: "删除用例", danger: true, onClick: () => void import("../lib/actions").then((m) => m.deleteCase(c)) },
                  ])
                }
              >
                <Icon
                  cp={c.status === "passed" ? IC.check : c.status === "failed" ? IC.error : IC.case}
                  size={12}
                  color={c.status === "passed" ? "var(--green)" : c.status === "failed" ? "var(--red)" : "var(--t4)"}
                />
                <span className="label">{c.name}</span>
                <span className="tag-mini">{c.actions?.length ?? 1} 任务</span>
                <span className="spacer" />
                <button
                  className="tree-add tree-send"
                  title="运行这个自动化用例"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveCase(c.id);
                    setView("case");
                    void useStore.getState().runActiveCase();
                  }}
                >
                  <Icon cp={IC.play} size={10} color="var(--green)" />
                </button>
                {actionBtn([
                  { label: "运行用例", onClick: () => { setActiveCase(c.id); void useStore.getState().runActiveCase(); } },
                  { label: "重命名用例", onClick: () => void import("../lib/actions").then((m) => m.renameCase(c)) },
                  { label: "复制用例", onClick: () => useStore.getState().duplicateCase(c.id) },
                  { label: "上移", onClick: () => shift("case", c.id, -1) },
                  { label: "下移", onClick: () => shift("case", c.id, 1) },
                  { label: "删除用例", danger: true, onClick: () => void import("../lib/actions").then((m) => m.deleteCase(c)) },
                ])}
              </div>
            ))}
          </div>
        )}
      </div>

      {ctx && (
        <>
          <div
            className="menu-mask"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <div className="menu ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
            {ctx.items.map((it, i) => (
              <button
                key={i}
                className={it.danger ? "menu-item danger" : "menu-item"}
                onClick={() => {
                  setCtx(null);
                  it.onClick();
                }}
              >
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

/* ================= 状态栏 ================= */

export function StatusBar() {
  const { connection, dbStatus, dbError, serialMsg, frames, subProducts, activeSubProductId, openDialog, resetDatabase } = useStore();
  const mode = getStorageMode();
  const modeLabel = mode === "idb" ? "SQLite 已保存" : mode === "ls" ? "SQLite 已保存（localStorage）" : "SQLite 仅内存";
  const dbLabel = dbStatus === "ready" ? modeLabel : dbStatus === "error" ? "SQLite 异常" : "SQLite 载入中…";
  const sp = subProducts.find((x) => x.id === activeSubProductId);
  return (
    <footer className="statusbar">
      <span className={connection.connected ? "dot on" : "dot off"} />
      <span>
        {connection.port === "__mock__" ? "模拟设备" : connection.port || "未选择串口"} {connection.connected ? "已连接" : "未连接"}
        {connection.port ? ` · ${connection.baud} ${connection.frame}` : ""}
      </span>
      <span>·</span>
      <span>缓冲 {frames.length} / 2,000</span>
      <span>·</span>
      <span
        style={{
          color: dbStatus === "error" ? "var(--red)" : dbStatus === "ready" ? "var(--green)" : "var(--t3)",
          cursor: dbStatus === "error" ? "pointer" : "default",
          textDecoration: dbStatus === "error" ? "underline" : "none",
        }}
        title={dbStatus === "error" ? `${dbError}\n点击重置本地数据库` : ""}
        onClick={() => {
          if (dbStatus !== "error") return;
          openDialog({
            kind: "confirm",
            title: "数据库异常",
            desc: `错误：${dbError || "未知"}\n\n可以清空本地数据库重新开始（已保存的产品/协议会丢失）。`,
            danger: true,
            okText: "清空并重启",
            onOk: () => void resetDatabase(),
          });
        }}
      >
        {dbLabel}
        {dbStatus === "error" ? "（点击重置）" : ""}
      </span>
      <span style={{ color: "var(--t4)" }} className="ellipsis">
        {sp ? `当前子产品：${sp.name}` : "未选择子产品"} · {serialMsg}
      </span>
      <span className="right">
        <span>RX {frames.filter((f) => f.dir === "rx").length} · TX {frames.filter((f) => f.dir === "tx").length}</span>
      </span>
    </footer>
  );
}