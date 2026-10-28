/**
 * 共用动作（新建 / 重命名 / 删除 / 绑定协议）。
 * 结构：产品 → 子产品（固定协议）→ 角色 / 用例 / 规则；套件在产品级。
 */
import { useStore } from "../engine/store";
import { PROTOCOL_TEMPLATES } from "../engine/pdl";
import type { CaseItem, CaseStep, ProductItem, RoleItem, RuleItem, SubProductItem, SuiteItem } from "../engine/types";

const s = () => useStore.getState();

/* ---------------- 通用 ---------------- */
export function confirmDelete(title: string, desc: string, onOk: () => void) {
  s().openDialog({ kind: "confirm", title, desc, danger: true, okText: "删除", onOk });
}

function prompt(title: string, label: string, value: string, okText: string, onOk: (v: string) => void, desc?: string) {
  s().openDialog({
    kind: "form",
    title,
    desc,
    fields: [{ key: "name", label, value }],
    okText,
    onOk: (v) => v.name?.trim() && onOk(v.name.trim()),
  });
}

/* ---------------- 产品 ---------------- */
export function newProduct() {
  prompt("新建产品", "产品名称", "", "创建", (name) => s().createProduct(name), "产品是顶层容器，下面挂子产品。");
}
export function renameProduct(p: ProductItem) {
  prompt("重命名产品", "产品名称", p.name, "保存", (name) => s().renameProduct(p.id, name));
}
export function deleteProduct(p: ProductItem) {
  confirmDelete("删除产品", `确定删除「${p.name}」？其下子产品、角色、用例会一并移除。`, () => s().deleteProduct(p.id));
}

/* ---------------- 子产品 ---------------- */
export function newSubProduct() {
  s().openDialog({
    kind: "form",
    title: "新建子产品",
    desc: "子产品 = 一个被测算的功能单元（起升控制 / 小车控制…）。先选协议类型，之后可以在它下面加多个协议（心跳 / 上线 / 查询…）。",
    fields: [
      { key: "name", label: "名称", value: "", placeholder: "例如：起升控制" },
      {
        key: "template",
        label: "协议类型",
        type: "select" as const,
        value: "plc",
        options: PROTOCOL_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} — ${t.desc}` })),
      },
    ],
    okText: "创建",
    onOk: (v) => {
      if (!v.name?.trim()) return;
      s().createSubProduct(v.name.trim(), v.template || "plc");
    },
  });
}

export function renameSubProduct(sp: SubProductItem) {
  prompt("重命名子产品", "名称", sp.name, "保存", (name) => s().updateSubProduct(sp.id, { name }));
}

export function deleteSubProduct(sp: SubProductItem) {
  confirmDelete(
    "删除子产品",
    `确定删除「${sp.name}」？其下角色、用例、规则会一并移除（协议保留）。`,
    () => s().deleteSubProduct(sp.id),
  );
}

/** 给子产品挑一个协议（已有协议里选，或新建） */
export function pickSubProductProtocol(sp: SubProductItem) {
  const st = s();
  const opts = st.protocols.map((p) => ({ value: p.id, label: `${p.name} ${p.version}` }));
  st.openDialog({
    kind: "form",
    title: `为「${sp.name}」选择协议`,
    desc: opts.length ? "每个子产品固定绑定一个协议。" : "还没有协议，先去「协议」页新建，或用 AI 草稿生成。",
    fields: opts.length
      ? [{ key: "protocolId", label: "协议", type: "select" as const, value: sp.protocolId || opts[0].value, options: opts }]
      : [{ key: "protocolId", label: "协议", value: "" }],
    okText: "绑定",
    onOk: (v) => {
      if (!v.protocolId?.trim()) return;
      s().updateSubProduct(sp.id, { protocolId: v.protocolId.trim() });
      s().setActiveSubProduct(sp.id);
    },
  });
}

/* ---------------- 角色 ---------------- */
export function newRole() {
  const st = s();
  if (!st.subProducts.length) {
    st.openDialog({
      kind: "confirm",
      title: "先建子产品",
      desc: "角色属于某个子产品，请先新建一个子产品。",
      okText: "去新建子产品",
      onOk: () => newSubProduct(),
    });
    return;
  }
  st.openDialog({
    kind: "form",
    title: "新建角色",
    desc: "角色 = 总线上的一个身份（起升PLC / 上位机 / 变频器）。串口在顶栏选，不属于角色。",
    fields: [
      { key: "name", label: "角色名", value: "", placeholder: "例如：起升PLC" },
      { key: "address", label: "站号", value: "1", type: "number" },
      { key: "note", label: "备注", value: "", placeholder: "可选" },
    ],
    okText: "创建",
    onOk: (v) => {
      if (!v.name?.trim()) return;
      s().createRole({ name: v.name.trim(), address: Number(v.address) || 0, note: v.note?.trim() || undefined });
    },
  });
}

export function editRole(r: RoleItem) {
  s().openDialog({
    kind: "form",
    title: `编辑角色「${r.name}」`,
    fields: [
      { key: "name", label: "角色名", value: r.name },
      { key: "address", label: "站号", value: String(r.address), type: "number" },
      { key: "note", label: "备注", value: r.note ?? "" },
    ],
    okText: "保存",
    onOk: (v) => {
      if (!v.name?.trim()) return;
      s().updateRole(r.id, { name: v.name.trim(), address: Number(v.address) || 0, note: v.note?.trim() || undefined });
    },
  });
}

export function deleteRole(r: RoleItem) {
  confirmDelete("删除角色", `确定删除「${r.name}」？`, () => s().deleteRole(r.id));
}

/* ---------------- 协议 ---------------- */
export function newProtocol() {
  s().openDialog({
    kind: "form",
    title: "新建协议",
    desc: "一个子产品可以有多个协议（心跳 / 车辆上线 / 状态查询…），各自独立定义帧结构。",
    fields: [
      { key: "name", label: "协议名", value: "", placeholder: "例如：心跳 / 车辆上线" },
      {
        key: "template",
        label: "协议类型",
        type: "select" as const,
        value: "plc",
        options: PROTOCOL_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} — ${t.desc}` })),
      },
    ],
    okText: "创建",
    onOk: (v) => {
      if (!v.name?.trim()) return;
      s().createProtocol(v.name.trim(), v.template || "plc");
    },
  });
}
export function renameProtocol(id: string, name: string) {
  prompt("重命名协议", "协议名", name, "保存", (v) => s().updateProtocol(id, { name: v }));
}
export function deleteProtocol(id: string, name: string) {
  confirmDelete("删除协议", `确定删除「${name}」？引用它的子产品会变成未绑定。`, () => s().deleteProtocol(id));
}

/* ---------------- 用例 ---------------- */
export function newCase() {
  prompt("新建用例", "用例名", "", "创建", (name) => s().createCase(name), "用例属于当前子产品，跑在某个角色上。");
}
export function renameCase(c: CaseItem) {
  prompt("重命名用例", "用例名", c.name, "保存", (name) => s().updateCase(c.id, { name }));
}
export function deleteCase(c: CaseItem) {
  confirmDelete("删除用例", `确定删除「${c.name}」？`, () => s().deleteCase(c.id));
}

/**
 * 一键生成示例用例：用当前协议的默认帧发一帧，再断言第一个字段
 * 让用户先跑通「发→收→断言→报告」，再自己改
 */
export async function createSampleCase() {
  const st = s();
  const proto = st.protocols.find((p) => p.id === st.activeProtocolId);
  if (!proto || !proto.messages[0]?.fields.length) {
    st.openDialog({
      kind: "confirm",
      title: "先有协议才能生成用例",
      desc: "当前没有选中的协议，或者协议里还没有字段。先去「协议」页建好帧结构。",
      okText: "去协议页",
      onOk: () => s().setView("protocol"),
    });
    return;
  }
  const { encodeMessage } = await import("../engine/codec");
  const { toHex } = await import("../engine/bytes");
  const msg = proto.messages[0];
  let bytes: number[] = [];
  try {
    bytes = encodeMessage(proto, msg, {});
  } catch {
    bytes = [];
  }
  // 只挑「普通数值字段」做断言（跳过自动计算、固定字节、枚举）
  const target = msg.fields.find(
    (f) => f.type !== "crc" && !f.auto && !f.valueExpr && f.hex === undefined && f.type !== "bytes" && typeof f.value === "number",
  );
  const steps: CaseStep[] = [
    {
      id: `s${Date.now()}a`,
      kind: "send",
      text: "send",
      detail: bytes.length ? toHex(bytes) : "00",
      timeout: "3s",
    },
  ];
  if (target) {
    steps.push({
      id: `s${Date.now()}b`,
      kind: "expect",
      text: "expect",
      detail: "field",
      fields: [{ label: target.name, value: `equals ${Number(target.value ?? 0)}` }],
      timeout: "within 2s",
    });
  }
  s().createCase(`${proto.name} 冒烟`);
  const id = s().activeCaseId;
  s().updateCaseSteps(id, steps);
  s().setView("case");
  st.openDialog({
    kind: "confirm",
    title: "示例用例已生成",
    desc: `用例「${proto.name} 冒烟」里有 2 步：\n1. 发一帧 ${bytes.length} 字节\n2. 断言字段 ${target?.name ?? "—"} = ${Number(target?.value ?? 0)}\n\n点「运行用例」就能看到报告。`,
    okText: "知道了",
    onOk: () => {
      /* 关闭即可 */
    },
  });
}

/* ---------------- 规则 ---------------- */
export function newRule() {
  s().openDialog({
    kind: "form",
    title: "新建规则",
    desc: "规则常驻：触发器 → 动作。周期类规则在开启顶栏「自动发送」后由引擎真实驱动。",
    fields: [
      { key: "name", label: "规则名", value: "", placeholder: "例如：心跳 1000ms" },
      { key: "trigger", label: "触发", value: "每 1000ms", placeholder: "每 1000ms / onConnect" },
      { key: "action", label: "动作", value: "发查询帧" },
    ],
    okText: "创建",
    onOk: (v) => {
      if (!v.name?.trim()) return;
      s().createRule(v.name.trim(), v.trigger?.trim() || "每 1000ms", v.action?.trim() || "发查询帧");
    },
  });
}
export function renameRule(r: RuleItem) {
  prompt("重命名规则", "规则名", r.name, "保存", (name) => s().updateRule(r.id, { name }));
}
export function deleteRule(r: RuleItem) {
  confirmDelete("删除规则", `确定删除「${r.name}」？`, () => s().deleteRule(r.id));
}

/* ---------------- 套件 ---------------- */
export function newSuite() {
  s().openDialog({
    kind: "form",
    title: "新建套件",
    desc: "套件按标签筛选用例；标签留空表示包含全部用例。",
    fields: [
      { key: "name", label: "套件名", value: "", placeholder: "例如：专项回归" },
      { key: "tag", label: "标签", value: "", placeholder: "留空=全部" },
    ],
    okText: "创建",
    onOk: (v) => {
      if (!v.name?.trim()) return;
      s().createSuite(v.name.trim(), v.tag?.trim() || undefined);
    },
  });
}
export function deleteSuite(st: SuiteItem) {
  confirmDelete("删除套件", `确定删除「${st.name}」？用例不会被删除。`, () => s().deleteSuite(st.id));
}
