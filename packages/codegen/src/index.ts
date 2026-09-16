/**
 * @blockflow/codegen — IR → Solidity (가이드 6장).
 *
 *   generate(ir) → Solidity 소스 문자열
 *
 * 생성 전에 IR 구조 검사와 soundness 검사(@blockflow/validator)를 통과해야 한다.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import type { IR } from "@blockflow/ir";
import { checkStructure, checkSoundness } from "@blockflow/validator";
import { buildContext } from "./emit.js";

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");

function readTemplate(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, name), "utf8");
}

let cache: { contract: string; partials: Record<string, string> } | undefined;

function templates() {
  if (!cache) {
    cache = {
      contract: readTemplate("contract.sol.mustache"),
      partials: {
        roles: readTemplate("partials/roles.mustache"),
        flows: readTemplate("partials/flows.mustache"),
        task: readTemplate("partials/task.mustache"),
        step: readTemplate("partials/step.mustache"),
      },
    };
  }
  return cache;
}

export interface GenerateOptions {
  /** true 면 검증을 건너뛴다 (테스트용). 기본 false. */
  skipValidation?: boolean;
}

export class GenerateError extends Error {
  constructor(message: string, public readonly problems: string[]) {
    super(message);
    this.name = "GenerateError";
  }
}

export function generate(ir: IR, opts: GenerateOptions = {}): string {
  if (!opts.skipValidation) {
    const structure = checkStructure(ir);
    if (structure.length) throw new GenerateError("IR 구조 검사 실패", structure);
    const sound = checkSoundness(ir);
    if (!sound.ok) throw new GenerateError("Soundness 검사 실패", sound.problems.map((p) => p.message));
  }
  const ctx = buildContext(ir);
  const t = templates();
  // HTML 이스케이프 끄기 (Solidity 소스)
  return Mustache.render(t.contract, ctx, t.partials, { escape: (v: unknown) => String(v) });
}

export { buildContext } from "./emit.js";
export { compileExpr, parseExpr, renderExpr, evalExpr, ExprError, type Ast, type Value } from "./expr.js";
export { planScenarios, solValue, defaultRoleAddress, type Plan, type PlanStep, type PlanOptions } from "./scenarios.js";
export { generateFoundryTest, type FoundryTestOptions } from "./foundry.js";
export * as names from "./names.js";
