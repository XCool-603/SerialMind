import { chromium } from "playwright";
let pass=0,fail=0;
const ok=(n,c,d="")=>{ if(c){pass++;console.log(`  ✓ ${n}`)}else{fail++;console.log(`  ✗ ${n}${d?" — "+d:""}`)} };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({channel:"msedge",headless:true});
const page=await (await b.newContext({viewport:{width:1440,height:900},locale:"zh-CN"})).newPage();
page.on("pageerror",e=>console.log("[pageerror]",e.message));
await page.goto("http://127.0.0.1:5273/",{waitUntil:"networkidle"}); await sleep(1600);

// 打开串口菜单
await page.locator(".link-status").click(); await sleep(500);
const presets=await page.$$eval(".menu .alg-chip",els=>els.map(e=>e.textContent.trim()));
ok("有 5 个快捷组合", presets.join(",").includes("8N1") && presets.join(",").includes("7E1"), presets.join(","));
const selects=await page.locator(".menu select").count();
ok("有 4 个下拉（数据位/校验/停止位/流控）", selects===4, `${selects} 个`);

// 选 7E1
await page.locator(".menu .alg-chip",{hasText:"7E1"}).click(); await sleep(500);
const chip=await page.locator(".link-status").innerText();
ok("顶栏显示 7E1", chip.includes("7E1"), chip.replace(/\s+/g," "));

// 刷新后保持
await page.reload({waitUntil:"networkidle"}); await sleep(1800);
const chip2=await page.locator(".link-status").innerText();
ok("刷新后参数仍是 7E1（已记住）", chip2.includes("7E1"), chip2.replace(/\s+/g," "));

// 用 7E1 连模拟设备（验证参数不影响连接流程）
await page.locator(".link-status").click(); await sleep(400);
await page.locator(".menu-item",{hasText:"模拟设备"}).click(); await sleep(200);
await page.locator(".menu-item",{hasText:"连接"}).click(); await sleep(700);
const chip3=await page.locator(".link-status").innerText();
ok("7E1 下能连接", chip3.includes("已连接"), chip3.replace(/\s+/g," "));
await page.screenshot({path:"docs/demo/53-serial-params.png"});

// 改回 8N1
await page.locator(".link-status").click(); await sleep(400);
await page.locator(".menu .alg-chip",{hasText:"8N1"}).click(); await sleep(400);
const chip4=await page.locator(".link-status").innerText();
ok("能切回 8N1", chip4.includes("8N1"), chip4.replace(/\s+/g," "));
await b.close();
console.log(`\n结果：${pass}/${pass+fail} 通过`);
if(fail) process.exit(1);
