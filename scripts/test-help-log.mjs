/**
 * 第 4 步验收：日志存文件 + 帮助入口 + 关于
 * 运行： node scripts/test-help-log.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

const DL = join(process.cwd(), "scratch", "downloads");
mkdirSync(DL, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

try {
  await page.goto("http://127.0.0.1:5273/", { waitUntil: "networkidle" });
  await sleep(1600);

  console.log("\n[1] 帮助入口");
  ok("顶栏有 ? 按钮", (await page.locator('.icon-btn[title="帮助 / 关于"]').count()) === 1);
  await page.locator('.icon-btn[title="帮助 / 关于"]').click();
  await sleep(600);
  const title = await page.locator(".modal-title").innerText();
  ok("打开帮助弹窗", title.includes("帮助"), title);
  const helpText = await page.locator(".help-md").innerText();
  ok("说明内容已加载（不是空）", helpText.length > 500, `${helpText.length} 字`);
  ok("说明里含 5 步", helpText.includes("第 1 步") || helpText.includes("5 步"), helpText.slice(0, 60));
  await page.screenshot({ path: "docs/demo/54-help.png" });

  console.log("\n[2] 关于");
  await page.locator(".chip", { hasText: "关于" }).click();
  await sleep(500);
  const about = await page.locator(".modal-body").innerText();
  ok("显示版本号", /0\.1\.0/.test(about), about.replace(/\s+/g, " ").slice(0, 80));
  ok("显示数据存储方式", about.includes("IndexedDB") || about.includes("SQLite"), about.replace(/\s+/g, " ").slice(0, 120));
  await page.screenshot({ path: "docs/demo/55-about.png" });
  await page.locator(".modal-foot .btn-primary").click();
  await sleep(400);

  console.log("\n[3] 日志存文件");
  // 先建产品/子产品（PLC 协议），否则日志里字段是空的
  await page.locator(".product-switch").first().click();
  await page.locator(".menu-item", { hasText: "新建产品" }).click();
  await page.locator(".dlg-input").first().fill("日志测试");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(500);
  await page.locator(".sidebar-head .add-btn").click();
  await page.locator(".menu-item", { hasText: "新建子产品" }).click();
  await sleep(400);
  await page.locator(".dlg-row", { hasText: "名称" }).locator("input").fill("车载");
  await page.locator(".dlg-foot .btn-primary").click();
  await sleep(650);
  // 造几帧：连模拟设备 + 发一帧
  await page.locator(".link-status").click();
  await sleep(350);
  await page.locator(".menu-item", { hasText: "模拟设备" }).click();
  await sleep(200);
  await page.locator(".menu-item", { hasText: "连接" }).click();
  await sleep(700);
  await page.locator(".tab", { hasText: "终端" }).click();
  await sleep(500);
  await page.locator(".send-input").fill("DE 21 09 F6 60 01 00 00 5F");
  await sleep(250);
  await page.locator(".send-input-row .btn-primary").click();
  await sleep(900);

  const btn = page.locator('.tool-btn[title="保存日志到文件（带时间戳）"]');
  ok("终端有保存日志按钮", (await btn.count()) === 1);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), btn.click()]);
  const name = dl.suggestedFilename();
  ok("文件名带时间戳", /^serialmind-\d{8}-\d{6}\.log$/.test(name), name);
  const path = join(DL, name);
  await dl.saveAs(path);
  await sleep(300);
  ok("文件已下载", existsSync(path), path);
  const content = readFileSync(path, "utf8");
  ok("含表头信息", content.includes("SerialMind 串口日志") && content.includes("端口"), content.slice(0, 60).replace(/\n/g, " "));
  ok("含报文 HEX", /DE 21 09 F6 60 01 00 00 5F/.test(content), content.split("\n").slice(7, 9).join(" ").slice(0, 90));
  ok("含校验结论", /校验OK|校验错/.test(content));
  ok("含字段解析", /cmd=60|header=/.test(content), content.split("\n").slice(7, 9).join(" ").slice(0, 90));
} finally {
  await browser.close();
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass}/${pass + fail} 通过`);
if (fail) process.exit(1);
console.log("日志导出 + 帮助 + 关于 全部可用 ✅");
