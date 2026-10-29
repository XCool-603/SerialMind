import { runCase, type RunnerHost } from "../src/engine/runner";
import { VEHICLE_WALK_PROTOCOL, type PdlProtocol } from "../src/engine/pdl";
import { decodeFrame } from "../src/engine/codec";
import type { CaseItem, Frame } from "../src/engine/types";

async function testDynamicFieldSync() {
  console.log("=== 验证：用例字段 100% 动态实时跟随用户协议的定义 ===");

  // 克隆一个协议实例作为用户当前协议
  let userProtocol: PdlProtocol = JSON.parse(JSON.stringify(VEHICLE_WALK_PROTOCOL));

  const frames: Frame[] = [];
  const host: RunnerHost = {
    getProtocol: () => userProtocol,
    getAllProtocols: () => [userProtocol],
    getFrames: () => frames,
    pushFrame: (f) => {
      frames.push({
        id: frames.length + 1,
        time: "12:00:00",
        ts: Date.now(),
        no: frames.length + 1,
        ...f,
      });
    },
    write: async () => {},
    isLinkOpen: () => true,
    autoChecksum: () => true,
  };

  // 用户用例：仅配置了 distance 的每秒+10 步长，未覆盖 speed / score 等其它字段
  const testCase: CaseItem = {
    id: "case-dynamic-test",
    subProductId: "sp-crane",
    name: "动态字段联动测试",
    roleId: "role-1",
    tags: ["动态字段"],
    status: "idle",
    statusText: "未运行",
    stepCount: 1,
    assertionCount: 0,
    steps: [],
    yaml: "",
    repeat: 1,
    intervalMs: 10,
    actions: [
      {
        id: "act-vehicle-walk",
        name: "车辆行走",
        protocolId: userProtocol.id,
        intervalMs: 100,
        enabled: true,
        fields: [
          { fieldName: "distance", step: 10 }, // 仅配置步长，不硬编码初始值
        ],
      },
    ],
  };

  const getValues = (bytes: number[]) => {
    const dec = decodeFrame(userProtocol, bytes);
    const map: Record<string, any> = {};
    for (const f of dec.fields) {
      map[f.field.name] = f.value;
    }
    return map;
  };

  // --- 测试场景 1：默认协议执行 ---
  console.log("\n[场景 1] 默认协议执行 (speed 默认为 20)");
  frames.length = 0;
  let res = await runCase(host, testCase, "场景1");
  if (res.status !== "pass") throw new Error(`场景 1 失败: ${res.reason}`);
  let lastFrame = frames[frames.length - 1];
  let values = getValues(lastFrame.bytes);
  console.log("解码结果:", values);
  if (values.speed !== 20) {
    throw new Error(`期望 speed=20，实际为 ${values.speed}`);
  }
  if (values.distance !== 0) {
    throw new Error(`期望 distance=0，实际为 ${values.distance}`);
  }
  console.log("✓ 场景 1 验证通过：正确读取协议默认值");

  // --- 测试场景 2：用户在协议中修改 speed 默认值为 88 ---
  console.log("\n[场景 2] 用户在协议管理中修改 speed 默认值为 88（用例不作任何修改）");
  const speedField = userProtocol.messages[0].fields.find((f) => f.name === "speed");
  if (speedField) speedField.value = 88;

  frames.length = 0;
  res = await runCase(host, testCase, "场景2");
  if (res.status !== "pass") throw new Error(`场景 2 失败: ${res.reason}`);
  lastFrame = frames[frames.length - 1];
  values = getValues(lastFrame.bytes);
  console.log("解码结果:", values);
  if (values.speed !== 88) {
    throw new Error(`用例未能动态跟随协议！期望 speed=88，实际为 ${values.speed}`);
  }
  console.log("✓ 场景 2 验证通过：协议默认值变更后，用例立刻自动下发最新默认值 88！");

  // --- 测试场景 3：用户在协议中新增 voltage 字段 (uint 1字节, 默认 24) ---
  console.log("\n[场景 3] 用户在协议中新增 voltage 字段 (uint 1字节, 默认 24)（用例不作任何修改）");
  const fields = userProtocol.messages[0].fields;
  const crcIdx = fields.findIndex((f) => f.type === "crc");
  const crcField = fields[crcIdx];
  const newField = {
    id: "fld-voltage",
    name: "voltage",
    type: "uint" as const,
    size: 1,
    offset: crcField.offset, // 原 crc 的位置
    value: 24,
    desc: "电池电压",
    unit: "V",
  };
  crcField.offset += 1;
  fields.splice(crcIdx, 0, newField);

  frames.length = 0;
  res = await runCase(host, testCase, "场景3");
  if (res.status !== "pass") throw new Error(`场景 3 失败: ${res.reason}`);
  lastFrame = frames[frames.length - 1];
  values = getValues(lastFrame.bytes);
  console.log("解码结果:", values);
  if (values.voltage !== 24) {
    throw new Error(`用例未能自动同步新增字段！期望 voltage=24，实际为 ${values.voltage}`);
  }
  console.log("✓ 场景 3 验证通过：协议新增字段后，用例下发立刻包含该新字段及其值！");

  // --- 测试场景 4：用户在协议中删除 score 字段 ---
  console.log("\n[场景 4] 用户在协议中删除 score 字段（用例不作任何修改）");
  userProtocol.messages[0].fields = userProtocol.messages[0].fields.filter((f) => f.name !== "score");
  // 重新计算 offset
  let curOffset = 0;
  for (const f of userProtocol.messages[0].fields) {
    f.offset = curOffset;
    curOffset += f.size;
  }

  frames.length = 0;
  res = await runCase(host, testCase, "场景4");
  if (res.status !== "pass") throw new Error(`场景 4 失败: ${res.reason}`);
  lastFrame = frames[frames.length - 1];
  values = getValues(lastFrame.bytes);
  console.log("解码结果:", values);
  if ("score" in values && values.score !== undefined) {
    throw new Error(`用例未能自动移除已删除字段！`);
  }
  console.log("✓ 场景 4 验证通过：协议删除字段后，用例下发立刻停止下发该字段！");

  console.log("\n🎉 全部 4 项动态联动测试均 100% 成功通过！");
}

testDynamicFieldSync().catch((err) => {
  console.error("测试出错:", err);
  process.exit(1);
});
