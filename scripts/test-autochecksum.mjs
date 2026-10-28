/**
 * 终端「自动校验」验证：不依赖协议里是否配了 crc 字段
 * 运行： node scripts/test-autochecksum.mjs
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

  console.log("\n[1] 建一个「没有 crc 字段」的三字段协议");
  await page.locator(".product-switch").first().click();
  await page.locator(".menu-item", { hasText: "新建产品" }).click();
  await page.locator(".dlg-input").first().fill("校验测试");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(600);
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
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
  const hasCrc = await page.locator(".pdl-table .pdl-tr:not(.head) .type-pill", { hasText: "crc" }).count();
  ok("协议里确实没有 crc 字段", hasCrc === 0, `${hasCrc} 个`);

  console.log("\n[2] 终端发送框：自动校验开关 + 算法选择");
  await page.locator(".tab", { hasText: "终端" }).click();
  await sleep(600);
  const autoChip = page.locator(".sendbar .chip", { hasText: "自动校验" });
  ok("有自动校验开关", (await autoChip.count()) === 1);
  const algSel = page.locator(".sendbar select");
  ok("有算法下拉", (await algSel.count()) === 1);
  const alg = await algSel.inputValue();
  ok("默认算法有值", !!alg, alg);

  console.log("\n[3] 发送裸 HEX → 自动补校验（无 crc 字段也生效）");
  await page.locator(".send-input").fill("DE 21 09 F6 60 00 00 00");
  await sleep(300);
  await page.locator(".send-input-row .btn-primary").click();
  await sleep(900);
  const termText = await page.locator(".term-list").innerText();
  ok(
    "补了 1 字节 SUM8（…5E）",
    /DE 21 09 F6 60 00 00 00 5E/.test(termText),
    termText.replace(/\s+/g, " ").slice(0, 110),
  );

  console.log("\n[4] 换成 CRC16/MODBUS → 补 2 字节");
  await algSel.selectOption("CRC16/MODBUS");
  await sleep(400);
  await page.locator(".send-input").fill("DE 21 09 F6 60 00 00 00");
  await sleep(300);
  await page.locator(".send-input-row .btn-primary").click();
  await sleep(900);
  const rows = await page.locator(".term-list .msg-row").allInnerTexts();
  const last = rows[rows.length - 1] ?? "";
  ok("补了 2 字节 CRC16（共 10 字节）", /(?:[0-9A-F]{2}\s+){9}[0-9A-F]{2}/.test(last.replace(/\s+/g, " ")), last.replace(/\s+/g, " ").slice(0, 110));

  console.log("\n[5] 关掉开关 → 原样发送");
  await autoChip.click();
  await sleep(400);
  await page.locator(".send-input").fill("DE 21 09 F6 60 00 00 00");
  await sleep(300);
  await page.locator(".send-input-row .btn-primary").click();
  await sleep(900);
  const rows2 = await page.locator(".term-list .msg-row").allInnerTexts();
  const last2 = rows2[rows2.length - 1] ?? "";
  ok("关掉后是 8 字节原样", !/DE 21 09 F6 60 00 00 00 [0-9A-F]{2}/.test(last2), last2.replace(/\s+/g, " ").slice(0, 90));

  await page.screenshot({ path: "docs/demo/29-autochecksum.png" });
} finally {
  await browser.close();
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
console.log("终端自动校验已生效（不依赖协议 crc 字段）✅");
