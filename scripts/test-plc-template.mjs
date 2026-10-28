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
await page.locator(".dlg-input").first().fill("PLC默认");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(500);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("起升");
const tplSel = page.locator(".dlg-row", { hasText: "协议类型" }).locator("select");
ok("默认协议类型是 PLC", (await tplSel.inputValue()) === "plc", await tplSel.inputValue());
await page.locator(".dlg-foot .btn-primary").click();
await sleep(800);

await page.locator(".tab", { hasText: "协议" }).click();
await sleep(700);
const names = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fname input", (els) => els.map((e) => e.value));
ok("字段是 header/len/lenInv/cmd/data0/data1/sum", names.join(",") === "header,len,lenInv,cmd,data0,data1,sum", names.join(","));

const sizes = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fsize input", (els) => els.map((e) => e.value));
ok("长度 2/1/1/1/1/2/1", sizes.join(",") === "2,1,1,1,1,2,1", sizes.join(","));

const values = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fvalue input, .pdl-table .pdl-tr:not(.head) .c-fvalue span", (els) => els.map((e) => (e.value ?? e.textContent ?? "").trim()));
ok("header 是 DE 21", values[0].toUpperCase() === "DE 21", values[0]);
ok("len 显示自动", values[1].includes("自动"), values[1]);
ok("lenInv 显示自动反码", values[2].includes("0xFF - len"), values[2]);
ok("cmd 显示 60（不是 3C 也不是 96）", values[3].toUpperCase() === "60", values[3]);
ok("data0 显示 01", values[4].toUpperCase() === "01", values[4]);
ok("data1 显示 0000", values[5].toUpperCase() === "0000", values[5]);

const preview = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase().trim();
ok("组包 = DE 21 09 F6 60 01 00 00 5F", preview === "DE 21 09 F6 60 01 00 00 5F", preview);
await page.screenshot({ path: "docs/demo/34-plc-template.png" });

// 调试面板里也必须显示十六进制
const dbgVals = await page.$$eval(".pdbg-field input", (els) => els.map((e) => e.value));
ok("调试面板 cmd 显示 60（不是 96）", dbgVals.includes("60"), dbgVals.join(","));
ok("调试面板 data1 显示 0000（不是 0）", dbgVals.includes("0000"), dbgVals.join(","));

// 改 cmd 为 61，应自动更新反码不变、sum 变化
await page.locator(".pdl-table .pdl-tr:not(.head)").nth(3).locator(".c-fvalue input").fill("61");
await sleep(500);
const p2 = (await page.locator(".pdbg-preview").innerText()).replace(/\s+/g, " ").toUpperCase().trim();
ok("改 cmd=61 后帧头/长度不变，sum 重算", p2.startsWith("DE 21 09 F6 61 01 00 00"), p2);
ok("cmd 显示 61 不是 3C", p2.includes("F6 61"), p2);

await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
