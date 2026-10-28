/**
 * 客户视角验收：自检 / 验收面板 + CSV 模板下载
 * 运行： node scripts/test-customer.mjs
 */
import { chromium } from "playwright";

let pass = 0;
let fail = 0;
const ok = (n, c, d = "") => {
  if (c) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    console.log(`  ✗ ${n}${d ? " — " + d : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://127.0.0.1:5273/", { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(2500);

// ---- 1. 自检面板：默认整机验收 ----
console.log("\n[1] 自检 / 验收面板");
await page.locator('.icon-btn[title*="自检"]').click();
await sleep(800);
ok("面板打开", (await page.locator(".modal-title", { hasText: "自检 / 验收" }).count()) === 1);
const tabs = await page.locator(".modal .side-tabs .chip").allInnerTexts();
ok("有「整机验收」和「引擎自检」两个页签", tabs.join("").includes("整机验收") && tabs.join("").includes("引擎自检"), tabs.join(" / "));
const activeTab = await page.locator(".modal .side-tabs .chip.active").innerText();
ok("默认停在「整机验收」", activeTab.includes("整机验收"), activeTab);

// ---- 2. 跑整机验收 ----
console.log("\n[2] 运行整机验收");
await page.locator(".modal-foot .btn-primary").click();
await sleep(6000);
const rows = await page.locator(".selfcheck-row").count();
ok("跑出了检查项", rows >= 10, `${rows} 项`);
const passPill = await page.locator(".modal-head .pill").first().innerText();
const m = passPill.match(/(\d+)\/(\d+)/);
ok("全部通过", m && m[1] === m[2], passPill);
const failedRows = await page.locator(".selfcheck-row .v.bad").count();
ok("没有失败项", failedRows === 0, `${failedRows} 项失败`);

// 列出检查项
const names = await page.locator(".selfcheck-row .n").allInnerTexts();
console.log("    检查项：" + names.join(" | "));

// ---- 3. 复制 / 导出 ----
console.log("\n[3] 结果可导出");
ok("有「复制结果」", (await page.locator(".modal button", { hasText: "复制结果" }).count()) === 1);
ok("有「导出报告」", (await page.locator(".modal button", { hasText: "导出报告" }).count()) === 1);
const dl = page.waitForEvent("download", { timeout: 10000 });
await page.locator(".modal button", { hasText: "导出报告" }).click();
const download = await dl;
const fname = download.suggestedFilename();
ok("导出文件名合理", /验收/.test(fname) && fname.endsWith(".txt"), fname);

// ---- 4. 引擎自检页签也能跑 ----
console.log("\n[4] 引擎自检页签");
await page.locator(".modal .side-tabs .chip", { hasText: "引擎自检" }).click();
await sleep(400);
await page.locator(".modal-foot .btn-primary").click();
await sleep(2500);
const engineRows = await page.locator(".selfcheck-row").count();
ok("引擎自检跑出 14 项", engineRows === 14, `${engineRows} 项`);
const enginePill = await page.locator(".modal-head .pill").first().innerText();
ok("引擎自检全过", /14\/14/.test(enginePill), enginePill);
await page.screenshot({ path: "docs/demo/live/18-selftest.png" });
await page.locator(".modal-foot .btn", { hasText: "关闭" }).click();
await sleep(400);

// ---- 5. CSV 模板下载 ----
console.log("\n[5] CSV 模板下载");
await page.locator(".product-switch").first().click();
await page.locator(".menu-item", { hasText: "新建产品" }).click();
await page.locator(".dlg-input").first().fill("客户验收");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(500);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item", { hasText: "新建子产品" }).click();
await sleep(400);
await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(650);
await page.locator(".tab", { hasText: "测试" }).click();
await sleep(700);
await page.locator(".btn-primary", { hasText: "一键生成示例用例" }).click();
await sleep(900);
await page.locator(".dlg-foot .btn-primary").click();
await sleep(600);
await page.locator(".side-tabs .chip", { hasText: "数据驱动" }).click();
await sleep(400);
const dl2 = page.waitForEvent("download", { timeout: 10000 });
await page.locator("button", { hasText: "下载模板" }).click();
const d2 = await dl2;
const name2 = d2.suggestedFilename();
ok("模板文件名带协议名", /模板/.test(name2) && name2.endsWith(".csv"), name2);
const stream = await d2.createReadStream();
let content = "";
for await (const chunk of stream) content += chunk.toString("utf8");
ok("模板首行是协议字段名", /header|len|cmd/.test(content.split(/\r?\n/)[0]), content.split(/\r?\n/)[0]);
ok("模板至少 1 行示例", content.trim().split(/\r?\n/).length >= 2, `${content.trim().split(/\r?\n/).length} 行`);

await page.screenshot({ path: "docs/demo/live/19-csv-template.png" });

// ---- 6. 系统健康状态（验收结果持久化） ----
console.log("\n[6] 系统健康状态");
const dotCount = await page.locator(".health-dot").count();
ok("顶栏有健康状态点", dotCount === 1, `${dotCount} 个`);
const dotState = await page.locator(".health-dot").first().getAttribute("data-state");
ok("健康状态为 ok", dotState === "ok", String(dotState));
const dotTitle = await page.locator(".health-dot").first().evaluate((e) => e.parentElement.getAttribute("title"));
ok("顶栏悬停显示上次验收", /24\/24/.test(dotTitle ?? ""), String(dotTitle));
// 重新打开面板，健康提示条应始终可见（不受当前页签影响）
await page.locator('.icon-btn[title*="验收"]').click();
await sleep(600);
await page.locator(".modal .side-tabs .chip", { hasText: "整机验收" }).click();
await sleep(400);
const banner = await page.locator(".health-banner").innerText();
ok("面板显示上次验收", /24\/24/.test(banner), banner.replace(/\s+/g, " "));
await page.screenshot({ path: "docs/demo/live/21-health.png" });
// 项目交付记录（验收历史）
ok("面板有交付记录区", (await page.locator(".accept-history").count()) === 1);
const histRows = await page.locator(".accept-history-row").count();
ok("交付记录至少 1 条", histRows >= 1, `${histRows} 条`);
const firstRow = await page.locator(".accept-history-row").first().innerText();
ok("最新一条是 24/24", /24\/24/.test(firstRow), firstRow.replace(/\s+/g, " "));
await page.locator(".modal-foot .btn", { hasText: "关闭" }).click();
await sleep(400);
await page.reload({ waitUntil: "domcontentloaded" });
await sleep(2600);
ok("刷新后健康状态仍保留", (await page.locator(".health-dot").count()) === 1);
const dotState2 = await page.locator(".health-dot").first().getAttribute("data-state");
ok("刷新后仍为 ok", dotState2 === "ok", String(dotState2));

// ---- 7. 协议版本管理 ----
console.log("\n[7] 协议版本管理");
await page.locator(".tab", { hasText: "协议" }).click();
await sleep(800);
const verTag = page.locator(".page-title .tag-mini").first();
const oldVer = (await verTag.innerText()).trim();
await verTag.click();
await sleep(500);
ok("点版本号能打开协议信息", (await page.locator(".dlg-title", { hasText: "协议信息" }).count()) === 1);
await page.screenshot({ path: "docs/demo/live/22-proto-meta.png" });
await page.locator(".dlg-row", { hasText: "协议名称" }).locator("input").fill("客户验收协议");
await page.locator(".dlg-row", { hasText: "版本号" }).locator("input").fill("v9.9");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
const newVer = (await page.locator(".page-title .tag-mini").first().innerText()).trim();
ok("版本号已更新", newVer === "v9.9", `${oldVer} → ${newVer}`);
const newName = (await page.locator(".page-title").first().innerText()).trim();
ok("协议名称已更新", newName.includes("客户验收协议"), newName.replace(/\s+/g, " "));

// ---- 8. 自定义测试（直接编辑 YAML） ----
console.log("\n[8] 自定义测试 / YAML 编辑");
await page.locator(".tabbar .tab", { hasText: "测试" }).first().click();
await sleep(900);
// 已有用例就直接选一个；没有才新建
if ((await page.locator(".case-card").count()) > 0) {
  await page.locator(".case-card").first().click();
  await sleep(500);
} else {
  await page.locator("button", { hasText: "新建空用例" }).click();
  await sleep(500);
  await page.locator(".dlg-input").first().fill("YAML 用例");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(800);
}
ok("用例编辑区可见", (await page.locator(".yaml-head").count()) === 1);
ok("有「编辑」按钮", (await page.locator(".yaml-head button", { hasText: "编辑" }).count()) === 1);
await page.locator(".yaml-head button", { hasText: "编辑" }).click();
await sleep(400);
ok("出现 YAML 编辑框", (await page.locator(".yaml-editor").count()) === 1);
const yaml = [
  "steps:",
  "  - set:    { field: position, value: 3000 }",
  "  - expect: { field: position, equals 3000, within 2s }",
  "  - delay:  300ms",
].join("\n");
await page.locator(".yaml-editor").fill(yaml);
await page.locator(".yaml-head button", { hasText: "应用" }).click();
await sleep(800);
const stepRows = await page.locator(".step-row").count();
ok("YAML 应用后生成 3 个步骤", stepRows === 3, `${stepRows} 个`);
ok("应用后没有报错", (await page.locator(".yaml-err").count()) === 0);

// 非法 YAML：必须报错且不改动已有步骤
await page.locator(".yaml-head button", { hasText: "编辑" }).click();
await sleep(300);
await page.locator(".yaml-editor").fill("steps:\n  - bogus: 1\n  - expect: { field: x }");
await page.locator(".yaml-head button", { hasText: "应用" }).click();
await sleep(600);
ok("非法 YAML 报错", (await page.locator(".yaml-err").count()) === 1);
const errText = await page.locator(".yaml-err").innerText();
ok("报错说明具体行号", /第 2 行/.test(errText), errText.replace(/\s+/g, " ").slice(0, 60));
await page.screenshot({ path: "docs/demo/live/23-yaml-edit.png" });
await page.locator(".yaml-head button", { hasText: "取消" }).click();
await sleep(300);
const afterCancel = await page.locator(".step-row").count();
ok("取消后步骤不变", afterCancel === 3, `${afterCancel} 个`);

// ---- 9. 用例 / 套件 合并到「测试」一个页签 ----
console.log("\n[9] 测试页合并（用例 + 套件）");
const tabNames = (await page.locator(".tabbar .tab").allInnerTexts()).map((s) => s.trim()).filter(Boolean);
ok("页签只剩 4 个", tabNames.length === 4, tabNames.join(" / "));
ok("没有「批量」页签", !tabNames.some((x) => x.includes("批量")), tabNames.join(" / "));
ok("有「测试」页签", tabNames.some((x) => x.includes("测试")), tabNames.join(" / "));
await page.locator(".tabbar .tab", { hasText: "测试" }).first().click();
await sleep(800);
ok("测试页有切换条", (await page.locator(".test-mode-switch").count()) === 1);
const chips = (await page.locator(".test-mode-switch .chip").allInnerTexts()).map((s) => s.replace(/\s+/g, ""));
ok("切换条有用例 / 套件", chips.some((c) => c.includes("用例")) && chips.some((c) => c.includes("套件")), chips.join(" | "));
await page.locator(".test-mode-switch .chip", { hasText: "套件" }).click();
await sleep(800);
ok("能切到套件视图", (await page.locator("table.dt").count()) === 1);
await page.screenshot({ path: "docs/demo/live/25-test-suites.png" });
await page.locator(".test-mode-switch .chip", { hasText: "用例" }).click();
await sleep(700);
ok("能切回用例视图", (await page.locator(".case-layout, .content").count()) >= 1);

// ---- 10. 控制流：if / 子步骤 ----
console.log("\n[10] 控制流（if / while / 变量）");
// 清掉已有步骤：逐个删
for (let i = 0; i < 20; i++) {
  const del = page.locator(".step-row .step-more").first();
  if ((await page.locator(".step-row").count()) === 0) break;
  await del.click({ force: true });
  await sleep(150);
}
ok("步骤已清空", (await page.locator(".step-row").count()) === 0, `${await page.locator(".step-row").count()} 个`);

// 加一个 if 步骤
await page.locator(".steps-head button").first().click();
await sleep(500);
await page.locator(".dlg select").first().selectOption("if");
await sleep(200);
await page.locator(".dlg-row", { hasText: "值 / 断言 / 条件" }).locator("input").fill("position > 100");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
const ifRow = await page.locator(".step-row").first().innerText();
ok("能添加 if 步骤", /if/.test(ifRow) && /position > 100/.test(ifRow), ifRow.replace(/\s+/g, " ").slice(0, 60));

// 加子步骤
ok("if 行有「添加子步骤」", (await page.locator(".step-add-child").count()) >= 1);
await page.locator(".step-add-child").first().click();
await sleep(500);
await page.locator(".dlg select").first().selectOption("expect");
await page.locator(".dlg-row", { hasText: "字段 / 变量" }).locator("input").fill("position");
await page.locator(".dlg-row", { hasText: "值 / 断言 / 条件" }).locator("input").fill("equals 3000");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
ok("子步骤出现在分支里", (await page.locator(".step-child").count()) === 1, `${await page.locator(".step-child").count()} 个`);
const childText = await page.locator(".step-child").first().innerText();
ok("子步骤内容正确", /position/.test(childText) && /3000/.test(childText), childText.replace(/\s+/g, " ").slice(0, 60));

// YAML 里应是嵌套结构
const yamlText = await page.locator(".yaml-body").innerText();
ok("YAML 是嵌套结构", /if:/.test(yamlText) && /then:/.test(yamlText), yamlText.replace(/\s+/g, " ").slice(0, 80));
await page.screenshot({ path: "docs/demo/live/26-controlflow.png" });

// 再加一个 while
await page.locator(".steps-head button").first().click();
await sleep(500);
await page.locator(".dlg select").first().selectOption("while");
await page.locator(".dlg-row", { hasText: "值 / 断言 / 条件" }).locator("input").fill("score < 3");
await page.locator(".dlg-row", { hasText: "超时 / 上限" }).locator("input").fill("10");
await page.locator(".dlg-foot .btn-primary").click();
await sleep(700);
ok("能添加 while 步骤", (await page.locator(".step-row").count()) === 2, `${await page.locator(".step-row").count()} 个`);

await b.close();
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
