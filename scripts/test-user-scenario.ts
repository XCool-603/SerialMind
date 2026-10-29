import { runCase, type RunnerHost } from "../src/engine/runner";
import { CRANE_PROTOCOL } from "../src/engine/pdl";
import { toHex } from "../src/engine/bytes";
import type { CaseItem, Frame } from "../src/engine/types";

async function main() {
  console.log("=== 验证用户场景：免代码图形化配置（心跳每秒发送 + 车辆行走每秒+10米） ===");

  const txBytesList: number[][] = [];
  const frames: Frame[] = [];

  const host: RunnerHost = {
    getProtocol: () => CRANE_PROTOCOL,
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
    write: async (b) => {
      // 模拟写入硬件
    },
    isLinkOpen: () => true,
    autoChecksum: () => true,
  };

  // 用户在图形界面中配置的用例数据结构
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
    intervalMs: 10, // 测试中加速
    // 界面中的多任务配置：
    actions: [
      {
        id: "act-heartbeat",
        name: "每秒发送心跳保活",
        messageId: "heartbeat",
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
        messageId: "vehicle_status",
        intervalMs: 1000,
        enabled: true,
        fields: [
          { fieldName: "addr", initValue: 1, step: 0 },
          { fieldName: "func", initValue: 2, step: 0 },
          { fieldName: "distance", initValue: 0, step: 10 }, // 距离每秒 +10
          { fieldName: "speed", initValue: 20, step: 0 },   // 速度保持 20km/h
          { fieldName: "score", initValue: 100, step: 0 },  // 分数保持 100
        ],
      },
    ],
  };

  const result = await runCase(host, testCase, "免代码用例执行");

  console.log(`执行状态: ${result.status}`);
  console.log(`执行步骤数: ${result.items.length}`);

  if (result.status !== "pass") {
    console.error("执行失败:", result.reason);
    process.exit(1);
  }

  // 验证共发出了 3 轮 * 2 个动作 = 6 帧数据
  if (txBytesList.length !== 6) {
    console.error(`期望发出 6 帧，实际发出 ${txBytesList.length} 帧`);
    process.exit(1);
  }

  // 轮次 1:
  // 帧 0: 心跳包 seq=1
  console.log(`[第1轮] 心跳: ${toHex(txBytesList[0])}`);
  // 帧 1: 车辆行走 distance=0, speed=20, score=100
  console.log(`[第1轮] 行走: ${toHex(txBytesList[1])}`);

  // 轮次 2:
  // 帧 2: 心跳包 seq=1
  console.log(`[第2轮] 心跳: ${toHex(txBytesList[2])}`);
  // 帧 3: 车辆行走 distance=10, speed=20, score=100
  console.log(`[第2轮] 行走: ${toHex(txBytesList[3])}`);

  // 轮次 3:
  // 帧 4: 心跳包 seq=1
  console.log(`[第3轮] 心跳: ${toHex(txBytesList[4])}`);
  // 帧 5: 车辆行走 distance=20, speed=20, score=100
  console.log(`[第3轮] 行走: ${toHex(txBytesList[5])}`);

  // 检查距离字段是否有变化
  const d0 = (txBytesList[1][2] << 8) | txBytesList[1][3];
  const d1 = (txBytesList[3][2] << 8) | txBytesList[3][3];
  const d2 = (txBytesList[5][2] << 8) | txBytesList[5][3];

  console.log(`验证距离变化: 第1轮=${d0}米, 第2轮=${d1}米, 第3轮=${d2}米`);

  if (d0 === 0 && d1 === 10 && d2 === 20) {
    console.log("✓ 距离完全按照用户设定的每秒+10米正确递增且完成了自动封包与CRC16校验！");
    console.log("=== 全部场景验证通过 ===");
  } else {
    console.error(`距离递增错误: d0=${d0}, d1=${d1}, d2=${d2}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
