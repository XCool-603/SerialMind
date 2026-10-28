/**
 * 引擎自检（与设置里的「引擎自检」同一套断言）
 * 运行： npx tsx scripts/test-engine.ts
 */
import { runSelfTest } from "../src/engine/selftest";

const items = runSelfTest();
let pass = 0;
for (const it of items) {
  console.log(`  ${it.ok ? "✓" : "✗"} ${it.name}  [${it.ms}ms]${it.ok ? "" : "  → " + it.detail}`);
  if (it.ok) pass++;
}
console.log(`\n${pass}/${items.length} 通过`);
if (pass !== items.length) process.exit(1);
