/**
 * @blockflow/codegen — IR → Solidity (가이드 6장).
 *
 *   generate(ir) → Solidity 소스 문자열
 *
 * 생성 전에 IR 구조 검사와 soundness 검사(@blockflow/validator)를 통과해야 한다.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import type { IR } from "@blockflow/ir";
import { checkStructure, checkSoundness } from "@blockflow/validator";
import { buildContext } from "./emit";

/**
 * 템플릿 디렉터리. tsx/vitest 에서는 이 파일 기준 ../templates, 번들러(Next 등) 안에서는 import.meta.url 이
 * 쓸모없으므로 BLOCKFLOW_TEMPLATES_DIR 환경변수 → cwd 에서 위로 올라가며 packages/codegen/templates 를 찾는다.
 */
function findTemplateDir(): string {
  const candidates: string[] = [];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), "..", "templates"));
  } catch {
    /* import.meta.url 이 file: 이 아님 */
  }
  if (process.env.BLOCKFLOW_TEMPLATES_DIR) candidates.push(process.env.BLOCKFLOW_TEMPLATES_DIR);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.push(resolve(dir, "packages", "codegen", "templates"));
    dir = dirname(dir);
  }
  const found = candidates.find((c) => existsSync(join(c, "contract.sol.mustache")));
  if (!found) throw new Error(`codegen 템플릿 디렉터리를 찾을 수 없습니다. 후보: ${candidates.join(", ")}`);
  return found;
}

let templateDir: string | undefined;

function readTemplate(name: string): string {
  templateDir ??= findTemplateDir();
  return readFileSync(join(templateDir, name), "utf8");
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

export { buildContext } from "./emit";
export { compileExpr, parseExpr, renderExpr, evalExpr, ExprError, type Ast, type Value } from "./expr";
export { planScenarios, solValue, defaultRoleAddress, type Plan, type PlanStep, type PlanOptions } from "./scenarios";
export { generateFoundryTest, type FoundryTestOptions } from "./foundry";
export * as names from "./names";
