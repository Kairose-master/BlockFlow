#!/usr/bin/env tsx
/** tsx packages/validator/src/cli.ts <ir.json>... — 구조 + soundness 검사 결과를 출력한다. */
import { readFileSync } from "node:fs";
import type { IR } from "@blockflow/ir";
import { checkSoundness, checkStructure } from "./index.js";

let failed = false;
for (const path of process.argv.slice(2)) {
  const ir = JSON.parse(readFileSync(path, "utf8")) as IR;
  const structure = checkStructure(ir);
  const sound = checkSoundness(ir);
  const ok = structure.length === 0 && sound.ok;
  console.log(`${ok ? "OK  " : "FAIL"} ${path}  (${ir.process.id}, 도달 상태 ${sound.states}개)`);
  for (const p of structure) console.log(`     구조: ${p}`);
  for (const p of sound.problems) console.log(`     ${p.kind}: ${p.message}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
