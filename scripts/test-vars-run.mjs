/**
 * 自动化完整验收：变量自增（得分+1）+ 循环 + 统计
 * 运行： node scripts/test-vars-run.mjs
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

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

const addStep = async (kind, field, value, timeout = "3s") => {
  await page.locator(".steps-head .btn", { hasText: "步骤" }).click();
  await sleep(450);
  await page.locator(".dlg-row", { hasText: "类型" }).locator("select").selectOption(kind);
  await page.locator(".dlg-row", { hasText: "字段" }).locator("input").fill(field);
  await page.locator(".dlg-row", { hasText: "值 / 断言 / 条件" }).locator("input").fill(value);
  await page.locator(".dlg-row", { hasText: "超时" }).locator("input").fill(timeout);
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(450);
};

try {
  await page.goto("http://127.0.0.1:5273/", { waitUntil: "networkidle" });
  await sleep(1600);

  console.log("\n[1] 环境：产品 / 子产品 / 模拟设备");
  await page.locator(".product-switch").first().click();
  await page.locator(".menu-item", { hasText: "新建产品" }).click();
  await page.locator(".dlg-input").first().fill("心跳车");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(500);
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("车载");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(650);
  await page.locator(".link-status").click();
  await sleep(300);
  await page.locator(".menu-item", { hasText: "模拟设备" }).click();
  await sleep(200);
  await page.locator(".menu-item", { hasText: "连接" }).click();
  await sleep(700);
  ok("模拟设备已连接", (await page.locator(".link-status").innerText()).includes("已连接"));

  console.log("\n[2] 建用例：发心跳 + 得分自增");
  await page.locator(".tab", { hasText: "测试" }).click();
  await sleep(700);
  await page.locator(".btn-primary", { hasText: "一键生成示例用例" }).click();
  await sleep(900);
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(600);
  // 追加 set 步骤：data1 = ${score}
  await addStep("set", "data1", "${score}", "1s");
  const stepCount = await page.locator(".step-row").count();
  ok("3 个步骤（发帧 + 断言 + 设置得分）", stepCount === 3, `${stepCount} 个`);

  console.log("\n[3] 设置：重复 3 轮 / 间隔 100ms / 变量 score=0+1");
  await page.locator(".chip", { hasText: "设置" }).click();
  await sleep(400);
  const varsBox = page.locator(".setting-row", { hasText: "变量" }).locator("textarea");
  ok("变量输入框存在", (await varsBox.count()) === 1);
  await varsBox.fill("score=0+1");
  await sleep(300);
  await page.locator(".setting-row", { hasText: "重复次数" }).locator("input").fill("3");
  await page.locator(".setting-row", { hasText: "轮间隔" }).locator("input").fill("100");
  await sleep(500);
  await page.screenshot({ path: "docs/demo/51-vars-setting.png" });

  console.log("\n[4] 运行 → 报告应有统计");
  await page.locator(".case-head-actions .btn-primary").click();
  await sleep(4000);
  const statuses = await page.$$eval("tr[data-status]", (els) => els.map((e) => e.getAttribute("data-status")));
  ok("用例通过", statuses.includes("pass"), statuses.join(","));
  const rowText = (await page.locator("tr[data-status]").first().innerText()).replace(/\s+/g, " ");
  ok("报告有压测统计（发/收/丢/均）", /发 \d+/.test(rowText) && /丢 \d+/.test(rowText), rowText.slice(0, 100));

  console.log("\n[5] 校验得分真的递增（看终端发出的帧）");
  await page.locator(".tab", { hasText: "终端" }).click();
  await sleep(700);
  const term = await page.locator(".term-list").innerText();
  const hexes = [...term.matchAll(/DE 21 09 F6 60 01 ([0-9A-F]{2}) ([0-9A-F]{2})/g)].map((m) => `${m[1]}${m[2]}`);
  const uniq = [...new Set(hexes)];
  ok("至少抓到 3 帧带得分的", hexes.length >= 3, `${hexes.length} 帧：${hexes.join(",")}`);
  ok("得分每轮递增（值不重复）", uniq.length >= 3, uniq.join(","));
  await page.screenshot({ path: "docs/demo/52-vars-result.png" });
} finally {
  await browser.close();
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
console.log("变量自增 + 循环 + 统计 全部可用 ✅");
