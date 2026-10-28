/**
 * 收发链路验证（用「模拟设备」回环，不需要真实硬件）
 * 覆盖：连接 → 发送 → 分帧 → 按当前协议解析 → 终端显示
 * 运行： node scripts/test-serial-mock.mjs
 */
import { chromium } from "playwright";

let pass = 0;
let fail = 0;
const ok = (n, c, d = "") => {
  if (c) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    console.log(`  ✗ ${n}${d ? " — " + d : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

try {
  await page.goto("http://127.0.0.1:5273/", { waitUntil: "networkidle" });
  await sleep(1600);

  console.log("\n[1] 建产品 / 子产品 / 协议（三字段）");
  await page.locator(".product-switch").first().click();
  await page.locator(".menu-item", { hasText: "新建产品" }).click();
  await page.locator(".dlg-input").first().fill("联调");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(600);
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("车载");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  await page.locator(".tab", { hasText: "协议" }).click();
  await sleep(500);
  await page.locator(".pdl-main-head .btn", { hasText: "从样例帧建" }).click();
  await sleep(400);
  await page.locator(".modal .field-line", { hasText: "样例帧" }).locator("input").fill("DE 21 09 F6 60 00 00 00");
  await page.locator(".modal .field-line", { hasText: "切分" }).locator("input").fill("5:header,1:车号,2:高低位");
  await sleep(300);
  await page.locator(".modal-foot .btn-primary").click();
  await sleep(700);
  await page.locator(".page-actions .btn-primary", { hasText: "保存" }).click();
  await sleep(600);
  if (await page.locator(".modal-foot .btn", { hasText: "强制保存" }).count()) {
    await page.locator(".modal-foot .btn", { hasText: "强制保存" }).click();
    await sleep(500);
  }

  console.log("\n[2] 连接模拟设备");
  await page.locator(".link-status").click();
  await sleep(400);
  await page.locator(".menu-item", { hasText: "模拟设备" }).click();
  await sleep(300);
  await page.locator(".menu-item", { hasText: "连接" }).click();
  await sleep(800);
  const chip = await page.locator(".link-status").innerText();
  ok("顶栏显示已连接", chip.includes("已连接"), chip.replace(/\s+/g, " "));
  ok("端口是模拟设备", chip.includes("模拟"), chip.replace(/\s+/g, " "));

  console.log("\n[3] 从协议调试面板发送 → 回环收到 RX");
  const before = await page.locator(".pdbg-row").count();
  await page.locator(".pdbg-send .btn-primary").click();
  await sleep(1200);
  const after = await page.locator(".pdbg-row").count();
  ok("收发记录增加", after > before, `${before} → ${after}`);

  const rows = await page.locator(".pdbg-row").allInnerTexts();
  const rxRow = rows.find((r) => r.includes("RX"));
  const txRow = rows.find((r) => r.includes("TX"));
  ok("有 TX 记录", !!txRow, txRow?.replace(/\s+/g, " ").slice(0, 60));
  ok("有 RX 记录（回环生效）", !!rxRow, rxRow?.replace(/\s+/g, " ").slice(0, 60));
  ok("RX 帧内容正确", /DE 21 09 F6 60/.test(rxRow ?? ""), rxRow?.replace(/\s+/g, " ").slice(0, 80));
  ok("按当前协议解析出字段", /车号=0/.test(rxRow ?? ""), rxRow?.replace(/\s+/g, " ").slice(0, 100));
  ok("没有 CRC 误报", !(rxRow ?? "").includes("CRC 校验失败"), rxRow?.replace(/\s+/g, " ").slice(0, 80));

  console.log("\n[4] 终端页也显示同样的帧 + 当前协议");
  await page.locator(".tab", { hasText: "终端" }).click();
  await sleep(700);
  const pill = await page.locator(".term-toolbar .pill").first().innerText();
  ok("终端显示解析协议", pill.includes("解析协议"), pill);
  ok("终端显示的是自建协议", !pill.includes("Modbus"), pill);
  const msgRows = await page.locator(".term-list .msg-row").count();
  ok("终端有报文", msgRows >= 2, `${msgRows} 条`);
  const termText = await page.locator(".term-list").innerText();
  ok("终端能看到 RX 帧", /DE 21 09 F6 60/.test(termText), termText.replace(/\s+/g, " ").slice(0, 80));
  await page.screenshot({ path: "docs/demo/28-mock-loopback.png" });

  console.log("\n[5] 顶栏计数器是真实增长");
  const rxCount = await page.locator(".counter-value").first().innerText();
  const txCount = await page.locator(".counter-value").nth(1).innerText();
  ok("RX 计数 > 0", Number(rxCount) > 0, rxCount);
  ok("TX 计数 > 0", Number(txCount) > 0, txCount);

  console.log("\n[6] 断开后不再收");
  await page.locator(".link-status").click();
  await sleep(400);
  await page.locator(".menu-item", { hasText: "断开连接" }).click();
  await sleep(600);
  const chip2 = await page.locator(".link-status").innerText();
  ok("顶栏显示未连接", chip2.includes("未连接"), chip2.replace(/\s+/g, " "));
} finally {
  await browser.close();
}

console.log(`\n${"=".repeat(48)}`);
const passed = pass;
console.log(`结果：${passed}/${pass + fail} 通过`);
if (fail) process.exit(1);
console.log("收发链路已打通（模拟设备回环）✅");
