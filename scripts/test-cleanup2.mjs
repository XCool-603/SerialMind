import { chromium } from "playwright";
let pass=0,fail=0;
const ok=(n,c,d="")=>{ if(c){pass++;console.log(`  ✓ ${n}`)}else{fail++;console.log(`  ✗ ${n}${d?" — "+d:""}`)} };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({channel:"msedge",headless:true});
const page=await (await b.newContext({viewport:{width:1440,height:900},locale:"zh-CN"})).newPage();
page.on("pageerror",e=>console.log("[pageerror]",e.message));
await page.goto("http://127.0.0.1:5273/",{waitUntil:"domcontentloaded",timeout:60000}); await sleep(2500);

// 删掉的假选项
await page.locator(".tab",{hasText:"协议"}).click(); await sleep(600);
const fakeTypes = await page.locator(".pdl-table").count();
console.log("（协议页存在）");

// 环境
await page.locator(".product-switch").first().click();
await page.locator(".menu-item",{hasText:"新建产品"}).click();
await page.locator(".dlg-input").first().fill("标签测试");
await page.locator(".dlg-foot .btn-primary").click(); await sleep(500);
await page.locator(".sidebar-head .add-btn").click();
await page.locator(".menu-item",{hasText:"新建子产品"}).click(); await sleep(400);
await page.locator(".dlg-row",{hasText:"名称"}).locator("input").fill("S");
await page.locator(".dlg-foot .btn-primary").click(); await sleep(650);
await page.locator(".link-status").click(); await sleep(300);
await page.locator(".menu-item",{hasText:"模拟设备"}).click(); await sleep(200);
await page.locator(".menu-item",{hasText:"连接"}).click(); await sleep(700);
await page.locator(".tab",{hasText:"测试"}).click(); await sleep(700);
await page.locator(".btn-primary",{hasText:"一键生成示例用例"}).click(); await sleep(900);
await page.locator(".dlg-foot .btn-primary").click(); await sleep(600);

// 打标签
await page.locator(".chip",{hasText:"设置"}).click(); await sleep(400);
const tagInput = page.locator(".setting-row",{hasText:"标签"}).locator("input");
ok("有标签输入框", (await tagInput.count())===1);
await tagInput.fill("冒烟"); await sleep(500);

// 套件页应能筛出 1 条
await page.locator(".test-mode-switch .chip",{hasText:"套件"}).click(); await sleep(800);
const smokeRow = await page.locator("tr",{hasText:"冒烟"}).first().innerText();
ok("冒烟套件显示 1 条用例", /\b1\b/.test(smokeRow), smokeRow.replace(/\s+/g," ").slice(0,80));

// 运行冒烟套件
await page.locator("tr",{hasText:"冒烟"}).first().locator("button",{hasText:"运行"}).click();
await sleep(3000);
const st = await page.$$eval("tr[data-status]",els=>els.map(e=>e.getAttribute("data-status")));
ok("冒烟套件能跑出结果", st.length>=1, st.join(","));

// 删掉的假选项确认
await page.locator(".tab",{hasText:"协议"}).click(); await sleep(600);
await page.locator(".pdl-table .pdl-tr:not(.head)").first().locator(".c-fmore .mv-btn").first().click();
await sleep(500);
const opts = await page.locator(".dlg-row",{hasText:"类型"}).locator("option").allInnerTexts();
ok("字段类型无 array/tlv/nested/reserved/timestamp", !opts.some(o=>/array|tlv|nested|reserved|timestamp/.test(o)), opts.join(","));
await page.locator(".dlg-foot .btn").first().click(); await sleep(300);

// 终端过滤器
await page.locator(".tab",{hasText:"终端"}).click(); await sleep(500);
const filters = await page.locator(".term-toolbar .chip").allInnerTexts();
ok("终端无「周期」「触发」", !filters.join(",").includes("周期") && !filters.join(",").includes("触发"), filters.join(","));
const inspTabs = await page.locator(".inspector-tabs .chip").allInnerTexts();
ok("检查器无「规则」页签", inspTabs.length===2, inspTabs.join(","));
await page.screenshot({path:"docs/demo/56-cleaned.png"});
await b.close();
console.log(`\n结果：${pass}/${pass+fail} 通过`);
if(fail) process.exit(1);
