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
await page.locator(".dlg-input").first().fill("数据驱动");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
await page.locator(".link-status").click(); await sleep(300);
await page.locator(".menu-item", { hasText: "模拟设备" }).click(); await sleep(200);
await page.locator(".menu-item", { hasText: "连接" }).click(); await sleep(700);

await page.locator(".tab", { hasText: "测试" }).click(); await sleep(700);
const eb = page.locator(".empty-block .btn", { hasText: "新建空用例" });
if (await eb.count()) await eb.click(); else await page.locator(".search-box .add-btn").click();
await sleep(300);
await page.locator(".dlg-input").first().fill("数据驱动用例");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);

// 加 expect 步骤，用 ${want} 变量
await page.locator(".steps-head .btn", { hasText: "步骤" }).click(); await sleep(400);
await page.locator(".dlg-row", { hasText: "类型" }).locator("select").selectOption("send");
await page.locator(".dlg-row", { hasText: "值 / 断言 / 条件" }).locator("input").fill("DE 21 09 F6 60 01 00 00 5F");
await page.locator(".dlg-foot .btn-primary").click(); await sleep(400);
await page.locator(".steps-head .btn", { hasText: "步骤" }).click(); await sleep(400);
await page.locator(".dlg-row", { hasText: "类型" }).locator("select").selectOption("expect");
await page.locator(".dlg-row", { hasText: "字段" }).locator("input").fill("cmd");
await page.locator(".dlg-row", { hasText: "值 / 断言 / 条件" }).locator("input").fill("equals ${want}");
await page.locator(".dlg-foot .btn-primary").click(); await sleep(500);

// 数据 tab 填 CSV：两行都应为 96
await page.locator(".chip", { hasText: "数据" }).click();
await sleep(500);
const ta = page.locator(".csv-input");
ok("有 CSV 输入框", (await ta.count()) === 1);
await ta.fill("want,note\n96,第一行\n96,第二行");
await page.locator(".btn-primary", { hasText: "保存数据" }).click();
await sleep(600);
ok("CSV 已保存（2 行）", (await page.locator(".pdl-card-note").innerText()).includes("2"), await page.locator(".pdl-card-note").innerText());
await page.screenshot({ path: "docs/demo/44-csv.png" });

// 运行：两行都应通过
await page.locator(".case-head-actions .btn-primary").click();
await sleep(3000);
const passRows = await page.locator('tr[data-status="pass"]').count();
const failRows = await page.locator('tr[data-status="fail"]').count();
ok("数据驱动两行全部通过", passRows === 1 && failRows === 0, `pass=${passRows} fail=${failRows}`);

// 改成一行断言 1 → 应失败
await page.locator(".tab", { hasText: "测试" }).click(); await sleep(600);
await page.locator(".chip", { hasText: "数据" }).click(); await sleep(400);
await page.locator(".csv-input").fill("want,note\n96,ok\n1,bad");
await page.locator(".btn-primary", { hasText: "保存数据" }).click(); await sleep(500);
const before = await page.locator("tr[data-status]").count();
await page.locator(".case-head-actions .btn-primary").click();
await sleep(4000);
const all = await page.$$eval("tr[data-status]", (els) => els.map((e) => e.getAttribute("data-status")));
console.log("    报告状态:", all.join(","));
const fail2 = all.filter((s) => s === "fail").length;
ok("第二行断言不成立 → 用例失败", fail2 >= 1, `fail=${fail2}（之前 ${before} 条）`);
await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
