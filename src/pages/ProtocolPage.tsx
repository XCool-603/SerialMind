import { useEffect, useMemo, useState } from "react";
import { useStore } from "../engine/store";
import { Icon, IC } from "../components/Icon";
import { EmptyState } from "../components/Empty";
import { ProtocolDebug } from "./ProtocolDebug";
import { parseHex, toHex, type ByteOrder } from "../engine/bytes";
import { messageLength, type PdlField, type PdlMessage, type PdlProtocol } from "../engine/pdl";
import { detectChecksum, roundTrip } from "../engine/codec";
import {
  ALGORITHM_GROUPS,
  ALGORITHM_META,
  CHECKSUM_ALGORITHMS,
  type ChecksumAlgorithm,
} from "../engine/crc";

/** 真正支持编解码的字段类型（array/tlv/nested 等未实现，不放进选项） */
const TYPE_OPTIONS: PdlField["type"][] = [
  "uint",
  "int",
  "float",
  "bcd",
  "bool",
  "bitfield",
  "enum",
  "bytes",
  "string",
  "crc",
];

const FRAMING_MODES: { key: PdlProtocol["framing"]["mode"]; label: string; hint: string }[] = [
  { key: "silence-gap", label: "静默间隔", hint: "按字节间隔断帧（最常见的私有协议）" },
  { key: "fixed", label: "定长", hint: "每帧字节数固定" },
  { key: "delimiter", label: "分隔符", hint: "用帧尾字节断帧，如 0D 0A" },
  { key: "length-field", label: "长度字段", hint: "帧内有长度字节" },
  { key: "script", label: "脚本", hint: "自定义分帧逻辑" },
];

/**
 * 按顺序重算 offset。
 * 规则：
 *  - 校验字段（crc）**永远排到最后**，保证 sum/CRC 在帧尾
 *  - 带偏移表达式（如 len - 1）的字段位置由表达式决定
 */
function recalc(fields: PdlField[]): PdlField[] {
  const ordered = [...fields.filter((f) => f.type !== "crc"), ...fields.filter((f) => f.type === "crc")];
  let off = 0;
  return ordered.map((f) => {
    if (f.offset < 0) return f;
    if (f.offsetExpr) return { ...f };
    const next = { ...f, offset: off };
    off += Math.max(0, f.size);
    return next;
  });
}

function cloneMessages(msgs: PdlMessage[]): PdlMessage[] {
  return msgs.map((m) => ({ ...m, fields: m.fields.map((f) => ({ ...f })) }));
}

/** 枚举文本 → 映射（默认十六进制；d 前缀为十进制） */
function textToEnum(text?: string): Record<number, string> | undefined {
  if (!text || !text.trim()) return undefined;
  const out: Record<number, string> = {};
  for (const seg of text.split(/[,，;\n]+/)) {
    const m = seg.trim().match(/^(d\d+|0x[0-9a-fA-F]+|[0-9a-fA-F]{1,4})\s*[=:：]\s*(.+)$/i);
    if (!m) continue;
    const raw = m[1];
    const key = /^d\d+$/i.test(raw) ? Number(raw.slice(1)) : parseInt(raw.replace(/^0x/i, ""), 16);
    if (Number.isFinite(key)) out[key] = m[2].trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function enumToText(map?: Record<number, string>): string {
  if (!map) return "";
  return Object.entries(map)
    .map(([k, v]) => `${Number(k).toString(16).toUpperCase()}=${v}`)
    .join(", ");
}

export function ProtocolPage() {
  const {
    protocols,
    activeProtocolId,
    subProducts,
    activeSubProductId,
    updateProtocol,
    deleteProtocol,
    duplicateProtocol,
    openDialog,
    setView,
    forceSaveSeq,
    setRoundTripFailed,
  } = useStore();

  const active = protocols.find((p) => p.id === activeProtocolId);

  const [messages, setMessages] = useState<PdlMessage[]>(() => (active ? cloneMessages(active.messages) : []));
  const [msgId, setMsgId] = useState(() => active?.messages[0]?.id ?? "");
  const [framing, setFraming] = useState<PdlProtocol["framing"]["mode"]>(active?.framing.mode ?? "silence-gap");
  const [gapMs, setGapMs] = useState(active?.framing.gapMs ?? 20);
  const [prefix, setPrefix] = useState(active?.framing.prefix ?? "");
  const [algorithm, setAlgorithm] = useState<ChecksumAlgorithm>(active?.checksum.algorithm ?? "ADD8");
  const [sampleHex, setSampleHex] = useState(active?.sampleFrame ?? "");
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderSample, setBuilderSample] = useState("");
  const [builderSplit, setBuilderSplit] = useState("");
  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [overFieldId, setOverFieldId] = useState<string | null>(null);

  // 切换协议 → 重置本地编辑态
  useEffect(() => {
    if (!active) return;
    // 打开时规范化：校验字段强制排到帧尾（老数据里 sum 可能在中间）
    setMessages(cloneMessages(active.messages).map((m) => ({ ...m, fields: recalc(m.fields) })));
    setMsgId(active.messages[0]?.id ?? "");
    setFraming(active.framing.mode);
    setGapMs(active.framing.gapMs);
    setPrefix(active.framing.prefix ?? "");
    setAlgorithm(active.checksum.algorithm);
    setSampleHex(active.sampleFrame ?? "");
    setDirty(false);
    setSelectedId("");
  }, [active?.id]);

  const msg = messages.find((m) => m.id === msgId) ?? messages[0];
  const fields = msg?.fields ?? [];
  const frameLen = msg ? messageLength(msg) : 0;

  const localProto: PdlProtocol | undefined = useMemo(() => {
    if (!active) return undefined;
    return {
      ...active,
      framing: { ...active.framing, mode: framing, gapMs, prefix: prefix.trim() || undefined },
      checksum: { ...active.checksum, algorithm },
      messages,
    };
  }, [active, framing, gapMs, prefix, algorithm, messages]);

  const sample = useMemo(() => parseHex(sampleHex), [sampleHex]);

  const rt = useMemo(() => {
    if (!localProto || !sample.length) return null;
    try {
      return roundTrip(localProto, sample, msg?.id);
    } catch {
      return null;
    }
  }, [localProto, sample, msg?.id]);

  const crcGuess = useMemo(() => {
    if (!localProto || !sample.length) return [];
    try {
      return detectChecksum(localProto, sample).filter((x) => x.ok);
    } catch {
      return [];
    }
  }, [localProto, sample]);

  const patchFields = (next: PdlField[]) => {
    if (!msg) return;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, fields: next } : m)));
    setDirty(true);
  };

  const updateField = (id: string, patch: Partial<PdlField>) => {
    patchFields(recalc(fields.map((f) => (f.id === id ? { ...f, ...patch } : f))));
  };

  const addField = () => {
    const f: PdlField = {
      id: `f${Date.now()}`,
      name: `field${fields.length + 1}`,
      type: "uint",
      size: 1,
      offset: 0,
      value: 0,
      valueFormat: "hex",
    };
    patchFields(recalc([...fields, f]));
    setSelectedId(f.id);
  };

  const removeField = (id: string) => patchFields(recalc(fields.filter((f) => f.id !== id)));

  /** 拖拽把字段挪到目标字段的位置 */
  const moveFieldTo = (fromId: string, toId: string) => {
    const i = fields.findIndex((f) => f.id === fromId);
    const j = fields.findIndex((f) => f.id === toId);
    if (i < 0 || j < 0 || i === j) return;
    const next = fields.slice();
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    patchFields(recalc(next));
  };

  /** 字段设置：只显示和当前类型相关的项 */
  const editField = (f: PdlField) => {
    const adv: {
      key: string;
      label: string;
      value: string;
      type?: "text" | "number" | "checkbox" | "select";
      options?: { value: string; label: string }[];
      placeholder?: string;
    }[] = [
      { key: "type", label: "类型", type: "select", value: f.type, options: TYPE_OPTIONS.map((t) => ({ value: t, label: t })) },
    ];

    if (f.type === "crc") {
      adv.push({
        key: "algorithm",
        label: "校验算法",
        type: "select",
        value: algorithm,
        options: CHECKSUM_ALGORITHMS.map((a) => ({ value: a, label: `${ALGORITHM_META[a].label} · ${ALGORITHM_META[a].formula}` })),
      });
    }

    if (f.type === "bytes") {
      adv.push({ key: "hex", label: "固定字节HEX", value: f.hex ?? "", placeholder: "DE 21 09 F6 60（留空=可填数值）" });
    }

    if (f.type !== "crc" && f.type !== "bytes" && f.size > 1) {
      adv.push({
        key: "byteOrder",
        label: "字节序",
        type: "select",
        value: f.byteOrder ?? "ABCD",
        options: [
          { value: "ABCD", label: "ABCD 大端（高字节先）" },
          { value: "BADC", label: "BADC 字节交换" },
          { value: "CDAB", label: "CDAB 字交换" },
          { value: "DCBA", label: "DCBA 小端（低字节先）" },
        ],
      });
    }

    if (f.type !== "crc" && f.type !== "bytes") {
      adv.push({
        key: "valueFormat",
        label: "值格式",
        type: "select",
        value: f.valueFormat ?? "hex",
        options: [
          { value: "dec", label: "十进制（10）" },
          { value: "hex", label: "十六进制（0A）" },
        ],
      });
      adv.push({
        key: "valueExprPreset",
        label: "自动计算",
        type: "select",
        value:
          f.auto === "frameLength"
            ? "auto-len"
            : f.valueExpr === "0xFF - len"
              ? "ff-len"
              : f.valueExpr === "0x100 - len"
                ? "100-len"
                : f.valueExpr
                  ? "custom"
                  : "",
        options: [
          { value: "", label: "不自动（我自己填值）" },
          { value: "auto-len", label: "整帧长度" },
          { value: "ff-len", label: "长度反码 0xFF - len" },
          { value: "100-len", label: "长度补码 0x100 - len" },
          { value: "custom", label: "自定义表达式" },
        ],
      });
      if (f.valueExpr || f.auto) {
        adv.push({ key: "valueExpr", label: "自定义表达式", value: f.valueExpr ?? "", placeholder: "0xFF - len" });
      }
      adv.push({ key: "enumMap", label: "枚举", value: enumToText(f.enumMap), placeholder: "十六进制：60=启动, 61=停止" });
      if (f.type === "bool" || f.type === "bitfield") {
        adv.push({ key: "bits", label: "位段", value: f.bits ?? "", placeholder: "15..0" });
      }
    }

    if (f.sizeExpr || f.offsetExpr || f.type === "bytes") {
      adv.push({ key: "sizeExpr", label: "长度表达式", value: f.sizeExpr ?? "", placeholder: "len - 5（变长数据域）" });
      adv.push({ key: "offsetExpr", label: "偏移表达式", value: f.offsetExpr ?? "", placeholder: "len - 1（固定在帧尾）" });
    }

    openDialog({
      kind: "form",
      title: `字段设置 · ${f.name}`,
      desc: f.type === "crc" ? "校验字段会自动排在帧尾。" : "只显示和当前类型相关的选项。",
      fields: adv,
      okText: "保存",
      onOk: (v) => {
        if (v.algorithm && v.algorithm !== algorithm) {
          setAlgorithm(v.algorithm as ChecksumAlgorithm);
          setDirty(true);
        }
        const valueExpr =
          v.valueExprPreset === "auto-len"
            ? undefined
            : v.valueExprPreset === "ff-len"
              ? "0xFF - len"
              : v.valueExprPreset === "100-len"
                ? "0x100 - len"
                : v.valueExprPreset === "custom"
                  ? v.valueExpr?.trim() || undefined
                  : undefined;
        updateField(f.id, {
          auto: v.valueExprPreset === "auto-len" ? ("frameLength" as const) : undefined,
          type: (v.type || f.type) as PdlField["type"],
          byteOrder: (v.byteOrder || undefined) as ByteOrder | undefined,
          valueFormat: (v.valueFormat === "hex" ? "hex" : "dec") as "dec" | "hex",
          valueExpr,
          hex: v.hex?.trim() || undefined,
          sizeExpr: v.sizeExpr?.trim() || undefined,
          offsetExpr: v.offsetExpr?.trim() || undefined,
          enumMap: textToEnum(v.enumMap),
          bits: v.bits?.trim() || undefined,
        });
      },
    });
  };

  /** 从样例帧按字节切分生成字段 */
  const buildFromSample = () => {
    const bytes = parseHex(builderSample);
    if (!bytes.length) return;
    const parts = builderSplit
      .split(/[,，]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const [sizeStr, ...nameParts] = x.split(":");
        return { size: Number(sizeStr.trim()), name: nameParts.join(":").trim() };
      })
      .filter((p) => Number.isFinite(p.size) && p.size > 0);

    const whole = parts.length === 0;
    const useParts = whole ? [{ size: bytes.length, name: "frame" }] : parts;
    let off = 0;
    const out: PdlField[] = [];
    for (let i = 0; i < useParts.length; i++) {
      const size = Math.min(useParts[i].size, bytes.length - off);
      if (size <= 0) break;
      const seg = bytes.slice(off, off + size);
      const isHeader = i === 0 && off === 0;
      const isLast = i === useParts.length - 1;
      const given = useParts[i].name;
      out.push({
        id: `f${Date.now()}_${i}`,
        name: given || (isHeader ? "header" : isLast && size <= 2 ? "value" : `field${i + 1}`),
        type: isHeader ? "bytes" : size > 4 ? "bytes" : "uint",
        size,
        offset: 0,
        byteOrder: size > 1 ? "ABCD" : undefined,
        value: 0,
        valueFormat: "hex",
        hex: isHeader ? seg.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ") : undefined,
        desc: whole ? "整帧（固定报文，可直接发送）" : isHeader ? "帧头（固定）" : isLast && size <= 2 ? "高/低位（2 字节）" : `字段 ${i + 1}`,
      });
      off += size;
    }
    if (!out.length) return;
    const built: PdlMessage = { id: msg?.id ?? "frame", name: msg?.name ?? "报文", fields: recalc(out) };
    setMessages((prev) => (prev.length ? prev.map((m) => (m.id === built.id ? built : m)) : [built]));
    setMsgId(built.id);
    setSelectedId(built.fields[0].id);
    setSampleHex(builderSample);
    setDirty(true);
    setBuilderOpen(false);
  };

  const addMessage = () => {
    const base = msg ?? messages[0];
    const cmdField = base?.fields.find((f) => f.name === "cmd" || f.name === "func" || f.name === "code");
    const m: PdlMessage = {
      id: `m${Date.now()}`,
      name: `报文${messages.length + 1}`,
      fields: (base?.fields ?? []).map((f) => (f.id === cmdField?.id ? { ...f, value: Number(f.value ?? 0) + 1 } : { ...f })),
    };
    setMessages((prev) => [...prev, m]);
    setMsgId(m.id);
    setDirty(true);
  };

  const removeMessage = () => {
    if (messages.length <= 1) return;
    const rest = messages.filter((m) => m.id !== msgId);
    setMessages(rest);
    setMsgId(rest[0].id);
    setDirty(true);
  };

  const persist = () => {
    if (!active || !localProto) return;
    updateProtocol(active.id, {
      messages,
      framing: localProto.framing,
      checksum: localProto.checksum,
      sampleFrame: sampleHex,
    });
    setDirty(false);
  };

  const save = () => {
    if (!active || !localProto) return;
    if (sample.length && rt && !rt.ok) {
      setRoundTripFailed(true);
      useStore.getState().setShowRoundTripModal(true);
      return;
    }
    persist();
  };

  // 弹窗里点「强制保存」
  useEffect(() => {
    if (forceSaveSeq === 0) return;
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceSaveSeq]);

  if (!active) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="page-title-wrap">
            <div className="page-title">
              <span>协议</span>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-body">
              <EmptyState
                icon={IC.protocolDoc}
                title="还没有选中协议"
                desc="在左侧产品树里点一个协议，或者新建一个（每个子产品可以有多个协议：心跳 / 上线 / 查询…）"
              >
                <button className="btn" onClick={() => void import("../lib/actions").then((m) => m.newProtocol())}>
                  <Icon cp={IC.plus} size={11} color="var(--t2)" />
                  新建协议
                </button>
              </EmptyState>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /** 协议信息：改名称 / 版本号（协议版本统一管理） */
  const editMeta = () => {
    openDialog({
      kind: "form",
      title: "协议信息",
      desc: "名称和版本会显示在页面标题、测试报告和导出的验收单里",
      fields: [
        { key: "name", label: "协议名称", value: active.name, placeholder: "如 起升PLC 控制协议" },
        { key: "version", label: "版本号", value: active.version, placeholder: "如 v3 / 2026.10" },
      ],
      okText: "保存",
      onOk: (v) => {
        const name = (v.name ?? "").trim() || active.name;
        const version = (v.version ?? "").trim() || active.version;
        updateProtocol(active.id, { name, version, updatedAt: "刚刚" });
      },
    });
  };

  const subProduct = subProducts.find((s) => s.id === active.subProductId);

  return (
    <div className="page">
      {/* 头部 */}
      <div className="page-head">
        <div className="page-title-wrap">
          <div className="page-title">
            <span>{active.name}</span>
            <span className="tag-mini" title="点击修改协议名称 / 版本" style={{ cursor: "pointer" }} onClick={editMeta}>{active.version}</span>
            {sample.length > 0 &&
              (rt?.ok ? (
                <span className="pill green" style={{ height: 18 }}>
                  样例帧 round-trip 通过
                </span>
              ) : (
                <span className="pill amber" style={{ height: 18 }}>
                  round-trip 未通过
                </span>
              ))}
            {dirty && (
              <span className="pill amber" style={{ height: 18 }}>
                有未保存修改
              </span>
            )}
          </div>
          <div className="page-sub">
            PDL · {fields.length} 字段 · {ALGORITHM_META[algorithm]?.label} ·{" "}
            {FRAMING_MODES.find((f) => f.key === framing)?.label}分帧
            {subProduct ? ` · 子产品「${subProduct.name}」` : ""}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={save}>
            <Icon cp={IC.check} size={12} color="#fff" />
            <span>保存</span>
          </button>
          <button className="btn" onClick={() => duplicateProtocol()}>
            <Icon cp={IC.split} size={11} color="var(--t2)" />
            <span>另存为新版本</span>
          </button>
          <button
            className="btn square"
            title="删除协议"
            onClick={() => void import("../lib/actions").then((m) => m.deleteProtocol(active.id, active.name))}
          >
            <Icon cp={IC.trash} size={11} color="var(--red)" />
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="page-body">
        <div className="pdl-main">
          <div className="pdl-main-head">
            <span className="pdl-section-title">字段定义</span>
            <span className="tag-mini">{fields.length}</span>
            <select
              className="pdl-msg-select"
              value={msgId}
              onChange={(e) => {
                setMsgId(e.target.value);
                setSelectedId("");
              }}
            >
              {messages.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}（{m.fields.length} 字段）
                </option>
              ))}
            </select>
            <button className="btn sm" title="新建报文（复制当前布局）" onClick={addMessage}>
              <Icon cp={IC.plus} size={10} color="var(--t2)" />
              <span>报文</span>
            </button>
            {messages.length > 1 && (
              <button className="btn sm square" title="删除当前报文" onClick={removeMessage}>
                <Icon cp={IC.trash} size={10} color="var(--red)" />
              </button>
            )}
            <span className="spacer" />
            <span className="pdl-hint">「值」可直接填 DE 21 09 F6 60，长度会自动跟着变</span>
            <button
              className="btn sm"
              title="粘贴一帧真实报文，按字节切分成字段"
              onClick={() => {
                setBuilderSample(sampleHex || "");
                setBuilderSplit("");
                setBuilderOpen(true);
              }}
            >
              <Icon cp={IC.search} size={10} color="var(--accent)" />
              <span>从样例帧建</span>
            </button>
            <button className="btn sm" onClick={addField}>
              <Icon cp={IC.plus} size={10} color="var(--t2)" />
              <span>字段</span>
            </button>
          </div>

          <div className="pdl-table">
            <div className="pdl-tr head">
              <span className="drag-handle" />
              <span className="c-off">偏移</span>
              <span className="c-fname">字段名</span>
              <span className="c-fsize">长度</span>
              <span className="c-fvalue">值</span>
              <span className="c-fdesc">说明</span>
              <span className="c-fmore" />
            </div>

            {fields.length === 0 && (
              <div className="pdl-empty">
                <div className="empty-title">这个协议还没有字段</div>
                <div className="empty-desc">按你自己的协议来：把一帧真实报文粘进来自动切分，或者手动加字段（名称 + 长度 + 值）。</div>
                <div className="row gap-8" style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setBuilderSample("");
                      setBuilderSplit("");
                      setBuilderOpen(true);
                    }}
                  >
                    <Icon cp={IC.search} size={11} color="var(--accent)" />
                    从样例帧建
                  </button>
                  <button className="btn" onClick={addField}>
                    <Icon cp={IC.plus} size={11} color="var(--t2)" />
                    手动加字段
                  </button>
                </div>
              </div>
            )}

            {fields.map((f) => (
              <div
                key={f.id}
                className={`pdl-tr${f.id === selectedId ? " selected" : ""}${overFieldId === f.id ? " drag-over" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDragFieldId(f.id);
                  e.dataTransfer.effectAllowed = "move";
                  try {
                    e.dataTransfer.setData("text/plain", f.id);
                  } catch {
                    /* noop */
                  }
                }}
                onDragOver={(e) => {
                  if (!dragFieldId || dragFieldId === f.id) return;
                  e.preventDefault();
                  setOverFieldId(f.id);
                }}
                onDragLeave={() => setOverFieldId((c) => (c === f.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFieldId && dragFieldId !== f.id) moveFieldTo(dragFieldId, f.id);
                  setDragFieldId(null);
                  setOverFieldId(null);
                }}
                onDragEnd={() => {
                  setDragFieldId(null);
                  setOverFieldId(null);
                }}
                onClick={() => setSelectedId(f.id)}
              >
                <span className="drag-handle" title="拖动排序">
                  <span className="grip">⠿</span>
                </span>
                <span className="pdl-cell c-off">{f.offset < 0 ? "—" : f.offset}</span>

                <span className="c-fname">
                  <input className="cell-input" value={f.name} onChange={(e) => updateField(f.id, { name: e.target.value })} />
                  {(f.type !== "uint" || f.enumMap) && (
                    <span
                      className={f.type === "crc" ? "type-pill crc" : f.enumMap ? "type-pill enum" : "type-pill"}
                      title={f.enumMap ? enumToText(f.enumMap) : f.type === "crc" ? `校验：${ALGORITHM_META[algorithm]?.label}` : f.type}
                    >
                      {f.enumMap ? "枚举" : f.type === "crc" ? `crc·${algorithm.replace("CRC16/", "").replace("CRC8/", "8/")}` : f.type}
                    </span>
                  )}
                </span>

                <span className="c-fsize">
                  <input
                    className="cell-input num"
                    value={f.sizeExpr ?? String(f.size)}
                    title={f.sizeExpr ? "长度由表达式算出" : "固定字节数"}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (/^\d+$/.test(raw)) updateField(f.id, { size: Math.max(1, Number(raw)), sizeExpr: undefined });
                      else updateField(f.id, { sizeExpr: raw || undefined });
                    }}
                  />
                </span>

                <span className="c-fvalue">
                  {f.valueExpr || f.auto ? (
                    <span className="pdbg-fixed" title={f.auto ? "自动 = 整帧长度" : `自动计算：${f.valueExpr}`} style={{ width: "100%" }}>
                      {f.auto ? "自动 整帧长度" : `自动 ${f.valueExpr}`}
                    </span>
                  ) : (
                    <input
                      className="cell-input"
                      value={
                        f.hex !== undefined
                          ? f.hex
                          : f.valueFormat === "hex"
                            ? Number(f.value ?? 0).toString(16).toUpperCase().padStart(Math.max(2, (f.size || 1) * 2), "0")
                            : String(f.value ?? "")
                      }
                      title={f.valueFormat === "hex" ? "十六进制填写，如 0A" : "随便填：十进制、0x 十六进制、或 DE 21 09 F6 60 这样的字节串"}
                      placeholder={f.valueFormat === "hex" ? "0A" : "0 / 0x1F / DE 21 09 F6 60"}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const s = e.target.value.trim();
                        if (!s) {
                          updateField(f.id, { value: 0, hex: undefined });
                          return;
                        }
                        if (f.valueFormat === "hex" && /^[0-9a-fA-F]+$/.test(s)) {
                          updateField(f.id, { value: parseInt(s, 16) || 0, hex: undefined });
                          return;
                        }
                        const looksHex = f.type === "bytes" || /\s/.test(s) || /[a-fA-F]/.test(s);
                        if (looksHex && /^[0-9a-fA-F\s]+$/.test(s)) {
                          const clean = s.replace(/\s/g, "");
                          const bytes = Math.floor(clean.length / 2);
                          updateField(f.id, {
                            hex: s.toUpperCase(),
                            value: 0,
                            ...(f.sizeExpr || bytes < 1 ? {} : { size: bytes }),
                          });
                        } else if (/^0x[0-9a-fA-F]+$/i.test(s)) {
                          updateField(f.id, { value: Number(s), hex: undefined });
                        } else {
                          updateField(f.id, { value: Number(s) || 0, hex: undefined });
                        }
                      }}
                    />
                  )}
                </span>

                <span className="c-fdesc">
                  <input
                    className="cell-input"
                    value={f.desc ?? ""}
                    placeholder={f.enumMap ? `枚举：${enumToText(f.enumMap)}` : "说明"}
                    title={f.enumMap ? enumToText(f.enumMap) : ""}
                    onChange={(e) => updateField(f.id, { desc: e.target.value })}
                  />
                </span>

                <span className="c-fmore" style={{ gap: 2 }}>
                  {(f.sizeExpr || f.offsetExpr || f.expect !== undefined || f.hex) && (
                    <span
                      className="fx-badge"
                      title={[
                        f.hex ? `固定 ${f.hex}` : "",
                        f.sizeExpr ? `变长 ${f.sizeExpr}` : "",
                        f.offsetExpr ? `偏移 ${f.offsetExpr}` : "",
                        f.expect !== undefined ? `校验 0x${f.expect.toString(16).toUpperCase()}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      fx
                    </span>
                  )}
                  <button
                    className="mv-btn"
                    title="字段设置（类型 / 校验算法 / 枚举 / 变长）"
                    onClick={(e) => {
                      e.stopPropagation();
                      editField(f);
                    }}
                  >
                    <Icon cp={IC.settings} size={10} color="var(--t3)" />
                  </button>
                  <button
                    className="mv-btn"
                    title="复制这个字段"
                    onClick={(e) => {
                      e.stopPropagation();
                      const i = fields.findIndex((x) => x.id === f.id);
                      const copy: PdlField = { ...f, id: `f${Date.now()}`, name: `${f.name}_copy` };
                      const next = fields.slice();
                      next.splice(i + 1, 0, copy);
                      patchFields(recalc(next));
                      setSelectedId(copy.id);
                    }}
                  >
                    <Icon cp={IC.split} size={10} color="var(--t3)" />
                  </button>
                  <button className="mv-btn" title="删除字段" onClick={(e) => { e.stopPropagation(); removeField(f.id); }}>
                    <Icon cp={IC.trash} size={11} color="var(--red)" />
                  </button>
                </span>
              </div>
            ))}

            <div className="pdl-add-row" onClick={addField}>
              <Icon cp={IC.plus} size={11} color="var(--t3)" />
              <span>添加字段 · 类型 / 校验算法 / 枚举 等设置在每行的 ⚙ 里</span>
            </div>
          </div>
        </div>

        {/* 右侧设置 */}
        <div className="pdl-side">
          <div className="pdl-card">
            <div className="pdl-card-head">
              <span className="pdl-card-title">分帧</span>
              <span className="pdl-card-note">可组合</span>
            </div>
            <div className="seg">
              {FRAMING_MODES.map((m) => (
                <button
                  key={m.key}
                  className={framing === m.key ? "seg-btn active" : "seg-btn"}
                  title={m.hint}
                  onClick={() => {
                    setFraming(m.key);
                    setDirty(true);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="field-line">
              <span className="k">帧头HEX</span>
              <span className="input-box">
                <input
                  value={prefix}
                  placeholder="AA 55（可留空）"
                  onChange={(e) => {
                    setPrefix(e.target.value);
                    setDirty(true);
                  }}
                />
              </span>
            </div>
            <div className="field-line">
              <span className="k">静默间隔</span>
              <span className="input-box">
                <input
                  className="num"
                  value={String(gapMs)}
                  onChange={(e) => {
                    setGapMs(Number(e.target.value) || 0);
                    setDirty(true);
                  }}
                />
                <span className="unit">ms</span>
              </span>
            </div>
          </div>

          <div className="pdl-card">
            <div className="pdl-card-head">
              <Icon cp={IC.check} size={11} color="var(--green)" />
              <span className="pdl-card-title">校验算法</span>
              <span className="spacer" />
              <span className="pill green" style={{ height: 15 }}>
                双向解包/组包
              </span>
            </div>
            <div className="alg-chips" style={{ maxHeight: 120, overflowY: "auto" }}>
              {ALGORITHM_GROUPS.map((g) => (
                <div key={g.group} style={{ display: "flex", flexWrap: "wrap", gap: 4, width: "100%" }}>
                  <span style={{ fontSize: 8, color: "var(--t5)", width: "100%", marginTop: 2 }}>{g.group}</span>
                  {g.items.map((a) => (
                    <button
                      key={a}
                      className={algorithm === a ? "alg-chip active" : "alg-chip"}
                      title={`${ALGORITHM_META[a].label} · ${ALGORITHM_META[a].formula} · ${ALGORITHM_META[a].size} 字节`}
                      onClick={() => {
                        setAlgorithm(a);
                        setDirty(true);
                      }}
                    >
                      {a.replace("CRC16/", "").replace("CRC8/", "8/")}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9, color: "var(--t4)", padding: "4px 10px 8px", lineHeight: 1.5 }}>
              {ALGORITHM_META[algorithm]?.label} · {ALGORITHM_META[algorithm]?.formula} · 占 {ALGORITHM_META[algorithm]?.size} 字节
            </div>
          </div>

          <div className="pdl-card">
            <div className="pdl-card-head">
              <Icon cp={IC.list} size={11} color="var(--t3)" />
              <span className="pdl-card-title">字节序 · 四选一</span>
              <span className="pdl-card-note">{fields.find((f) => f.id === selectedId)?.name ?? "先选字段"}</span>
            </div>
            <div className="order-grid">
              {(["ABCD", "BADC", "CDAB", "DCBA"] as ByteOrder[]).map((o) => {
                const sel = fields.find((f) => f.id === selectedId);
                return (
                  <button
                    key={o}
                    className={sel?.byteOrder === o ? "order-btn active" : "order-btn"}
                    onClick={() => sel && updateField(sel.id, { byteOrder: o })}
                  >
                    <span>{o}</span>
                    <span className="order-sub">
                      {o === "ABCD" ? "大端" : o === "BADC" ? "字节交换" : o === "CDAB" ? "字交换" : "小端"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pdl-card">
            <div className="pdl-card-head">
              <Icon cp={IC.search} size={11} color="var(--t3)" />
              <span className="pdl-card-title">样例帧 round-trip</span>
              <span className="spacer" />
              <button className="mini-btn" onClick={save}>
                保存前强制
              </button>
            </div>
            <div className="field-line" style={{ padding: "6px 10px 0" }}>
              <span className="input-box" style={{ flex: 1 }}>
                <input
                  value={sampleHex}
                  placeholder="粘贴一帧真实报文，例如 DE 21 09 F6 60 00 00 00"
                  onChange={(e) => {
                    setSampleHex(e.target.value);
                    setDirty(true);
                  }}
                />
              </span>
            </div>
            <div style={{ padding: "6px 10px 10px", fontSize: 9, lineHeight: 1.6 }}>
              {!sample.length ? (
                <span style={{ color: "var(--t4)" }}>填一帧样例才能校验 round-trip；不填也可以保存</span>
              ) : rt ? (
                <>
                  <div style={{ color: "var(--t3)" }}>
                    组包结果 <span className="num" style={{ color: "var(--t1)" }}>{toHex(rt.rebuilt)}</span>
                  </div>
                  {rt.ok ? (
                    <div className="result-ok" style={{ marginTop: 4 }}>
                      <Icon cp={IC.check} size={10} color="var(--green)" />
                      <span>逐字节一致 · 允许保存</span>
                    </div>
                  ) : (
                    <div className="result-bad" style={{ marginTop: 4 }}>
                      <Icon cp={IC.warn} size={10} color="var(--red)" />
                      <span>
                        {rt.diffIndexes.length} 字节不一致
                        {rt.checksumOnly ? "（仅校验位差异）" : ""}
                      </span>
                    </div>
                  )}
                  {crcGuess.length > 0 && (
                    <div style={{ marginTop: 4, color: "var(--t3)" }}>
                      样例帧匹配算法：{crcGuess.map((g) => g.alg).join(" / ")}
                    </div>
                  )}
                </>
              ) : (
                <span style={{ color: "var(--t4)" }}>无法解析这一帧（检查字段长度）</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 调试发送 */}
      {msg && localProto && <ProtocolDebug proto={localProto} msg={msg} />}

      {/* 从样例帧建 */}
      {builderOpen && (
        <div className="modal-mask" onClick={() => setBuilderOpen(false)}>
          <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-icon" style={{ background: "var(--bg-blue)" }}>
                <Icon cp={IC.search} size={12} color="var(--accent)" />
              </span>
              <div style={{ flex: 1 }}>
                <div className="modal-title">从样例帧生成字段</div>
                <div className="modal-sub">粘贴一帧真实报文，按字节数切分，自动生成字段（首段作为固定帧头）</div>
              </div>
              <button className="modal-close" onClick={() => setBuilderOpen(false)}>
                <Icon cp={IC.close} size={13} color="var(--t3)" />
              </button>
            </div>
            <div className="modal-body">
              <div className="field-line">
                <span className="k" style={{ width: 78 }}>样例帧</span>
                <span className="input-box" style={{ flex: 1 }}>
                  <input value={builderSample} onChange={(e) => setBuilderSample(e.target.value)} placeholder="DE 21 09 F6 60 00 00 00" />
                </span>
              </div>
              <div className="field-line">
                <span className="k" style={{ width: 78 }}>切分</span>
                <span className="input-box" style={{ flex: 1 }}>
                  <input value={builderSplit} onChange={(e) => setBuilderSplit(e.target.value)} placeholder="留空=整帧一个字段；或 5:header,1:carNo,2:value" />
                </span>
              </div>
              <div style={{ fontSize: 10, color: "var(--t3)" }}>
                共 {parseHex(builderSample).length} 字节 · 切分后：
                {(() => {
                  const bytes = parseHex(builderSample);
                  const sizes = builderSplit
                    .split(/[,，]+/)
                    .map((x) => Number(x.split(":")[0]))
                    .filter((n) => Number.isFinite(n) && n > 0);
                  const use = sizes.length ? sizes : [bytes.length];
                  let off = 0;
                  const parts: string[] = [];
                  for (const s of use) {
                    const seg = bytes.slice(off, off + s);
                    if (!seg.length) break;
                    parts.push(`${off}~${off + seg.length - 1}: ${toHex(seg)}`);
                    off += seg.length;
                  }
                  return parts.length ? ` ${parts.join("  |  ")}` : " —";
                })()}
              </div>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button className="btn" onClick={() => setBuilderOpen(false)}>取消</button>
              <button className="btn-primary" onClick={buildFromSample}>
                <Icon cp={IC.check} size={12} color="#fff" />
                <span>生成字段</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-foot">
        <span>
          协议 {active.version} · {fields.length} 字段 · {frameLen < 0 ? "变长帧" : `${frameLen} 字节帧长`}
        </span>
        <span>·</span>
        <span style={{ color: dirty ? "var(--amber)" : "var(--green)" }}>{dirty ? "有未保存修改" : "已保存"}</span>
        <span className="right">
          <button className="mini-btn" onClick={() => setView("terminal")}>
            去终端收发
          </button>
        </span>
      </div>
    </div>
  );
}
