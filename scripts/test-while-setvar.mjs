import { yamlToSteps } from "../src/engine/yaml.ts";
import { runCase } from "../src/engine/runner.ts";
import { bytesToString } from "../src/engine/bytes.ts";

console.log("=== 正在测试：用例内 while 与 setVar 闭环循环发送车辆得分与里程 ===");

const yamlSource = `
steps:
  - setVar: score = 0
  - setVar: distance = 0
  - while: score < 3, max 10
    do:
      - setVar: score = score + 1
      - setVar: distance = distance + 10
      - send: "SCORE:\${score},DIST:\${distance}\\r\\n"
      - delay: 50ms
`;

const parsed = yamlToSteps(yamlSource);
console.log("1. YAML 解析错误数:", parsed.errors.length);
if (parsed.errors.length) {
  console.error("解析错误:", parsed.errors);
  process.exit(1);
}

const sentMessages = [];
const mockFrames = [];
const host = {
  getProtocol: () => ({ id: "raw", name: "原始", version: "1.0", checksum: { algorithm: "none" }, messages: [] }),
  getFrames: () => mockFrames,
  pushFrame: (f) => mockFrames.push(f),
  write: async (bytes) => {
    const text = bytesToString(bytes);
    sentMessages.push(text);
    console.log(`   [串口实发] -> ${JSON.stringify(text)}`);
  },
  isLinkOpen: () => true,
};

const testCase = {
  id: "case_vehicle_loop",
  subProductId: "sp_v",
  name: "车辆行驶得分闭环测试",
  roleId: "r1",
  tags: ["车辆模拟"],
  status: "idle",
  statusText: "",
  stepCount: parsed.steps.length,
  assertionCount: 0,
  steps: parsed.steps,
  yaml: yamlSource,
};

async function run() {
  const res = await runCase(host, testCase, "车辆模拟套件");
  console.log("2. 用例运行状态:", res.status);
  console.log("3. 实际发送消息总数:", sentMessages.length);
  sentMessages.forEach((msg, idx) => {
    console.log(`   轮次 ${idx + 1}: ${msg.trim()}`);
  });

  const expected1 = "SCORE:1,DIST:10";
  const expected2 = "SCORE:2,DIST:20";
  const expected3 = "SCORE:3,DIST:30";

  const ok =
    sentMessages.length === 3 &&
    sentMessages[0].includes(expected1) &&
    sentMessages[1].includes(expected2) &&
    sentMessages[2].includes(expected3);

  if (ok && res.status === "pass") {
    console.log("=== 验证成功：while + setVar 闭环完美实现车辆得分(+1)与行走里程(+10)循环发送！===");
  } else {
    console.error("=== 验证失败！===");
    process.exit(1);
  }
}

run();
