/** 서버 전용: BPMN XML → IR → 검증 → Solidity → solc 0.8.37. /api/compile 과 배포가 같이 쓴다. */
import { createRequire } from "node:module";
import type { Abi } from "viem";
import { lintBpmn, parseBpmn, type Diagnostic } from "@blockflow/bpmn";
import { generate, planScenarios } from "@blockflow/codegen";
import type { IR } from "@blockflow/ir";
import { checkSoundness, checkStructure } from "@blockflow/validator";

const require = createRequire(import.meta.url);

interface SolcOut {
  errors?: { severity: string; formattedMessage: string }[];
  contracts?: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string }; deployedBytecode?: { object: string } } }>>;
}

/** 배포 대상 EVM 버전 (BLOCKFLOW_EVM_VERSION). 기본 cancun. FISCO BCOS 3.7 LTS 같은 구버전 노드는 paris/shanghai. */
export function targetEvmVersion(): "paris" | "shanghai" | "cancun" {
  const v = process.env.BLOCKFLOW_EVM_VERSION;
  return v === "paris" || v === "shanghai" ? v : "cancun";
}

export function compileSolidity(name: string, source: string, withDeployed = false) {
  const solc = require("solc") as { compile: (input: string) => string; version: () => string };
  const input = {
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: targetEvmVersion(), outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", ...(withDeployed ? ["evm.deployedBytecode.object"] : [])] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOut;
  const diagnostics = (out.errors ?? []).map((e) => `${e.severity}: ${e.formattedMessage}`);
  const c = out.contracts?.[`${name}.sol`]?.[name];
  return {
    diagnostics, abi: (c?.abi ?? []) as Abi, solcVersion: solc.version(),
    bytecode: c ? (`0x${c.evm.bytecode.object}` as `0x${string}`) : undefined,
    deployedBytecode: c?.evm.deployedBytecode ? (`0x${c.evm.deployedBytecode.object}` as `0x${string}`) : undefined,
  };
}

export type CompileOutcome =
  | { ok: false; stage: "rules"; diagnostics: Diagnostic[] }
  | { ok: false; stage: "structure" | "soundness" | "solc"; problems: { message: string; node?: string; kind?: string }[]; states?: number; sol?: string }
  | { ok: true; ir: IR; sol: string; abi: Abi; bytecode: `0x${string}`; bytecodeBytes: number; solcVersion: string; evmVersion: string; states: number; paths: { description: string; outcome: string }[]; warnings: string[] };

export async function compileBpmn(xml: string): Promise<CompileOutcome> {
  const diagnostics = await lintBpmn(xml);
  if (diagnostics.length) return { ok: false, stage: "rules", diagnostics };
  const { ir, warnings } = await parseBpmn(xml);
  const structure = checkStructure(ir);
  if (structure.length) return { ok: false, stage: "structure", problems: structure.map((message) => ({ message })) };
  const sound = checkSoundness(ir);
  if (!sound.ok) return { ok: false, stage: "soundness", problems: sound.problems.map((p) => ({ kind: p.kind, message: p.message, ...(p.node ? { node: p.node } : {}) })), states: sound.states };
  const sol = generate(ir);
  const solc = compileSolidity(ir.process.id, sol);
  if (solc.diagnostics.length || !solc.bytecode) return { ok: false, stage: "solc", problems: solc.diagnostics.map((message) => ({ message })), sol };
  const plans = planScenarios(ir);
  return { ok: true, ir, sol, abi: solc.abi, bytecode: solc.bytecode, bytecodeBytes: (solc.bytecode.length - 2) / 2, solcVersion: solc.solcVersion, evmVersion: targetEvmVersion(), states: sound.states, paths: plans.map((p) => ({ description: p.description, outcome: p.outcome })), warnings };
}
