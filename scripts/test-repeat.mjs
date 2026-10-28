import { chromium } from "playwright";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? " — " + d : ""}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
await page.goto("http://127.0.0.1:5273/", { waitUntil: "networkidle" });
await sleep(1600);
// 页签简化
const tabs = await page.$$eval(".tab .label", (els) => els.map((e) => e.textContent.trim()));
ok("页签只剩 终端/协议/测试/报告（批量并入测试）", tabs.join(",") === "终端,协议,测试,报告", tabs.join(","));
// 建环境
await page.locator(".product-switch").first().click();
await page.locator(".menu-item", { hasText: "新建产品" }).click();
await page.locator(".dlg-input").first().fill("循环发送");
await page.locator(".dlg-foot .btn-primary").click(); await sleep(500);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click(); await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click(); await sleep(600);
await page.locator(".link-status").click(); await sleep(300);
await page.locator(".menu-item", { hasText: "模拟设备" }).click(); await sleep(200);
await page.locator(".menu-item", { hasText: "连接" }).click(); await sleep(700);
await page.locator(".tab", { hasText: "测试" }).click(); await sleep(700);
await page.locator(".btn-primary", { hasText: "一键生成示例用例" }).click(); await sleep(900);
await page.locator(".dlg-foot .btn-primary").click(); await sleep(600);
// 设置重复 3 次
await page.locator(".chip", { hasText: "设置" }).click(); await sleep(400);
const rep = page.locator(".setting-row", { hasText: "重复次数" }).locator("input");
ok("有重复次数设置", (await rep.count()) === 1);
await rep.fill("3"); await sleep(500);
// 运行
await page.locator(".case-head-actions .btn-primary").click();
await sleep(3500);
const statuses = await page.$$eval("tr[data-status]", (els) => els.map((e) => e.getAttribute("data-status")));
ok("3 轮循环发送后通过", statuses.includes("pass"), statuses.join(","));
await page.screenshot({ path: "docs/demo/46-repeat.png" });
await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
