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
await page.locator(".dlg-input").first().fill("尾部测试");
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

// 故意把 sum 放在中间
await page.locator(".pdl-main-head .btn", { hasText: "从样例帧建" }).click();
await sleep(400);
await page.locator(".modal .field-line", { hasText: "样例帧" }).locator("input").fill("DE 21 09 F6 60 00 00 00 5E");
await page.locator(".modal .field-line", { hasText: "切分" }).locator("input").fill("5:header,1:sum,1:车号,2:高低位");
await sleep(300);
await page.locator(".modal-foot .btn-primary").click();
await sleep(700);

// 把 sum 改成 crc 类型
const sumRow = page.locator(".pdl-table .pdl-tr:not(.head)").nth(1);
await sumRow.locator(".c-fmore .mv-btn").first().click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "类型" }).locator("select").selectOption("crc");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);

const names = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fname input", (els) => els.map((e) => e.value));
ok("sum 被自动挪到最后一排", names[names.length - 1] === "sum", names.join(" / "));

const offsets = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-off", (els) => els.map((e) => e.textContent));
ok("sum 的 offset 是帧尾（8）", offsets[offsets.length - 1] === "8", offsets.join(","));

const preview = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase();
ok("组包时 sum 在尾部 = 5E", /DE 21 09 F6 60 00 00 00 5E/.test(preview), preview);
await page.screenshot({ path: "docs/demo/33-sum-at-tail.png" });

await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
