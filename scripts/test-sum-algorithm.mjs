import { chromium } from "playwright";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? " — " + d : ""}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

await page.goto("http://127.0.0.1:5273/", { waitUntil: "networkidle" });
await sleep(1600);
ok("状态栏正常（无异常）", !(await page.locator(".statusbar").innerText()).includes("异常"), await page.locator(".statusbar").innerText());

await page.locator(".product-switch").first().click();
await page.locator(".menu-item", { hasText: "新建产品" }).click();
await page.locator(".dlg-input").first().fill("sum测试");
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

// 加一个 sum 字段
await page.locator(".pdl-main-head .btn", { hasText: "字段" }).click();
await sleep(400);
const rows = page.locator(".pdl-table .pdl-tr:not(.head)");
const last = rows.nth((await rows.count()) - 1);
await last.locator(".c-fname input").fill("sum");
await last.locator(".c-fsize input").fill("1");
await sleep(300);

// 打开 ⚙ → 类型改 crc → 同时选算法 ADD8
await last.locator(".c-fmore .mv-btn").first().click();
await sleep(500);
// 先把类型改成 crc
await page.locator(".dlg-row", { hasText: "类型" }).locator("select").selectOption("crc");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
// 再打开：crc 字段才有「校验算法」
await last.locator(".c-fmore .mv-btn").first().click();
await sleep(500);
const dlgRows = await page.locator(".dlg-row .dlg-label").allInnerTexts();
ok("crc 字段的 ⚙ 里有「校验算法」", dlgRows.some((t) => t.includes("校验算法")), dlgRows.join(" / "));
ok("crc 字段不再显示枚举/位段等无关项", !dlgRows.some((t) => t.includes("枚举")), dlgRows.join(" / "));
await page.locator(".dlg-row", { hasText: "校验算法" }).locator("select").selectOption("ADD8");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);

const badge = await page.locator(".pdl-table .pdl-tr:not(.head)").last().locator(".type-pill").innerText();
ok("sum 行显示算法", badge.includes("ADD8"), badge);

const activeAlg = await page.locator(".alg-chip.active").innerText();
ok("右侧算法面板同步为 ADD8", activeAlg.includes("ADD8"), activeAlg);

await page.locator(".page-actions .btn-primary", { hasText: "保存" }).click();
await sleep(700);
if (await page.locator(".modal-foot .btn", { hasText: "强制保存" }).count()) {
  await page.locator(".modal-foot .btn", { hasText: "强制保存" }).click();
  await sleep(500);
}
const preview = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase();
ok("组包预览自动补了 ADD8 = 5E", /DE 21 09 F6 60 00 00 00 5E/.test(preview), preview);
await page.screenshot({ path: "docs/demo/31-sum-algorithm.png" });

await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
