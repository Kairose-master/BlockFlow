/**
 * scenarios.ts — V4 시나리오 생성 (가이드 7.4): IR 의 도달 경로마다 구체적인 실행 계획(Plan) 을 만든다.
 *
 * 컨트랙트 의미론(_fire/_step)을 그대로 흉내 내는 시뮬레이터 위에서, 각 태스크 입력에 후보값(조건식의
 * 리터럴 ±1, 0/1/2, true/false …)을 대입해 DFS 로 탐색한다. 같은 "태스크 순서 + XOR 결정" 을 가진 경로는
 * 하나만 남긴다 (경로 커버리지 100%, 값 중복 제거).
 *
 * Plan 은 Foundry 테스트(foundry.ts)와 JS EVM 테스트가 같이 쓴다.
 */
import { type IR, type UserTaskNode, maskOf, nodesOfKind, userTasks } from "@blockflow/ir";
import { type Ast, type Value, evalExpr, literalsFor, parseExpr } from "./expr.js";

export interface PlanStep {
  task: UserTaskNode;
  /** 입력 변수 이름 → 값 */
  args: Record<string, Value>;
  markingAfter: bigint;
  endedAfter: boolean;
  /** endedAfter 일 때 마지막으로 발화한 종료 이벤트의 outcome */
  outcomeAfter?: string;
  /** 이 단계 직전에 활성화되지 않은 태스크 하나 (TaskNotEnabled 음성 테스트용) */
  disabledTask?: UserTaskNode;
}

export interface Plan {
  index: number;
  /** 사람이 읽는 설명: "submit → approve → pay | X1→F3, X2→F11" */
  description: string;
  steps: PlanStep[];
  /** XOR 결정 목록 ("X1→F3") */
  decisions: string[];
  outcome: string;
}

export interface PlanOptions {
  /** 역할 키 → 주소 (조건식의 role(X) 평가용). 기본: address(0xA1 + i). */
  roleAddresses?: ReadonlyMap<string, string>;
  maxPlans?: number;
  maxStates?: number;
}

export function defaultRoleAddress(index: number): string {
  return "0x" + (0xa1 + index).toString(16).padStart(40, "0");
}

interface Sim {
  xors: { id: string; inMask: bigint; branches: { flow: string; mask: bigint; ast: Ast }[]; defaultFlow: string; defaultMask: bigint }[];
  andSplits: { inMask: bigint; outMask: bigint }[];
  andJoins: { inMask: bigint; outMask: bigint }[];
  ends: { inMask: bigint; outcome: string }[];
}

function buildSim(ir: IR): Sim {
  return {
    xors: nodesOfKind(ir, "xorSplit").map((n) => ({
      id: n.id,
      inMask: maskOf(ir, n.in),
      branches: n.branches.map((b) => ({ flow: b.flow, mask: maskOf(ir, [b.flow]), ast: parseExpr(b.cond, ir).ast })),
      defaultFlow: n.default,
      defaultMask: maskOf(ir, [n.default]),
    })),
    andSplits: nodesOfKind(ir, "andSplit").map((n) => ({ inMask: maskOf(ir, n.in), outMask: maskOf(ir, n.out) })),
    andJoins: nodesOfKind(ir, "andJoin").map((n) => ({ inMask: maskOf(ir, n.in), outMask: maskOf(ir, n.out) })),
    ends: nodesOfKind(ir, "endEvent").map((n) => ({ inMask: maskOf(ir, n.in), outcome: n.outcome })),
  };
}

/** _step() 과 같은 순서로 침묵 전이를 고정점까지 실행한다. */
function step(sim: Sim, m: bigint, env: { vars: Map<string, Value>; roles: ReadonlyMap<string, string> }, decisions: string[]) {
  let ended = false;
  let outcome: string | undefined;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const x of sim.xors) {
      if ((m & x.inMask) !== 0n) {
        m &= ~x.inMask;
        const taken = x.branches.find((b) => evalExpr(b.ast, env));
        m |= taken ? taken.mask : x.defaultMask;
        decisions.push(`${x.id}→${taken ? taken.flow : x.defaultFlow}`);
        progressed = true;
      }
    }
    for (const a of sim.andSplits) {
      if ((m & a.inMask) !== 0n) {
        m = (m & ~a.inMask) | a.outMask;
        progressed = true;
      }
    }
    for (const a of sim.andJoins) {
      if ((m & a.inMask) === a.inMask) {
        m = (m & ~a.inMask) | a.outMask;
        progressed = true;
      }
    }
    for (const e of sim.ends) {
      if ((m & e.inMask) !== 0n) {
        m &= ~e.inMask;
        ended = true;
        outcome = e.outcome;
        progressed = true;
      }
    }
  }
  return { m, ended, outcome };
}

/** 변수별 후보값. 결정적 순서. */
function candidates(ir: IR, roleAddrs: string[]): Map<string, Value[]> {
  const asts = nodesOfKind(ir, "xorSplit").flatMap((n) => n.branches.map((b) => parseExpr(b.cond, ir).ast));
  const out = new Map<string, Value[]>();
  for (const v of ir.variables) {
    switch (v.type) {
      case "uint256":
      case "int256": {
        const set = new Set<bigint>([0n, 1n, 2n]);
        for (const ast of asts) for (const l of literalsFor(ast, v.name)) for (const d of [-1n, 0n, 1n]) set.add(l + d);
        const vals = [...set].filter((x) => v.type === "int256" || x >= 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        out.set(v.name, vals);
        break;
      }
      case "bool":
        out.set(v.name, [false, true]);
        break;
      case "bytes32":
        out.set(v.name, ["0x" + ir.variables.indexOf(v).toString(16).padStart(63, "0") + "1"]);
        break;
      case "address":
        out.set(v.name, roleAddrs);
        break;
    }
  }
  return out;
}

function* combos(lists: Value[][]): Generator<Value[]> {
  if (!lists.length) {
    yield [];
    return;
  }
  const [head, ...tail] = lists;
  for (const h of head!) for (const rest of combos(tail)) yield [h, ...rest];
}

export function planScenarios(ir: IR, opts: PlanOptions = {}): Plan[] {
  const maxPlans = opts.maxPlans ?? 64;
  const maxStates = opts.maxStates ?? 5000;
  const roles = opts.roleAddresses ?? new Map(ir.roles.map((r, i) => [r.key, defaultRoleAddress(i)]));
  const roleAddrs = ir.roles.map((r) => roles.get(r.key)!.toLowerCase());
  const sim = buildSim(ir);
  const cands = candidates(ir, roleAddrs);
  const tasks = userTasks(ir).map((t) => ({ t, inMask: maskOf(ir, t.in), outMask: maskOf(ir, t.out) }));
  const start = nodesOfKind(ir, "startEvent")[0];
  if (!start) throw new Error("시작 이벤트가 없습니다");
  const m0 = maskOf(ir, start.out);

  interface State {
    m: bigint;
    ended: boolean;
    vars: Map<string, Value>;
    steps: PlanStep[];
    decisions: string[];
    outcome?: string;
  }
  // 상태 키에 경로(태스크 순서)를 포함해 병렬 가지의 인터리빙도 서로 다른 경로로 센다.
  const key = (s: State) =>
    `${s.m}|${s.ended}|${[...s.vars.entries()].sort().map(([k, v]) => `${k}=${String(v)}`).join(",")}|${s.steps.map((x) => x.task.id).join(",")}`;
  const visited = new Set<string>();
  const plans: Plan[] = [];
  const seenPaths = new Set<string>();
  const stack: State[] = [{ m: m0, ended: false, vars: new Map(), steps: [], decisions: [] }];
  visited.add(key(stack[0]!));
  let states = 0;

  while (stack.length && plans.length < maxPlans && states < maxStates) {
    const s = stack.pop()!;
    states++;
    if (s.ended) {
      const pathKey = `${s.steps.map((x) => x.task.id).join(",")}|${s.decisions.join(",")}`;
      if (!seenPaths.has(pathKey)) {
        seenPaths.add(pathKey);
        plans.push({
          index: plans.length + 1,
          description: `${s.steps.map((x) => x.task.name).join(" → ")}${s.decisions.length ? ` | ${s.decisions.join(", ")}` : ""}`,
          steps: s.steps,
          decisions: s.decisions,
          outcome: s.outcome ?? "completed",
        });
      }
      continue;
    }
    const enabled = tasks.filter((x) => (s.m & x.inMask) !== 0n);
    // DFS 순서를 결정적으로: IR 순서의 역순으로 push 해서 IR 순서대로 pop
    const next: State[] = [];
    for (const x of enabled) {
      const disabledTask = tasks.find((y) => (s.m & y.inMask) === 0n)?.t;
      for (const combo of combos(x.t.inputs.map((i) => cands.get(i.variable) ?? []))) {
        const vars = new Map(s.vars);
        const args: Record<string, Value> = {};
        x.t.inputs.forEach((inp, i) => {
          vars.set(inp.variable, combo[i]!);
          args[inp.variable] = combo[i]!;
        });
        const decisions = [...s.decisions];
        const r = step(sim, (s.m & ~x.inMask) | x.outMask, { vars, roles }, decisions);
        const stepRec: PlanStep = { task: x.t, args, markingAfter: r.m, endedAfter: r.ended };
        if (r.outcome !== undefined) stepRec.outcomeAfter = r.outcome;
        if (disabledTask) stepRec.disabledTask = disabledTask;
        const ns: State = { m: r.m, ended: r.ended, vars, steps: [...s.steps, stepRec], decisions };
        if (r.outcome !== undefined) ns.outcome = r.outcome;
        const k = key(ns);
        if (!visited.has(k)) {
          visited.add(k);
          next.push(ns);
        }
      }
    }
    for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]!);
  }
  return plans;
}

/** Solidity 리터럴로 렌더링 (Foundry 테스트용). */
export function solValue(v: Value, type: string): string {
  switch (type) {
    case "bool":
      return String(v);
    case "uint256":
      return (v as bigint).toString();
    case "int256":
      return (v as bigint) < 0n ? `int256(${(v as bigint).toString()})` : (v as bigint).toString();
    case "bytes32":
      return `bytes32(${v as string})`;
    case "address":
      return `address(uint160(${BigInt(v as string).toString()}))`;
    default:
      throw new Error(`알 수 없는 타입 ${type}`);
  }
}
