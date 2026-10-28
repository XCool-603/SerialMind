/**
 * 新增功能验收：CSV 文件导入 / 报告趋势 / AI 测试连接
 * 运行： node scripts/test-newfeat.mjs（需 dev server 在 5273）
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

const tmp = join(process.cwd(), "scratch");
mkdirSync(tmp, { recursive: true });
const csvPath = join(tmp, "points.csv");
writeFileSync(csvPath, "want,note\n96,第一行\n96,第二行\n", "utf8");

const b = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://127.0.0.1:5273/", { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(2500);

// 环境：产品 + 子产品 + 连模拟设备 + 生成用例
await page.locator(".product-switch").first().click();
await page.locator(".menu-item", { hasText: "新建产品" }).click();
await page.locator(".dlg-input").first().fill("新功能验收");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(500);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(650);
await page.locator(".link-status").click();
await sleep(300);
await page.locator(".menu-item", { hasText: "模拟设备" }).click();
await sleep(200);
await page.locator(".menu-item", { hasText: "连接" }).click();
await sleep(700);
await page.locator(".tab", { hasText: "测试" }).click();
await sleep(700);
await page.locator(".btn-primary", { hasText: "一键生成示例用例" }).click();
await sleep(900);
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);

// ---- 1. CSV 文件导入 ----
console.log("\n[1] CSV 文件导入");
await page.locator(".side-tabs .chip", { hasText: "数据驱动" }).click();
await sleep(400);
const pickBtn = page.locator("button", { hasText: "选择 CSV 文件" });
ok("有「选择 CSV 文件」按钮", (await pickBtn.count()) === 1);
await page.setInputFiles('input[type="file"]', csvPath);
await sleep(700);
const csvText = await page.locator(".csv-input").inputValue();
ok("文件内容已填入编辑框", csvText.includes("want,note") && csvText.includes("第二行"), csvText.slice(0, 40));
const rowNote = await page.locator(".pdl-card-note", { hasText: "行数据" }).first().innerText();
ok("行数统计为 2", /2\s*行/.test(rowNote), rowNote);
// 弹窗确认
if (await page.locator(".dlg-foot .btn-primary").count()) {
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(400);
}
// 断言页的「绑定 CSV」应显示已绑定
await page.locator(".side-tabs .chip", { hasText: "断言" }).click();
await sleep(400);
const bindCard = await page.locator(".pdl-card", { hasText: "绑定 CSV" }).innerText();
ok("断言页显示已绑定 + 行数", /2\s*行/.test(bindCard), bindCard.replace(/\s+/g, " ").slice(0, 60));

// ---- 2. 运行设置：最长运行 / 失败即停 ----
console.log("\n[2] 运行设置新增项");
await page.locator(".side-tabs .chip", { hasText: "设置" }).click();
await sleep(400);
const settingText = await page.locator(".pdl-card", { hasText: "运行设置" }).innerText();
ok("有「最长运行」设置", /最长运行/.test(settingText), "");
ok("有「失败即停」开关", /失败即停/.test(settingText), "");
const maxInput = page.locator(".setting-row", { hasText: "最长运行" }).locator("input");
await maxInput.fill("2");
await sleep(500);
ok("最长运行可填写", (await maxInput.inputValue()) === "2", await maxInput.inputValue());

// ---- 3. 运行 → 报告趋势 ----
console.log("\n[3] 报告趋势");
await page.locator(".case-head-actions .btn-primary").click();
await sleep(4000);
const trend = page.locator(".panel", { hasText: "趋势" }).first();
ok("报告页有「趋势」面板", (await trend.count()) === 1);
const trendText = await trend.innerText();
ok("显示近 10 次通过率", /近 10 次通过率/.test(trendText), trendText.replace(/\s+/g, " ").slice(0, 80));
ok("显示平均响应", /平均响应/.test(trendText), "");
ok("显示累计发送", /累计发送/.test(trendText), "");
const bars = await trend.locator("span[title]").count();
ok("有趋势柱状图", bars >= 1, `${bars} 根柱`);

// ---- 4. AI 测试连接 ----
console.log("\n[4] AI 模型设置 / 测试连接");
await page.locator(".tab", { hasText: "终端" }).click();
await sleep(500);
await page.locator(".ai-switch").click();
await sleep(700);
await page.locator(".ai-panel button", { hasText: "模型设置" }).click();
await sleep(400);
ok("模型设置有三项", (await page.locator(".ai-cfg .dlg-row").count()) === 3);
const testBtn = page.locator(".ai-cfg button", { hasText: "测试连接" });
ok("有「测试连接」按钮", (await testBtn.count()) === 1);
await page.locator(".ai-cfg input[type=password]").fill("");
await testBtn.click();
await sleep(900);
const cfgText = await page.locator(".ai-cfg").innerText();
ok("没填 Key 时给出提示", /还没填 API Key/.test(cfgText), cfgText.replace(/\s+/g, " ").slice(-60));

await page.screenshot({ path: "docs/demo/live/12-newfeat.png" });
await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
