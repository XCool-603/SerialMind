/**
 * 校验算法表验证（标准测试向量 "123456789"）
 * 运行： npx tsx scripts/test-checksums.ts
 */
import { ALGORITHM_META, CHECKSUM_ALGORITHMS, computeChecksum, type ChecksumAlgorithm } from "../src/engine/crc";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

const V = [...Buffer.from("123456789", "ascii")];

/** 标准校验目录（check value） */
const EXPECT: Partial<Record<ChecksumAlgorithm, number>> = {
  "CRC8": 0xf4,
  "CRC8/MAXIM": 0xa1,
  "CRC8/SAE-J1850": 0x4b,
  "CRC8/ROHC": 0xd0,
  "CRC16/ARC": 0xbb3d,
  "CRC16/MODBUS": 0x4b37,
  "CRC16/CCITT": 0x29b1,
  "CRC16/XMODEM": 0x31c3,
  "CRC16/X25": 0x906e,
  "CRC16/DNP": 0xea82,
  "CRC16/USB": 0xb4c8,
  "CRC32": 0xcbf43926,
  "CRC32C": 0xe3069283,
};

console.log(`\n算法总数：${CHECKSUM_ALGORITHMS.length}`);
console.log(CHECKSUM_ALGORITHMS.map((a) => ALGORITHM_META[a].label).join(" / "));

console.log("\n[1] 标准向量（\"123456789\"）");
for (const [alg, want] of Object.entries(EXPECT) as [ChecksumAlgorithm, number][]) {
  const got = computeChecksum(alg, V);
  check(
    `${alg} = 0x${want.toString(16).toUpperCase().padStart(2, "0")}`,
    got === want,
    `实际 0x${got.toString(16).toUpperCase()}`,
  );
}

console.log("\n[2] 累加 / 异或类（手算核对）");
{
  const sum = V.reduce((a, b) => (a + b) & 0xff, 0);
  check("ADD8 = Σ&0xFF", computeChecksum("ADD8", V) === sum, `0x${sum.toString(16)}`);
  check("ADD8 与旧名 SUM8 一致", computeChecksum("SUM8" as ChecksumAlgorithm, V) === sum);
  const sum16 = V.reduce((a, b) => (a + b) & 0xffff, 0);
  check("ADD16 = Σ&0xFFFF", computeChecksum("ADD16", V) === sum16, `0x${sum16.toString(16)}`);
  check("INV8 = 0xFF - ADD8", computeChecksum("INV8", V) === ((~sum & 0xff) >>> 0));
  check("NEG8 = 0x100 - ADD8", computeChecksum("NEG8", V) === ((0x100 - sum) & 0xff));
  check("NEG8 与 LRC 相同", computeChecksum("NEG8", V) === computeChecksum("LRC", V));
  const x = V.reduce((a, b) => a ^ b, 0);
  check("XOR8 = 逐字节异或", computeChecksum("XOR8", V) === x, `0x${x.toString(16)}`);
  check("BCC 与 XOR8 相同", computeChecksum("BCC", V) === computeChecksum("XOR8", V));
  check("NEGXOR8 = ~XOR8", computeChecksum("NEGXOR8", V) === ((~x & 0xff) >>> 0));
}

console.log("\n[3] ADD8 就是你说的 add8（与手算一致）");
{
  const frame = [0xde, 0x21, 0x09, 0xf6, 0x60, 0x00, 0x00, 0x00];
  const s = frame.reduce((a, b) => (a + b) & 0xff, 0);
  check("DE+21+09+F6+60+00+00+00 = 0x5E", s === 0x5e, `0x${s.toString(16).toUpperCase()}`);
  check("computeChecksum(ADD8) = 0x5E", computeChecksum("ADD8", frame) === 0x5e);
  check("computeChecksum(INV8) = 0xA1", computeChecksum("INV8", frame) === 0xa1, `0x${computeChecksum("INV8", frame).toString(16)}`);
  check("computeChecksum(NEG8) = 0xA2", computeChecksum("NEG8", frame) === 0xa2, `0x${computeChecksum("NEG8", frame).toString(16)}`);
}

console.log("\n[4] 每个算法都有元信息");
for (const a of CHECKSUM_ALGORITHMS) {
  const m = ALGORITHM_META[a];
  check(`${a} 有 label/formula/size`, !!m?.label && !!m?.formula && [1, 2, 4].includes(m?.size), JSON.stringify(m));
}

console.log(`\n${"=".repeat(48)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
console.log("校验算法表完整可用 ✅");
