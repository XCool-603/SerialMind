/**
 * UI 验证：把 DE 21 09 F6 60 00 00 00 配成 3 个字段
 * 运行： node scripts/test-frame3-ui.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5273/";
const OUT = "docs/demo";
mkdirSync(OUT, { recursive: true });

const steps = [];
let failures = 0;
const ok = (n, c, d = "") => {
  steps.push({ n, c, d });
  if (!c) failures++;
  console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1600);

  console.log("\n[1] 建产品 → 建子产品（选空白协议）");
  await page.locator(".product-switch").first().click();
  await page.locator(".menu-item", { hasText: "新建产品" }).click();
  await page.locator(".dlg-input").first().fill("小车");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(600);

  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("车载");
  await page.locator(".dlg-row", { hasText: "协议类型" }).locator("select").selectOption("blank");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(800);
  ok("子产品已建", (await page.locator(".tree-group", { hasText: "车载" }).count()) >= 1);

  console.log("\n[2] 用「从样例帧建」生成 3 个字段");
  await page.locator(".tab", { hasText: "协议" }).click();
  await sleep(700);
  ok("空白模板没有预置字段", (await page.locator(".pdl-table .pdl-tr:not(.head)").count()) === 0);
  ok("显示空状态引导", (await page.locator(".pdl-empty").count()) === 1);
  await page.locator(".pdl-main-head .btn", { hasText: "从样例帧建" }).click();
  await sleep(500);
  await page.locator(".modal .field-line", { hasText: "样例帧" }).locator("input").fill("DE 21 09 F6 60 00 00 00");
  await page.locator(".modal .field-line", { hasText: "切分" }).locator("input").fill("5:header,1:carNo,2:value");
  await sleep(400);
  await page.screenshot({ path: `${OUT}/20-builder.png` });
  await page.locator(".modal-foot .btn-primary").click();
  await sleep(700);

  const names = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fname input", (els) => els.map((e) => e.value));
  const sizes = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fsize input", (els) => els.map((e) => e.value));
  ok("生成 3 个字段", names.length === 3, names.join(" / "));
  ok("字段名按切分语法命名", names.join(",") === "header,carNo,value", names.join(","));
  ok("长度是 5 / 1 / 2", sizes.join(",") === "5,1,2", sizes.join(","));
  ok("第一个字段是 header", names[0] === "header", names[0]);

  const firstVal = await page.locator(".pdl-table .pdl-tr:not(.head)").first().locator(".c-fvalue input").inputValue();
  ok("帧头填成固定 HEX", firstVal.toUpperCase() === "DE 21 09 F6 60", firstVal);

  await page.locator(".page-actions .btn-primary", { hasText: "保存" }).click();
  await sleep(700);
  ok("保存成功（无校验字段也能存）", (await page.locator(".page-title .pill.amber").count()) === 0);
  await page.screenshot({ path: `${OUT}/21-three-fields.png` });

  console.log("\n[3] 给字段加枚举：00=无 01=上线 02=上电 04=启动");
  {
    const stateRow = page.locator(".pdl-table .pdl-tr:not(.head)").nth(1);
    await stateRow.locator(".c-fmore .mv-btn").first().click();
    await sleep(500);
    await page.locator(".dlg-row", { hasText: "枚举" }).locator("input").fill("0=无, 1=上线, 2=上电, 4=启动");
    await page.locator(".dlg-foot .btn-primary").click();
    await sleep(600);
    // 再打开确认写进去了
    await page.locator(".pdl-table .pdl-tr:not(.head)").nth(1).locator(".c-fmore .mv-btn").first().click();
    await sleep(500);
    const enumVal = await page.locator(".dlg-row", { hasText: "枚举" }).locator("input").inputValue();
    ok("枚举已保存", enumVal.includes("上线") && enumVal.includes("启动"), enumVal);
    await page.locator(".dlg-foot .btn").first().click(); // 取消
    await sleep(300);
    await page.locator(".page-actions .btn-primary", { hasText: "保存" }).click();
    await sleep(600);
  }

  console.log("\n[4] 整帧不分字段（直接当固定报文）");
  {
    await page.locator(".pdl-main-head .btn", { hasText: "从样例帧建" }).click();
    await sleep(400);
    await page.locator(".modal .field-line", { hasText: "样例帧" }).locator("input").fill("DE 21 09 F6 60 00 00 00");
    await page.locator(".modal .field-line", { hasText: "切分" }).locator("input").fill("");
    await sleep(300);
    await page.locator(".modal-foot .btn-primary").click();
    await sleep(700);
    const names = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fname input", (els) => els.map((e) => e.value));
    ok("只有 1 个字段", names.length === 1, names.join(","));
    ok("字段名 frame", names[0] === "frame", names[0]);
    const hexVal = await page.locator(".pdl-table .pdl-tr:not(.head)").first().locator(".c-fvalue input").inputValue();
    ok("整帧 HEX 填进去了", hexVal.toUpperCase() === "DE 21 09 F6 60 00 00 00", hexVal);
    await page.screenshot({ path: `${OUT}/22-whole-frame.png` });
    // 还原成三字段，避免影响后续断言
    await page.locator(".pdl-main-head .btn", { hasText: "从样例帧建" }).click();
    await sleep(300);
    await page.locator(".modal .field-line", { hasText: "切分" }).locator("input").fill("5:header,1:carNo,2:value");
    await sleep(300);
    await page.locator(".modal-foot .btn-primary").click();
    await sleep(600);
    await page.locator(".page-actions .btn-primary", { hasText: "保存" }).click();
    await sleep(600);
  }

  console.log("\n[5] 协议调试面板：填字段 → 组包预览 → 发送 → 看解析");
  {
    // 填车号 5，高低位 0x1234
    const carInput = page.locator(".pdbg-field", { hasText: "carNo" }).locator("input");
    await carInput.fill("5");
    const valInput = page.locator(".pdbg-field", { hasText: "value" }).locator("input");
    await valInput.fill("1234"); // 十六进制
    await sleep(500);
    const preview = await page.locator(".pdbg-preview").innerText();
    ok("组包预览正确", preview.replace(/\s+/g, " ").toUpperCase() === "DE 21 09 F6 60 05 12 34", preview);
    await page.screenshot({ path: `${OUT}/23-debug-panel.png` });

    await page.locator(".pdbg-send .btn-primary").click();
    await sleep(700);
    const rows = await page.locator(".pdbg-row").count();
    ok("发送后收发记录有 1 条", rows >= 1, `${rows} 条`);
    const row = await page.locator(".pdbg-row").first().innerText();
    ok("记录里是 TX", row.includes("TX"), row.replace(/\s+/g, " ").slice(0, 60));
    ok("记录带解析摘要", /carNo=05/.test(row) && /value=1234/.test(row), row.replace(/\s+/g, " ").slice(0, 90));
  }

  console.log("\n[6] 在「值」列直接填 HEX，长度自动跟着变");
  {
    // 新增一个字段，长度默认 1，然后在值里填 5 字节 HEX
    await page.locator(".pdl-main-head .btn", { hasText: "字段" }).click();
    await sleep(400);
    const rows = page.locator(".pdl-table .pdl-tr:not(.head)");
    const last = rows.nth((await rows.count()) - 1);
    await last.locator(".c-fname input").fill("raw");
    const valInput = last.locator(".c-fvalue input");
    await valInput.fill("DE 21 09 F6 60");
    await sleep(500);
    const shownVal = await valInput.inputValue();
    const shownSize = await last.locator(".c-fsize input").inputValue();
    ok("值列保留 HEX 格式", shownVal.toUpperCase() === "DE 21 09 F6 60", shownVal);
    ok("长度自动变成 5", shownSize === "5", shownSize);
    await page.screenshot({ path: `${OUT}/25-hex-value.png` });
    // 删掉这个测试字段，避免影响后续
    await last.locator(".c-fmore .mv-btn").last().click();
    await sleep(400);
    await page.locator(".page-actions .btn-primary", { hasText: "保存" }).click();
    await sleep(600);
  }

  console.log("\n[7] 刷新后仍在");
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1800);
  await page.locator(".tab", { hasText: "协议" }).click();
  await sleep(800);
  const names2 = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fname input", (els) => els.map((e) => e.value));
  ok("3 个字段持久化", names2.length === 3, names2.join(" / "));
} finally {
  await browser.close();
}

console.log(`\n${"=".repeat(48)}`);
const passed = steps.filter((s) => s.c).length;
console.log(`结果：${passed}/${steps.length} 通过`);
if (failures) {
  for (const s of steps.filter((x) => !x.c)) console.log("  - " + s.n + " " + s.d);
  process.exit(1);
}
console.log("UI 上也能配出 3 字段协议 ✅");
