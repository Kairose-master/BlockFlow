#!/usr/bin/env tsx
/** pnpm chain:probe <rpcUrl> — viem 어댑터 호환성 점검 (FISCO BCOS Ethereum 호환 레인, Base, Kaia …) */
import { describeProbe, probeRpc } from "./probe";

const url = process.argv[2];
if (!url) {
  console.error("사용법: chain:probe <rpcUrl>");
  process.exit(2);
}
const p = await probeRpc(url);
for (const line of describeProbe(p)) console.log(line);
console.log(Object.entries(p.methods).map(([m, ok]) => `${ok ? "✓" : "✗"} ${m}`).join("\n"));
process.exit(p.ok ? 0 : 1);
