import { runCase, type RunnerHost } from "../src/engine/runner";
import { HEARTBEAT_PROTOCOL, VEHICLE_WALK_PROTOCOL } from "../src/engine/pdl";
import { toHex } from "../src/engine/bytes";
import type { CaseItem, Frame } from "../src/engine/types";

async function main() {
  console.log("=== 验证用户场景：用例直接从「我添加的协议」中选（心跳协议 + 车辆行走协议） ===");

  const txBytesList: number[][] = [];
  const frames: Frame[] = [];

  const host: RunnerHost = {
    getProtocol: () => HEARTBEAT_PROTOCOL,
    getAllProtocols: () => [HEARTBEAT_PROTOCOL, VEHICLE_WALK_PROTOCOL],
    getFrames: () => frames,
    pushFrame: (f) => {
      const frame: Frame = {
        id: frames.length + 1,
        time: "12:00:00",
        ts: Date.now(),
        no: frames.length + 1,
        ...f,
      };
      frames.push(frame);
      if (f.dir === "tx") txBytesList.push(f.bytes);
    },
    write: async (_b) => {},
    isLinkOpen: () => true,
    autoChecksum: () => true,
  };

  // 用户在图形界面中配置的用例：每个动作直接绑定用户添加的协议
  const testCase: CaseItem = {
    id: "case-user-scenario",
    subProductId: "sp-crane",
    name: "车辆行驶与心跳持续上报测试",
    roleId: "role-1",
    tags: ["车辆", "冒烟"],
    status: "idle",
    statusText: "未运行",
    stepCount: 2,
    assertionCount: 0,
    steps: [],
    yaml: "",
    repeat: 3, // 运行 3 轮
    intervalMs: 10,
    // 动作 1：选择「心跳协议」；动作 2：选择「车辆行走协议」
    actions: [
      {
        id: "act-heartbeat",
        name: "每秒发送心跳",
        protocolId: HEARTBEAT_PROTOCOL.id, // 从添加的协议中选
        intervalMs: 1000,
        enabled: true,
        fields: [
          { fieldName: "addr", initValue: 1, step: 0 },
          { fieldName: "func", initValue: 1, step: 0 },
          { fieldName: "seq", initValue: 1, step: 0 },
        ],
      },
      {
        id: "act-vehicle-walk",
        name: "每秒车辆行走+10米",
        protocolId: VEHICLE_WALK_PROTOCOL.id, // 从添加的协议中选
        intervalMs: 1000,
        enabled: true,
        fields: [
          { fieldName: "addr", initValue: 1, step: 0 },
          { fieldName: "func", initValue: 2, step: 0 },
          { fieldName: "distance", initValue: 0, step: 10 }, // 距离每秒 +10
          { fieldName: "speed", initValue: 20, step: 0 },
          { fieldName: "score", initValue: 100, step: 0 },
        ],
      },
    ],
  };

  const result = await runCase(host, testCase, "多协议下发执行");

  console.log(`执行状态: ${result.status}`);
  console.log(`执行步骤数: ${result.items.length}`);

  if (result.status !== "pass") {
    console.error("执行失败:", result.reason);
    process.exit(1);
  }

  // 验证共发出了 3 轮 * 2 个协议 = 6 帧数据
  if (txBytesList.length !== 6) {
    console.error(`期望发出 6 帧，实际发出 ${txBytesList.length} 帧`);
    process.exit(1);
  }

  // 轮次 1:
  console.log(`[第1轮] 心跳协议帧: ${toHex(txBytesList[0])}`);
  console.log(`[第1轮] 行走协议帧: ${toHex(txBytesList[1])}`);

  // 轮次 2:
  console.log(`[第2轮] 心跳协议帧: ${toHex(txBytesList[2])}`);
  console.log(`[第2轮] 行走协议帧: ${toHex(txBytesList[3])}`);

  // 轮次 3:
  console.log(`[第3轮] 心跳协议帧: ${toHex(txBytesList[4])}`);
  console.log(`[第3轮] 行走协议帧: ${toHex(txBytesList[5])}`);

  // 检查距离字段是否有变化
  const d0 = (txBytesList[1][2] << 8) | txBytesList[1][3];
  const d1 = (txBytesList[3][2] << 8) | txBytesList[3][3];
  const d2 = (txBytesList[5][2] << 8) | txBytesList[5][3];

  console.log(`验证行走协议距离变化: 第1轮=${d0}米, 第2轮=${d1}米, 第3轮=${d2}米`);

  // 验证终端帧记录的协议名称
  const pNames = frames.map((f) => f.protocolName);
  console.log(`终端显示的协议名称: ${JSON.stringify(pNames)}`);

  if (d0 === 0 && d1 === 10 && d2 === 20 && pNames[0] === "心跳协议" && pNames[1] === "车辆行走协议") {
    console.log("✓ 两个独立添加的协议下发成功，距离每秒+10米递增，终端完全识别并显示对应的协议名称！");
    console.log("=== 全部场景验证通过 ===");
  } else {
    console.error("验证未全部通过！");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
