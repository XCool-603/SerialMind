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
await page.locator(".dlg-input").first().fill("顺序");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
for (const n of ["P-B", "P-C"]) {
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建协议" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "协议名" }).locator("input").fill(n);
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
}
const names = async () => page.$$eval(".tree-item.indent-3", (els) => els.map((e) => e.textContent.trim().replace(/v1.*/, "").trim()));
const before = await names();
console.log("初始:", before.join(" | "));

// 右键上移
const lastItem = page.locator(".tree-item.indent-3").nth(2);
await lastItem.click({ button: "right" });
await sleep(400);
const menuTexts = await page.locator(".ctx-menu .menu-item").allInnerTexts();
ok("协议右键有「上移」", menuTexts.some((t) => t.includes("上移")), menuTexts.join(" / "));
await page.locator(".ctx-menu .menu-item", { hasText: "上移" }).click();
await sleep(700);
const after = await names();
ok("上移生效", after[1] === before[2], `${before.join(",")} → ${after.join(",")}`);

// 刷新后保持
await page.reload({ waitUntil: "networkidle" });
await sleep(2000);
const reloaded = await names();
ok("顺序持久化", reloaded.join(",") === after.join(","), `${after.join(",")} → ${reloaded.join(",")}`);
await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
