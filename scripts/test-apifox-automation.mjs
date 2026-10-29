import { parseHex, toHex, stringToBytes, bytesToString, matchHexPattern } from "../src/engine/bytes.ts";
import { runCase } from "../src/engine/runner.ts";

console.log("=== 开始测试 Apifox 串口自动化高级能力（变量提取与传参） ===");

const mockFrames = [];
let lastSentText = "";
const host = {
  getProtocol: () => ({ id: "raw", name: "原始", version: "1.0", checksum: { algorithm: "none" }, messages: [] }),
  getFrames: () => mockFrames,
  pushFrame: (f) => {
    mockFrames.push({
      id: mockFrames.length + 1,
      time: "12:00:00.000",
      ts: Date.now(),
      no: mockFrames.length + 1,
      ...f,
    });
  },
  write: async (bytes) => {
    lastSentText = bytesToString(bytes);
    if (lastSentText.includes("AT+CSQ")) {
      setTimeout(() => {
        host.pushFrame({
          dir: "rx",
          source: "device",
          bytes: stringToBytes("+CSQ: 31,99\r\nOK\r\n"),
          crcOk: true,
        });
      }, 10);
    }
  },
  isLinkOpen: () => true,
};

const testCase = {
  id: "case_apifox_demo_chain",
  subProductId: "sp1",
  name: "Apifox 动态变量传参业务链测试",
  roleId: "r1",
  tags: ["自动化"],
  status: "idle",
  statusText: "",
  stepCount: 4,
  assertionCount: 2,
  steps: [
    {
      id: "s1",
      kind: "send",
      text: "发送查询信号",
      detail: "AT+CSQ\r\n",
      sendMode: "text",
    },
    {
      id: "s2",
      kind: "extract",
      text: "提取信号强度到变量 csq",
      targetVar: "csq",
      extractType: "regex",
      extractRule: "\\+CSQ:\\s*(\\d+)",
      timeout: "500ms",
      fields: [{ label: "csq", value: "\\+CSQ:\\s*(\\d+)" }],
    },
    {
      id: "s3",
      kind: "send",
      text: "使用提取的变量下发功率指令",
      detail: "AT+SET_POWER=${csq}\r\n",
      sendMode: "text",
    },
    {
      id: "s4",
      kind: "assert",
      text: "断言第1次回显包含 OK",
      fields: [{ label: "contains", value: "OK" }],
      timeout: "500ms",
    },
  ],
  yaml: "",
};

async function main() {
  const res = await runCase(host, testCase, "Apifox 链路套件");
  console.log("用例执行结论:", res.status);
  res.items.forEach((it, i) => {
    console.log(`[${it.status.toUpperCase()}] 步骤 ${i + 1}: ${it.text} | 实际: ${it.actual}`);
  });
  console.log("最后发出的文本报文:", JSON.stringify(lastSentText));
  if (res.status === "pass" && lastSentText.includes("AT+SET_POWER=31")) {
    console.log("=== 动态参数提取并注入下一条指令 验证完全通过！===");
  } else {
    console.error("=== 验证失败！===");
    process.exit(1);
  }
}

main();
