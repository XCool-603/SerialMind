/**
 * 自动化测试端到端验收：用例能真跑通（模拟设备回环）
 * 运行： node scripts/test-automation.mjs
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

/** 加一个步骤 */
const addStep = async (kind, field, value, timeout = "3s") => {
  await page.locator(".steps-head .btn", { hasText: "步骤" }).click();
  await sleep(500);
  await page.locator(".dlg-row", { hasText: "类型" }).locator("select").selectOption(kind);
  await page.locator(".dlg-row", { hasText: "字段" }).locator("input").fill(field);
  await page.locator(".dlg-row", { hasText: "值 / 断言 / 条件" }).locator("input").fill(value);
  await page.locator(".dlg-row", { hasText: "超时" }).locator("input").fill(timeout);
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(500);
};

try {
  await page.goto("http://127.0.0.1:5273/", { waitUntil: "networkidle" });
  await sleep(1600);

  console.log("\n[1] 建产品 / 子产品（PLC 模板）/ 连模拟设备");
  await page.locator(".product-switch").first().click();
  await page.locator(".menu-item", { hasText: "新建产品" }).click();
  await page.locator(".dlg-input").first().fill("自动化");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(600);
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("起升");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);

  await page.locator(".link-status").click();
  await sleep(400);
  await page.locator(".menu-item", { hasText: "模拟设备" }).click();
  await sleep(300);
  await page.locator(".menu-item", { hasText: "连接" }).click();
  await sleep(800);
  ok("模拟设备已连接", (await page.locator(".link-status").innerText()).includes("已连接"));

  console.log("\n[2] 新建用例并加 2 个步骤");
  await page.locator(".tab", { hasText: "测试" }).click();
  await sleep(800);
  const emptyBtn = page.locator(".empty-block .btn", { hasText: "新建空用例" });
  if (await emptyBtn.count()) await emptyBtn.click();
  else await page.locator(".search-box .add-btn").click();
  await sleep(400);
  await page.locator(".dlg-input").first().fill("心跳回环");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(800);
  ok("用例已创建", (await page.locator(".case-card-name").count()) >= 1);

  await addStep("send", "raw", "DE 21 09 F6 60 01 00 00 5F", "3s");
  await addStep("expect", "cmd", "equals 96", "2s");
  const stepCount = await page.locator(".step-row").count();
  ok("2 个步骤已加入", stepCount === 2, `${stepCount} 个`);

  console.log("\n[3] 运行用例 → 应真实通过");
  await page.locator(".case-head-actions .btn-primary").click();
  await sleep(2500);
  ok("跳转到报告页", (await page.locator(".page-title").first().innerText()).includes("报告"));
  const passed = await page.locator(".dt tbody tr").count();
  ok("报告有 1 条结果", passed >= 1, `${passed} 条`);
  const passRows = await page.locator('tr[data-status="pass"]').count();
  ok("结果是「通过」", passRows === 1, `${passRows} 条通过`);
  await page.screenshot({ path: "docs/demo/42-automation-pass.png" });

  console.log("\n[4] 失败用例必须真失败（断言不成立）");
  await page.locator(".tab", { hasText: "测试" }).click();
  await sleep(700);
  await addStep("expect", "cmd", "equals 1", "500ms");
  await sleep(300);
  await page.locator(".case-head-actions .btn-primary").click();
  await sleep(2500);
  const failRows = await page.locator('tr[data-status="fail"]').count();
  const failText = await page.locator('tr[data-status="fail"]').first().innerText().catch(() => "");
  ok("断言不成立 → 结果失败", failRows === 1, `${failRows} 条失败 · ${failText.replace(/\s+/g, " ").slice(0, 80)}`);
  await page.screenshot({ path: "docs/demo/43-automation-fail.png" });

  console.log("\n[5] 报告在刷新后保留");
  await page.reload({ waitUntil: "networkidle" });
  await sleep(2000);
  await page.locator(".tab", { hasText: "报告" }).click();
  await sleep(800);
  const afterReload = await page.locator(".dt tbody tr").count();
  ok("刷新后报告仍在", afterReload >= 1, `${afterReload} 条`);
} finally {
  await browser.close();
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
console.log("自动化测试链路已打通 ✅");
