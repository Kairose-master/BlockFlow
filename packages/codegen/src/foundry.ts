/**
 * foundry.ts — IR → Foundry 테스트 (.t.sol) 생성 (가이드 7.4, 부록 D).
 *
 *   {Name}Handler    : 무작위 역할 계정이 무작위 태스크를 호출 (거부는 정상, fail_on_revert = false)
 *   {Name}Invariants : noGhostTokens · endedMeansEmpty · noDeadlock · xorExclusive
 *   {Name}Scenarios  : planScenarios() 가 만든 도달 경로마다 test_path_<n> (활성화 전/권한 없음/종료 후 거부 포함)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import { type IR, maskOf, nodesOfKind, userTasks } from "@blockflow/ir";
import { roleConst, screamingSnake, taskConst, uniqueName } from "./names.js";
import { defaultRoleAddress, type Plan, planScenarios, solValue } from "./scenarios.js";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "test.t.sol.mustache");

function hex(m: bigint): string {
  return "0x" + m.toString(16);
}

/** 주소 리터럴. 40자리 hex 는 체크섬 검사를 받으므로 uint160 정수로 만든다. */
function solAddress(addrHex: string): string {
  return `address(uint160(${BigInt(addrHex).toString()}))`;
}

export interface FoundryTestOptions {
  /** 컨트랙트 소스의 상대 경로 (import 용). 기본 "../../src/{Name}.sol" */
  importPath?: string;
  plans?: Plan[];
}

export function generateFoundryTest(ir: IR, opts: FoundryTestOptions = {}): string {
  const name = ir.process.id;
  const varType = new Map(ir.variables.map((v) => [v.name, v.type]));
  const tasks = userTasks(ir);
  const usedTags = new Set<string>();
  const taskConstOf = new Map(tasks.map((t) => [t.id, taskConst(uniqueName(t.tag ?? screamingSnake(t.name), usedTags))]));
  const roleVar = (key: string) => "acc" + key.replace(/[^A-Za-z0-9_]/g, "");
  const roleIndex = new Map(ir.roles.map((r, i) => [r.key, i]));
  const plans = opts.plans ?? planScenarios(ir);

  const ctx = {
    contractName: name,
    importPath: opts.importPath ?? `../../src/${name}.sol`,
    roleCount: ir.roles.length,
    accList: ir.roles.map((_, i) => solAddress(defaultRoleAddress(i))).join(", "),
    roles: ir.roles.map((r, i) => ({ var: roleVar(r.key), addr: solAddress(defaultRoleAddress(i)), const: roleConst(r.key) })),
    taskConsts: tasks.map((t) => ({ const: taskConstOf.get(t.id) })),
    roleVars: ir.roles.map((r) => roleVar(r.key)).join(", "),
    allFlowsMask: hex(maskOf(ir, ir.flows.map((f) => f.id))),
    tasks: tasks.map((t) => ({
      name: t.name,
      params: t.inputs.map((i) => ({ type: varType.get(i.variable), name: i.variable })),
    })),
    xorPairs: nodesOfKind(ir, "xorSplit").flatMap((x) => {
      const outs = [...x.branches.map((b) => b.flow), x.default];
      const pairs: { id: string; a: string; b: string }[] = [];
      for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) {
        pairs.push({ id: x.id, a: hex(maskOf(ir, [outs[i]!])), b: hex(maskOf(ir, [outs[j]!])) });
      }
      return pairs;
    }),
    plans: plans.map((p) => {
      const firstTask = tasks[0]!;
      return {
        index: p.index,
        description: p.description,
        outcome: p.outcome,
        steps: p.steps.map((s) => {
          const args = s.task.inputs.map((i) => `, ${solValue(s.args[i.variable]!, varType.get(i.variable)!)}`).join("");
          const actor = roleVar(s.task.role);
          const negatives: { actor: string; fn: string; args: string; error: string; errorArgs: string }[] = [
            { actor: "stranger", fn: s.task.name, args, error: "NotAuthorized", errorArgs: `, id, ${roleConst(s.task.role)}` },
          ];
          if (s.disabledTask) {
            const d = s.disabledTask;
            const dargs = d.inputs.map((i) => `, ${solValue(zeroOf(varType.get(i.variable)!), varType.get(i.variable)!)}`).join("");
            negatives.push({ actor: roleVar(d.role), fn: d.name, args: dargs, error: "TaskNotEnabled", errorArgs: `, id, ${taskConstOf.get(d.id)}` });
          }
          return {
            actor,
            fn: s.task.name,
            args,
            markingAfter: hex(s.markingAfter),
            endedAfter: s.endedAfter,
            completed: s.outcomeAfter === "completed",
            negatives,
          };
        }),
        final: {
          actor: roleVar(firstTask.role),
          fn: firstTask.name,
          args: firstTask.inputs.map((i) => `, ${solValue(zeroOf(varType.get(i.variable)!), varType.get(i.variable)!)}`).join(""),
        },
      };
    }),
    roleIndexOf: (key: string) => roleIndex.get(key),
  };
  const tpl = readFileSync(TEMPLATE, "utf8");
  return Mustache.render(tpl, ctx, {}, { escape: (v: unknown) => String(v) });
}

function zeroOf(type: string): bigint | boolean | string {
  switch (type) {
    case "bool":
      return false;
    case "bytes32":
      return "0x" + "0".repeat(64);
    case "address":
      return "0x" + "0".repeat(40);
    default:
      return 0n;
  }
}
