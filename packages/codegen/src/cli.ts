#!/usr/bin/env tsx
/**
 * CLI:
 *   tsx packages/codegen/src/cli.ts <ir.json>                 → stdout 으로 Solidity
 *   tsx packages/codegen/src/cli.ts <ir.json> -o <out.sol>
 *   tsx packages/codegen/src/cli.ts --all <irDir> <outDir>    → 디렉터리의 모든 IR 을 <outDir>/<ContractName>.sol 로
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IR } from "@blockflow/ir";
import { generate, GenerateError } from "./index.js";

function loadIR(path: string): IR {
  return JSON.parse(readFileSync(path, "utf8")) as IR;
}

function main(argv: string[]): number {
  try {
    if (argv[0] === "--all") {
      const [, irDir, outDir] = argv;
      if (!irDir || !outDir) throw new Error("사용법: --all <irDir> <outDir>");
      mkdirSync(outDir, { recursive: true });
      for (const f of readdirSync(irDir).filter((x) => x.endsWith(".json")).sort()) {
        const ir = loadIR(join(irDir, f));
        const out = join(outDir, `${ir.process.id}.sol`);
        writeFileSync(out, generate(ir));
        console.error(`${f} → ${out}`);
      }
      return 0;
    }
    const [irPath, flag, outPath] = argv;
    if (!irPath) throw new Error("사용법: <ir.json> [-o <out.sol>]");
    const sol = generate(loadIR(irPath));
    if (flag === "-o" && outPath) {
      writeFileSync(outPath, sol);
      console.error(`→ ${outPath}`);
    } else {
      process.stdout.write(sol);
    }
    return 0;
  } catch (e) {
    if (e instanceof GenerateError) {
      console.error(`${e.message}:`);
      for (const p of e.problems) console.error(`  - ${p}`);
    } else {
      console.error((e as Error).message);
    }
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
