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
await page.locator(".dlg-input").first().fill("拖拽");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);

// 建两个子产品
for (const n of ["A子产品", "B子产品"]) {
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill(n);
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(600);
}
const spNames = async () => page.$$eval(".tree-group.indent-1 .label", (els) => els.map((e) => e.textContent.trim()));
const before = await spNames();
ok("两个子产品都在", before.join(",").includes("A子产品") && before.join(",").includes("B子产品"), before.join(","));

// 拖拽：把 B 拖到 A 上
const a = page.locator(".tree-group.indent-1", { hasText: "A子产品" }).first();
const bb = page.locator(".tree-group.indent-1", { hasText: "B子产品" }).first();
await bb.dragTo(a);
await sleep(700);
const after = await spNames();
ok("拖拽后顺序变了", after[0] !== before[0], `${before.join(",")} → ${after.join(",")}`);

// 刷新后顺序保持
await page.reload({ waitUntil: "networkidle" });
await sleep(1800);
const afterReload = await spNames();
ok("顺序已持久化", afterReload[0] === after[0], `${after.join(",")} → ${afterReload.join(",")}`);

// 复制子产品
await page.locator(".tree-group.indent-1").first().click({ button: "right" });
await sleep(400);
await page.locator(".ctx-menu .menu-item", { hasText: "复制子产品" }).click();
await sleep(700);
const copied = await spNames();
ok("出现副本", copied.some((n) => n.includes("副本")), copied.join(","));

// 协议发送按钮
await page.locator(".tab", { hasText: "协议" }).click();
await sleep(600);
const protoRow = page.locator(".tree-item.indent-3", { hasText: "主协议" }).first();
ok("协议行有发送按钮", (await protoRow.locator(".tree-send").count()) === 1);
await protoRow.locator(".tree-send").click();
await sleep(900);
const termText = await page.locator(".statusbar").innerText();
ok("点发送后有反馈", /已发送|组包失败/.test(termText), termText.slice(0, 80));
await page.screenshot({ path: "docs/demo/35-tree-features.png" });

await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
