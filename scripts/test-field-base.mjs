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
await page.locator(".dlg-input").first().fill("进制切换");
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

// data1 是 2 字节：切到十进制，填 530 → 02 12
const data1 = page.locator(".pdbg-field", { hasText: "data1" });
ok("data1 有 HEX/进制切换按钮", (await data1.locator(".pdbg-fmt").count()) === 1);
ok("默认是 HEX", (await data1.locator(".pdbg-fmt").innerText()).includes("HEX"), await data1.locator(".pdbg-fmt").innerText());
await data1.locator(".pdbg-fmt").click();
await sleep(400);
ok("切换后显示 10进制", (await data1.locator(".pdbg-fmt").innerText()).includes("10"), await data1.locator(".pdbg-fmt").innerText());
await data1.locator("input").fill("530");
await sleep(500);
const preview = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase().trim();
ok("530 自动转成 02 12", preview.includes("02 12"), preview);
ok("整帧正确（DE 21 09 F6 60 01 02 12 xx）", preview.startsWith("DE 21 09 F6 60 01 02 12"), preview);

// 切回 HEX 看显示
await data1.locator(".pdbg-fmt").click();
await sleep(400);
const hexVal = await data1.locator("input").inputValue();
ok("切回 HEX 显示 0212", hexVal.toUpperCase() === "0212", hexVal);

// 单字节字段也可以切
const cmd = page.locator(".pdbg-field", { hasText: "cmd" });
await cmd.locator(".pdbg-fmt").click();
await sleep(300);
await cmd.locator("input").fill("150");
await sleep(500);
const p2 = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase().trim();
ok("cmd=150 十进制 → 0x96", p2.includes("F6 96"), p2);
await page.screenshot({ path: "docs/demo/37-field-base.png" });

await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
