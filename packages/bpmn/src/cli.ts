#!/usr/bin/env tsx
/**
 * BPMN → IR → Solidity 파이프라인 CLI.
 *
 *   tsx packages/bpmn/src/cli.ts lint <file.bpmn>                      규칙 검사만
 *   tsx packages/bpmn/src/cli.ts compile <file.bpmn> [--ir a.json] [--sol a.sol] [--test a.t.sol]
 *   tsx packages/bpmn/src/cli.ts all <bpmnDir> <solDir> <testDir>       디렉터리 일괄 (gen:examples)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { generate, generateFoundryTest, GenerateError } from "@blockflow/codegen";
import { lintBpmn, parseBpmn, ParseError } from "./parse";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "lint") {
      const diags = await lintBpmn(readFileSync(rest[0]!, "utf8"));
      if (!diags.length) {
        console.log(`OK   ${rest[0]}`);
        return 0;
      }
      console.log(`FAIL ${rest[0]}`);
      for (const d of diags) console.log(`  [${d.rule}] ${d.message}${d.elementId ? ` (${d.elementId})` : ""}${d.detail ? `\n        ${d.detail}` : ""}`);
      return 1;
    }
    if (cmd === "compile") {
      const [file, ...opts] = rest;
      const opt = (k: string) => {
        const i = opts.indexOf(k);
        return i >= 0 ? opts[i + 1] : undefined;
      };
      const { ir, warnings } = await parseBpmn(readFileSync(file!, "utf8"));
      for (const w of warnings) console.error(`경고: ${w}`);
      const sol = generate(ir);
      const irOut = opt("--ir");
      const solOut = opt("--sol");
      const testOut = opt("--test");
      if (irOut) writeFileSync(irOut, JSON.stringify(ir, null, 2) + "\n");
      if (testOut) writeFileSync(testOut, generateFoundryTest(ir));
      if (solOut) writeFileSync(solOut, sol);
      else if (!irOut && !testOut) process.stdout.write(sol);
      return 0;
    }
    if (cmd === "all") {
      const [bpmnDir, solDir, testDir] = rest;
      if (!bpmnDir || !solDir || !testDir) throw new Error("사용법: all <bpmnDir> <solDir> <testDir>");
      mkdirSync(solDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });
      for (const f of readdirSync(bpmnDir).filter((x) => x.endsWith(".bpmn")).sort()) {
        const { ir } = await parseBpmn(readFileSync(join(bpmnDir, f), "utf8"));
        const sol = join(solDir, `${ir.process.id}.sol`);
        const test = join(testDir, `${ir.process.id}.t.sol`);
        writeFileSync(sol, generate(ir));
        writeFileSync(test, generateFoundryTest(ir));
        console.error(`${basename(f)} → ${sol}, ${test}`);
      }
      return 0;
    }
    throw new Error("사용법: lint <file> | compile <file> [--ir|--sol|--test <out>] | all <bpmnDir> <solDir> <testDir>");
  } catch (e) {
    if (e instanceof ParseError || e instanceof GenerateError) console.error(e.message);
    else console.error((e as Error).message);
    if (e instanceof GenerateError) for (const p of e.problems) console.error(`  - ${p}`);
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
