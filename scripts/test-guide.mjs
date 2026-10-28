import { chromium } from "playwright";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? " — " + d : ""}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
await page.goto("http://127.0.0.1:5273/", { waitUntil: "networkidle" });
await sleep(1600);
await page.locator(".product-switch").first().click();
await page.locator(".menu-item", { hasText: "新建产品" }).click();
await page.locator(".dlg-input").first().fill("起重机");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("起升控制");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
// 连模拟设备
await page.locator(".link-status").click(); await sleep(300);
await page.locator(".menu-item", { hasText: "模拟设备" }).click(); await sleep(200);
await page.locator(".menu-item", { hasText: "连接" }).click(); await sleep(700);
// 用例页：应有引导卡 + 一键生成
await page.locator(".tab", { hasText: "测试" }).click();
await sleep(800);
ok("有快速开始面板", (await page.locator(".quickstart").count()) === 1);
ok("快速开始有 4 步", (await page.locator(".qs-step").count()) === 4);
ok("有一键生成按钮", (await page.locator(".btn-primary", { hasText: "一键生成示例用例" }).count()) === 1);
await page.screenshot({ path: "docs/demo/45-guide.png" });
// 点它
await page.locator(".btn-primary", { hasText: "一键生成示例用例" }).click();
await sleep(1000);
const dlgTitle = await page.locator(".dlg-title").innerText().catch(() => "");
ok("弹出示例说明", dlgTitle.includes("示例用例已生成"), dlgTitle);
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
ok("生成了 2 个步骤", (await page.locator(".step-row").count()) === 2, `${await page.locator(".step-row").count()} 个`);
// 直接运行
await page.locator(".case-head-actions .btn-primary").click();
await sleep(3000);
const statuses = await page.$$eval("tr[data-status]", (els) => els.map((e) => e.getAttribute("data-status")));
const rowText = await page.locator("tr[data-status]").first().innerText().catch(() => "");
console.log("    报告:", statuses.join(","), "|", rowText.replace(/\s+/g, " ").slice(0, 120));
ok("示例用例能跑通", statuses.includes("pass"), `状态 ${statuses.join(",")}`);
await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
