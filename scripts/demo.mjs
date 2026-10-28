/**
 * 端到端演示 + 验收（Playwright 驱动真实浏览器，用系统已装的 Edge，不下载浏览器）
 *
 * 结构：产品 → 子产品（固定协议）→ 角色 / 用例 / 规则；串口在顶栏选。
 *
 * 运行： node scripts/demo.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5273/";
const OUT = "docs/demo";
mkdirSync(OUT, { recursive: true });

const steps = [];
let failures = 0;

function ok(name, cond, detail = "") {
  steps.push({ name, ok: !!cond, detail });
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  console.log("\n[1] 打开应用（全新 profile，数据库应为空）");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1600);
  ok("页面加载", (await page.locator(".app").count()) === 1);
  ok("初始为空：RX 0", (await page.locator(".counter-value").first().innerText()) === "0");
  ok("初始为空：没有报文", (await page.locator(".term-list .msg-row").count()) === 0);
  ok("顶栏有串口选择器", (await page.locator(".link-status").count()) === 1);
  await page.screenshot({ path: `${OUT}/01-empty.png` });

  console.log("\n[2] 新建产品");
  await page.locator(".product-switch").first().click();
  await page.locator(".menu-item", { hasText: "新建产品" }).click();
  await page.locator(".dlg-input").first().fill("起重机");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  ok("产品名变为起重机", (await page.locator(".product-name").first().innerText()) === "起重机");
  await page.screenshot({ path: `${OUT}/02-product.png` });

  console.log("\n[3] 新建协议 → 新建子产品（绑定该协议）→ 新建角色");
  // 协议
  await page.locator(".tab", { hasText: "协议" }).click();
  await sleep(600);
  await page.locator(".empty-block .btn", { hasText: "新建协议" }).click();
  await page.locator(".dlg-input").first().fill("起升PLC控制协议");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(800);
  ok("协议已创建", (await page.locator(".pdl-table").count()) === 1);
  const tplFields = await page.$$eval(".pdl-table .pdl-tr:not(.head) .c-fname input", (els) => els.map((e) => e.value));
  ok(
    "新协议默认是 PLC 模板（7 个字段）",
    tplFields.join(",") === "header,len,lenInv,cmd,data0,data1,sum",
    tplFields.join(" / "),
  );
  await page.screenshot({ path: `${OUT}/03b-plc-template.png` });

  // 子产品
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("起升控制");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  ok("子产品出现在树里", (await page.locator(".tree-group", { hasText: "起升控制" }).count()) >= 1);
  ok("子产品显示了协议数量", /\d+ 协议/.test(await page.locator(".tree-group", { hasText: "起升控制" }).first().innerText()));
  // 再建一个协议（模拟"心跳 / 车辆上线"这类多协议）
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建协议" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "协议名" }).locator("input").fill("心跳");
  await page.locator(".dlg-row", { hasText: "协议类型" }).locator("select").selectOption("binary");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  const protoItems = await page.locator(".tree-item", { hasText: "心跳" }).count();
  ok("一个子产品下可以有多个协议", protoItems >= 1, `${protoItems} 个`);

  // 角色页已隐藏（界面简化：终端/协议/用例/套件/报告）

  console.log("\n[4] AI 草稿：本地抽取 → 应用为协议");
  await page.locator(".ai-switch").click();
  await sleep(500);
  await page.locator(".ai-panel .btn", { hasText: "本地抽取" }).click();
  await sleep(900);
  const draftRows = await page.locator(".ai-panel tbody tr").count();
  ok("抽取出字段", draftRows >= 5, `${draftRows} 个字段`);
  ok("校验算法已判定", (await page.locator(".ai-kv").nth(2).innerText()).includes("CRC16/MODBUS"));
  await page.screenshot({ path: `${OUT}/04-ai-draft.png` });
  await page.locator(".ai-foot .btn-primary").click();
  await sleep(900);
  ok("协议已应用", (await page.locator(".page-title").first().innerText()).includes("AI 草稿"));

  console.log("\n[5] 引擎自检（14 项真实断言）");
  await page.locator(".icon-btn[title='引擎自检']").click();
  await page.locator(".modal-foot .btn-primary").click();
  await sleep(900);
  ok("自检项数", (await page.locator(".selfcheck-row").count()) === 14);
  ok("全部通过", (await page.locator(".modal-head .pill").first().innerText()).includes("14/14"));
  await page.screenshot({ path: `${OUT}/05-selftest.png` });
  await page.locator(".modal-close").first().click();
  await sleep(300);

  console.log("\n[6] 新建用例并添加 3 个步骤");
  await page.locator(".tab", { hasText: "测试" }).click();
  await sleep(600);
  if (await page.locator(".search-box .add-btn").count()) {
    await page.locator(".search-box .add-btn").click();
  } else {
    await page.locator(".empty-block .btn", { hasText: "新建空用例" }).click();
  }
  await page.locator(".dlg-input").first().fill("读位置并断言");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  ok("用例已创建", (await page.locator(".case-card-name").first().innerText()).includes("读位置"));

  const addStep = async (kind, field, value, timeout) => {
    await page.locator(".steps-head .btn", { hasText: "步骤" }).click();
    await page.locator(".dlg-row", { hasText: "类型" }).locator("select").selectOption(kind);
    await page.locator(".dlg-row", { hasText: "字段" }).locator("input").fill(field);
    await page.locator(".dlg-row", { hasText: "值/断言" }).locator("input").fill(value);
    await page.locator(".dlg-row", { hasText: "超时" }).locator("input").fill(timeout);
    await page.locator(".dlg-foot .btn-primary").click();
    await sleep(400);
  };
  await addStep("send", "raw", "01 03 00 00 00 0A C5 CD", "3s");
  await addStep("expect", "position", "equals 3000", "300ms");
  await addStep("assertNo", "raw", "crc_error", "3s");
  ok("3 个步骤已加入", (await page.locator(".step-row").count()) === 3);
  ok("YAML 已同步生成", (await page.locator(".yaml-body").innerText()).includes("send:"));
  await page.screenshot({ path: `${OUT}/06-case-steps.png` });

  console.log("\n[7] 运行用例（串口未连接，必须真失败）");
  await page.locator(".case-head-actions .btn-primary").click();
  await page.waitForURL(/#report/, { timeout: 15000 }).catch(() => {});
  await sleep(1200);
  ok("报告里有真实结果", (await page.locator(".dt tbody tr").count()) >= 1);
  const reason = await page.locator(".fail-reason").first().innerText();
  ok("失败原因说明真实情况", /串口未连接|未收到|最后一次/.test(reason), reason.slice(0, 40));
  await page.screenshot({ path: `${OUT}/07-report.png` });

  console.log("\n[8] 刷新页面：数据从 SQLite 恢复");
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1900);
  ok("产品仍在", (await page.locator(".product-name").first().innerText()) === "起重机");
  ok("子产品仍在", (await page.locator(".tree-group", { hasText: "起升控制" }).count()) >= 1);
  ok("用例仍在", (await page.locator(".tree-item", { hasText: "读位置" }).count()) >= 1);
  await page.screenshot({ path: `${OUT}/08-persist.png` });

  console.log("\n[9] 协议字段可编辑并持久化");
  await page.locator(".tab", { hasText: "协议" }).click();
  await sleep(900);
  const beforeCount = await page.locator(".pdl-table .pdl-tr:not(.head)").count();
  const firstNameCell = page.locator(".pdl-table .pdl-tr:not(.head)").first().locator(".c-fname input");
  ok("字段名是可输入框", await firstNameCell.isEditable());
  await firstNameCell.fill("addr_edited");
  await page.locator(".pdl-main-head .btn", { hasText: "字段" }).click();
  await sleep(300);
  ok("能新增字段", (await page.locator(".pdl-table .pdl-tr:not(.head)").count()) === beforeCount + 1);
  await page.locator(".pdl-card", { hasText: "样例帧" }).locator("input").first().fill("");
  await sleep(300);
  await page.locator(".page-actions .btn-primary", { hasText: "保存" }).click();
  await sleep(800);
  ok("保存后未保存提示消失", (await page.locator(".page-title .pill.amber").count()) === 0);
  await page.screenshot({ path: `${OUT}/09-protocol-edit.png` });

  await page.reload({ waitUntil: "networkidle" });
  await sleep(1900);
  await page.locator(".tab", { hasText: "协议" }).click();
  await sleep(900);
  const persistedName = await page.locator(".pdl-table .pdl-tr:not(.head)").first().locator(".c-fname input").inputValue();
  ok("字段名修改已持久化", persistedName === "addr_edited", persistedName);
  ok("新增字段已持久化", (await page.locator(".pdl-table .pdl-tr:not(.head)").count()) === beforeCount + 1);

  console.log("\n[10] 产品树：折叠 / 右键 / 改名 / 删除");
  await page.locator(".tab", { hasText: "终端" }).click();
  await sleep(500);
  const caseGroup = page.locator(".tree-group", { hasText: "用例" }).first();
  const caseItem = page.locator(".tree-item", { hasText: "读位置并断言" }).first();
  ok("折叠前能看到用例节点", await caseItem.isVisible());
  await caseGroup.click();
  await sleep(400);
  ok("点击分组可折叠", !(await caseItem.isVisible().catch(() => false)));
  await caseGroup.click();
  await sleep(400);
  ok("再点可展开", await caseItem.isVisible());

  await caseItem.click({ button: "right" });
  await sleep(400);
  ok("右键弹出菜单", await page.locator(".ctx-menu").isVisible());
  const menuTexts = await page.locator(".ctx-menu .menu-item").allInnerTexts();
  ok("菜单含改名/删除", menuTexts.some((t) => t.includes("重命名")) && menuTexts.some((t) => t.includes("删除")), menuTexts.join(" / "));
  await page.screenshot({ path: `${OUT}/11-tree-ctxmenu.png` });

  await page.locator(".ctx-menu .menu-item", { hasText: "重命名用例" }).click();
  await sleep(500);
  await page.locator(".dlg-input").first().fill("读位置-改名后");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  ok("用例已改名", (await page.locator(".tree-item", { hasText: "读位置-改名后" }).count()) === 1);

  const renamed = page.locator(".tree-item", { hasText: "读位置-改名后" }).first();
  await renamed.click({ button: "right" });
  await sleep(300);
  await page.locator(".ctx-menu .menu-item", { hasText: "删除用例" }).click();
  await sleep(500);
  ok("删除前二次确认", (await page.locator(".dlg-title", { hasText: "删除用例" }).count()) === 1);
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  ok("用例已从树里移除", (await page.locator(".tree-item", { hasText: "读位置-改名后" }).count()) === 0);

  const productNode = page.locator(".tree-group").first();
  await productNode.click({ button: "right" });
  await sleep(300);
  await page.locator(".ctx-menu .menu-item", { hasText: "重命名产品" }).click();
  await sleep(500);
  await page.locator(".dlg-input").first().fill("起重机A");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(700);
  ok("产品已改名", (await page.locator(".product-name").first().innerText()) === "起重机A");
  await page.screenshot({ path: `${OUT}/12-tree-renamed.png` });

  await page.reload({ waitUntil: "networkidle" });
  await sleep(1900);
  ok("产品改名已持久化", (await page.locator(".product-name").first().innerText()) === "起重机A");

  await browser.close();

  console.log(`\n${"=".repeat(56)}`);
  const passed = steps.filter((s) => s.ok).length;
  console.log(`演示结果：${passed}/${steps.length} 通过`);
  if (failures) {
    console.log("失败项：");
    for (const s of steps.filter((x) => !x.ok)) console.log(`  - ${s.name} ${s.detail}`);
    process.exit(1);
  }
  console.log(`截图已保存到 ${OUT}/`);
}

main().catch((e) => {
  console.error("演示脚本异常：", e);
  process.exit(1);
});