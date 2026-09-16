/**
 * POST /api/compile { xml } → 규칙(V1) → IR → 구조/soundness(V2) → Solidity → solc 0.8.37 (경고 0 요구).
 * 가이드 3.2 "컴파일" + "정적 검증" 단계의 서버 쪽. Slither/SMTChecker 는 CI (V3).
 */
import { createRequire } from "node:module";
import { NextResponse } from "next/server";
import { lintBpmn, parseBpmn } from "@blockflow/bpmn";
import { generate, planScenarios } from "@blockflow/codegen";
import { checkSoundness, checkStructure } from "@blockflow/validator";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);

interface SolcOut {
  errors?: { severity: string; formattedMessage: string }[];
  contracts?: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>;
}

function compileSolidity(name: string, source: string) {
  const solc = require("solc") as { compile: (input: string) => string; version: () => string };
  const input = {
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOut;
  const diagnostics = (out.errors ?? []).map((e) => `${e.severity}: ${e.formattedMessage}`);
  const c = out.contracts?.[`${name}.sol`]?.[name];
  return { diagnostics, abi: c?.abi ?? [], bytecode: c ? `0x${c.evm.bytecode.object}` : undefined, solcVersion: solc.version() };
}

export async function POST(req: Request) {
  const { xml } = (await req.json()) as { xml?: string };
  if (typeof xml !== "string") return NextResponse.json({ ok: false, stage: "input", message: "xml 이 없습니다" }, { status: 400 });

  const diagnostics = await lintBpmn(xml);
  if (diagnostics.length) return NextResponse.json({ ok: false, stage: "rules", diagnostics });

  const { ir, warnings } = await parseBpmn(xml);
  const structure = checkStructure(ir);
  if (structure.length) return NextResponse.json({ ok: false, stage: "structure", problems: structure });
  const sound = checkSoundness(ir);
  if (!sound.ok) return NextResponse.json({ ok: false, stage: "soundness", problems: sound.problems.map((p) => ({ kind: p.kind, message: p.message, node: p.node })), states: sound.states });

  const sol = generate(ir);
  const solc = compileSolidity(ir.process.id, sol);
  if (solc.diagnostics.length || !solc.bytecode) return NextResponse.json({ ok: false, stage: "solc", problems: solc.diagnostics, sol });

  const plans = planScenarios(ir);
  return NextResponse.json({
    ok: true,
    ir,
    sol,
    abi: solc.abi,
    bytecode: solc.bytecode,
    bytecodeBytes: (solc.bytecode.length - 2) / 2,
    solcVersion: solc.solcVersion,
    states: sound.states,
    paths: plans.map((p) => ({ description: p.description, outcome: p.outcome })),
    warnings,
  });
}
