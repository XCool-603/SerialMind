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
await page.locator(".dlg-input").first().fill("全字段切换");
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

// 每个字段都有切换按钮
const fieldCount = await page.locator(".pdbg-field").count();
const fmtCount = await page.locator(".pdbg-fmt").count();
ok("所有字段都有进制切换按钮", fieldCount === fmtCount && fieldCount === 7, `${fmtCount}/${fieldCount}`);

// 自动字段：切换后显示数值
const lenField = page.locator(".pdbg-field", { hasText: "len" }).first();
const lenHex = (await lenField.locator(".pdbg-fixed").innerText()).trim();
ok("len 默认显示 HEX 09", lenHex.startsWith("09"), lenHex);
await lenField.locator(".pdbg-fmt").click();
await sleep(400);
const lenDec = (await lenField.locator(".pdbg-fixed").innerText()).trim();
ok("len 切十进制显示 9", lenDec.startsWith("9"), lenDec);

// sum 也能切
const sumField = page.locator(".pdbg-field", { hasText: "sum" });
await sumField.locator(".pdbg-fmt").click();
await sleep(400);
const sumDec = (await sumField.locator(".pdbg-fixed").innerText()).trim();
ok("sum 切十进制显示 95", sumDec.startsWith("95"), sumDec);

// header（固定字节）切十进制
const headerField = page.locator(".pdbg-field", { hasText: "header" });
await headerField.locator(".pdbg-fmt").click();
await sleep(400);
const hv = await headerField.locator("input").inputValue();
ok("header 十进制 = 56865（DE21）", Number(hv) === 0xde21, hv);
await headerField.locator("input").fill("4660");
await sleep(500);
const p = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase();
ok("改十进制 4660 → 12 34", p.includes("12 34"), p);

// 枚举字段也应有按钮（PLC 模板没枚举，跳过）
await page.screenshot({ path: "docs/demo/38-all-base.png" });
await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
