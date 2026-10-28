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
await page.locator(".dlg-input").first().fill("不匹配");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);

// 连模拟设备
await page.locator(".link-status").click();
await sleep(400);
await page.locator(".menu-item", { hasText: "模拟设备" }).click();
await sleep(300);
await page.locator(".menu-item", { hasText: "连接" }).click();
await sleep(800);

// 终端发一条 8 字节（协议要 9 字节）→ 回环收到不匹配帧
await page.locator(".tab", { hasText: "终端" }).click();
await sleep(600);
// 关掉自动校验，避免被补成 9 字节
const chip = page.locator(".sendbar .chip", { hasText: "自动校验" });
if ((await chip.count()) && (await chip.getAttribute("class")).includes("active")) await chip.click();
await sleep(300);
await page.locator(".send-input").fill("DB 24 07 F8 B0 F4 A2 7B");
await sleep(300);
await page.locator(".send-input-row .btn-primary").click();
await sleep(1200);

const termText = await page.locator(".term-list").innerText();
ok("出现「不符合当前协议」提示", termText.includes("不符合当前协议"), termText.replace(/\s+/g, " ").slice(0, 160));
ok("不再显示 CRC 校验失败", !termText.includes("CRC 校验失败"), termText.replace(/\s+/g, " ").slice(0, 160));
ok("提示里说明长度不符", /8 字节/.test(termText) && /9 字节/.test(termText), termText.replace(/\s+/g, " ").slice(0, 200));
ok("原始字节仍然显示", /DB 24 07 F8 B0 F4 A2 7B/.test(termText.replace(/\s+/g, " ").toUpperCase()), termText.replace(/\s+/g, " ").slice(0, 120));
const insp = await page.locator(".inspector").innerText();
ok("右侧检查器显示「不符合协议」", insp.includes("不符合协议"), insp.replace(/\s+/g, " ").slice(0, 120));
ok("检查器不再列出一堆错字段", !insp.includes("期望 DE 21"), insp.replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: "docs/demo/39-mismatch.png" });

await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
