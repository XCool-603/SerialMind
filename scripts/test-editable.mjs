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
await page.locator(".dlg-input").first().fill("可编辑");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
await page.locator(".tab", { hasText: "协议" }).click();
await sleep(700);

// 调试面板：header 现在应该可编辑
const headerField = page.locator(".pdbg-field", { hasText: "header" });
ok("header 是可编辑输入框", (await headerField.locator("input").count()) === 1);
await headerField.locator("input").fill("AA 55");
await sleep(500);
const p1 = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase();
ok("改 header 后预览变成 AA 55", p1.startsWith("AA 55"), p1);

// 自动字段仍只读
const lenField = page.locator(".pdbg-field", { hasText: "len" }).first();
ok("len 仍只读（自动）", (await lenField.locator(".pdbg-fixed").count()) === 1, await lenField.innerText());
const sumField = page.locator(".pdbg-field", { hasText: "sum" });
ok("sum 仍只读（自动）", (await sumField.locator(".pdbg-fixed").count()) === 1);

// 字段拖拽排序
const names = async () => page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fname input", (els) => els.map((e) => e.value));
const before = await names();
const row0 = page.locator(".pdl-table .pdl-tr:not(.head)").nth(0);
const row2 = page.locator(".pdl-table .pdl-tr:not(.head)").nth(2);
await row0.dragTo(row2);
await sleep(600);
const after = await names();
ok("字段拖拽后顺序变了", after[0] !== before[0], `${before.slice(0,3).join(",")} → ${after.slice(0,3).join(",")}`);
await page.screenshot({ path: "docs/demo/36-editable-debug.png" });
await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
