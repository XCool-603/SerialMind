import { encodeMessage } from "../src/engine/codec.ts";
import { runCase } from "../src/engine/runner.ts";
import { toHex } from "../src/engine/bytes.ts";

console.log("=== 测试：用例直接从产品协议中改字段初始值与步进增量 ===");

// 1. 模拟车辆控制协议
const vehicleProto = {
  id: "proto_vehicle",
  name: "车辆控制协议",
  version: "1.0",
  framing: { mode: "silence-gap", gapMs: 20 },
  checksum: { algorithm: "ADD8", from: 0, to: "len-1", endian: "big" },
  messages: [
    {
      id: "msg_vehicle_status",
      name: "车辆状态与得分帧",
      fields: [
        { id: "f1", name: "header", offset: 0, size: 2, type: "hex", value: "0xDE21" },
        { id: "f2", name: "score", offset: 2, size: 1, type: "uint8", value: 0 },
        { id: "f3", name: "distance", offset: 3, size: 2, type: "uint16", byteOrder: "ABCD", value: 0 },
        { id: "f4", name: "speed", offset: 5, size: 1, type: "uint8", value: 20 },
        { id: "f5", name: "crc", offset: 6, size: 1, type: "crc" },
      ],
    },
  ],
};

const sentHexList = [];
const host = {
  getProtocol: () => vehicleProto,
  getFrames: () => [],
  pushFrame: () => {},
  write: async (bytes) => {
    const hex = toHex(bytes);
    sentHexList.push(hex);
    console.log(`   [串口下发] -> ${hex}`);
  },
  isLinkOpen: () => true,
};

// 2. 用例：无需写 YAML，直接在用例中配置协议字段的初始值与每轮加多少！
const vehicleCase = {
  id: "case_vehicle_proto_driven",
  subProductId: "sp1",
  name: "车辆得分+1 行走+10米协议下发",
  roleId: "r1",
  tags: ["车辆"],
  status: "idle",
  statusText: "",
  stepCount: 1,
  assertionCount: 0,
  repeat: 3,
  intervalMs: 50,
  targetMessageId: "msg_vehicle_status",
  fieldRules: [
    { fieldName: "score", initValue: 0, step: 1 },       // 分数每秒 +1
    { fieldName: "distance", initValue: 0, step: 10 },    // 行走每秒 +10
    { fieldName: "speed", initValue: 20, step: 0 },       // 车速保持 20 不变
  ],
  steps: [],
  yaml: "",
};

async function main() {
  const res = await runCase(host, vehicleCase, "协议驱动套件");
  console.log("执行结论:", res.status);
  console.log("实际下发帧数:", sentHexList.length);

  // 验证 3 轮报文
  // 帧头 DE 21 (2B)
  // 第1轮: score=0 (00), distance=0 (00 00), speed=20 (14) -> DE+21+00+00+00+14 = 0x113 & 0xFF = 0x13
  // 第2轮: score=1 (01), distance=10 (00 0A), speed=20 (14) -> DE+21+01+00+0A+14 = 0x11E & 0xFF = 0x1E
  // 第3轮: score=2 (02), distance=20 (00 14), speed=20 (14) -> DE+21+02+00+14+14 = 0x129 & 0xFF = 0x29
  console.log("第 1 轮真实发出的 HEX:", sentHexList[0]);
  console.log("第 2 轮真实发出的 HEX:", sentHexList[1]);
  console.log("第 3 轮真实发出的 HEX:", sentHexList[2]);

  const ok =
    sentHexList.length === 3 &&
    sentHexList[0].startsWith("DE 21 00 00 00 14") &&
    sentHexList[1].startsWith("DE 21 01 00 0A 14") &&
    sentHexList[2].startsWith("DE 21 02 00 14 14");

  if (ok && res.status === "pass") {
    console.log("=== 协议字段驱动自动化 100% 验证通过！===");
  } else {
    console.error("=== 验证失败！===");
    process.exit(1);
  }
}

main();
