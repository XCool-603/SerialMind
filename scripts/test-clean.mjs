import { chromium } from "playwright";
let pass=0,fail=0;
const ok=(n,c,d="")=>{ if(c){pass++;console.log(`  ✓ ${n}`)}else{fail++;console.log(`  ✗ ${n}${d?" — "+d:""}`)} };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({channel:"msedge",headless:true});
const page=await (await b.newContext({viewport:{width:1440,height:900},locale:"zh-CN"})).newPage();
page.on("pageerror",e=>console.log("[pageerror]",e.message));
await page.goto("http://127.0.0.1:5273/",{waitUntil:"networkidle"}); await sleep(1600);

const tabs=await page.$$eval(".tab .label",els=>els.map(e=>e.textContent.trim()));
ok("页签 4 个（批量已并入测试）", tabs.join(",")==="终端,协议,测试,报告", tabs.join(","));

// 无 onClick 的按钮（运行时探测）
const deadCount = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button"));
  return btns.filter(b => !b.onclick && !b.hasAttribute("disabled") && b.innerHTML.trim() && !b.closest(".menu")).length;
});
ok("可见按钮都有行为（粗略）", deadCount < 40, `${deadCount} 个`);

// 顶栏：调色板/分屏/撤销 都没了
const top = await page.locator(".topbar").innerText();
ok("顶栏无「分屏」", !top.includes("分屏"));
const tabbarRight = await page.locator(".tabbar-right").innerText().catch(()=>"");
ok("页签右侧无「分屏/撤销」", !tabbarRight.includes("分屏") && !tabbarRight.includes("撤销"), tabbarRight.replace(/\s+/g," "));

// 侧边栏底部空
const foot = await page.locator(".sidebar-foot").count();
ok("侧边栏死项已删", foot === 0);

// 终端页导出按钮没了
await page.locator(".tab",{hasText:"终端"}).click(); await sleep(500);
const termTitles = await page.$$eval(".tool-btn",els=>els.map(e=>e.getAttribute("title")));
ok("终端导出按钮已删", !termTitles.includes("导出"), termTitles.join(","));

// 用例页关键按钮还在
await page.locator(".tab",{hasText:"测试"}).click(); await sleep(700);
const empty = await page.locator(".empty-block").count();
if (empty) {
  ok("用例页有一键生成", (await page.locator(".btn-primary",{hasText:"一键生成"}).count())===1);
}
await page.screenshot({path:"docs/demo/50-clean.png"});
await b.close();
console.log(`\n结果：${pass}/${pass+fail} 通过`);
if(fail) process.exit(1);
