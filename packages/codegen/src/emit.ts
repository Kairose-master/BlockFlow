/**
 * emit.ts — IR → Mustache 템플릿 컨텍스트 (가이드 6.1~6.5, 6.7).
 *
 * 정렬(패딩)·주석·비트마스크 문자열은 전부 여기서 계산하고, 템플릿은 줄 배치만 담당한다.
 * 출력은 결정적이어야 한다 (같은 IR → 같은 Solidity).
 */
import {
  type EndEventNode,
  type IR,
  type Node,
  type UserTaskNode,
  flowById,
  nodeById,
  nodesOfKind,
  outFlows,
  userTasks,
} from "@blockflow/ir";
import { compileExpr } from "./expr";
import { getAddress } from "viem";
import { padEnd, roleConst, screamingSnake, taskConst, uniqueName } from "./names";

export interface TemplateContext {
  contractName: string;
  processName: string;
  /** L1 결제 태스크가 하나라도 있으면 IERC20 인터페이스·nonReentrant·PaymentFailed 를 낸다 */
  hasPayment: boolean;
  /** L1 타이머가 하나라도 있으면 startedAt·_stamp·expire 함수·TaskExpired/NotExpired 를 낸다 */
  hasTimer: boolean;
  timers: TimerCtx[];
  roles: { line: string }[];
  roleCount: number;
  roleOrder: string;
  roleConsts: string;
  flows: { line: string }[];
  taskConsts: { line: string }[];
  vars: { line: string }[];
  tasks: TaskCtx[];
  steps: StepCtx[];
  enabled: { inMask: string; taskConst: string }[];
  /** 시작 이벤트가 토큰을 놓는 첫 플로우. */
  startFlow: string;
}

export interface TimerCtx {
  doc: string;
  /** expire 함수 이름 (expire + FnName) */
  fn: string;
  taskConst: string;
  inMask: string;
  outMask: string;
  /** Solidity 식: vars[id].x 또는 리터럴 초 */
  deadline: string;
}

export interface TaskCtx {
  doc: string;
  name: string;
  params: string;
  roleConst: string;
  inMask: string;
  outMask: string;
  taskConst: string;
  /** vars[id].variable = param (함수 이름과 같은 변수는 매개변수 이름에 _ 를 붙여 섀도잉 경고를 피한다) */
  sets: { variable: string; param: string }[];
  /** L1 결제: 완료 후 transferFrom(msg.sender, to, amount) */
  payment?: { token: string; to: string; amountVar: string };
}

/** step.mustache 는 xor/andSplit/andJoin/end 중 하나의 섹션만 렌더링한다. */
export interface StepCtx {
  comment: string;
  inMask: string;
  xor?: { ternary: string };
  andSplit?: { outMask: string };
  andJoin?: { outMask: string };
  end?: { completed: "true" | "false" };
}

/** 플로우 id 목록 → Solidity 마스크 식. 하나면 `F3`, 여럿이면 `(F4 | F11)`. */
function mask(ids: readonly string[]): string {
  return ids.length === 1 ? ids[0]! : `(${ids.join(" | ")})`;
}

function taskTag(t: UserTaskNode): string {
  return t.tag ?? screamingSnake(t.name);
}

/** 플로우 주석의 왼쪽 `X1 [default]` 부분. */
function flowFromLabel(ir: IR, flowId: string): string {
  const f = flowById(ir, flowId);
  const from = nodeById(ir, f.from);
  if (from.kind === "startEvent") return "Start";
  if (from.kind === "xorSplit") return `${from.id} [${f.default ? "default" : "yes"}]`;
  if (f.timer) return `${from.id} [timeout]`;
  return from.id;
}

/**
 * 플로우 주석의 오른쪽 `T1 submit` / `X1 (XOR: amount>1000?)` 부분.
 * 게이트웨이 설명 괄호는 그 노드로 들어가는 첫 플로우(비트 순)에만 붙인다.
 */
function flowToLabel(ir: IR, flowId: string, described: Set<string>): string {
  const to = nodeById(ir, flowById(ir, flowId).to);
  const first = !described.has(to.id);
  described.add(to.id);
  switch (to.kind) {
    case "userTask":
      return `${to.id} ${to.name}`;
    case "xorSplit":
      return first ? `${to.id} (XOR: ${to.branches.map((b) => b.cond.replace(/\s+/g, "")).join("|")}?)` : to.id;
    case "andSplit":
      return first ? `${to.id} (AND split)` : to.id;
    case "andJoin":
      return first ? `${to.id} (AND join)` : to.id;
    case "endEvent":
      return to.outcome === "completed" ? "End" : `End (${endLabel(to)})`;
    case "startEvent":
      throw new Error(`플로우 ${flowId} 가 시작 이벤트로 들어갑니다`);
  }
}

function endLabel(n: EndEventNode): string {
  return n.label ?? n.outcome;
}

function stepComment(n: Node): string {
  switch (n.kind) {
    case "xorSplit": {
      const outs = [...n.branches.map((b) => `${b.flow} [${b.cond}]`), `${n.default} [default]`];
      return `${n.id}: XOR split  in: ${n.in.join(" | ")}  out: ${outs.join(" | ")}`;
    }
    case "andSplit":
      return `${n.id}: AND split  in: ${n.in.join(" | ")}  out: ${n.out.join(" & ")}`;
    case "andJoin":
      return `${n.id}: AND join  in: ${n.in.join(" & ")}  out: ${n.out.join(" | ")}`;
    case "endEvent":
      return `End (${n.outcome === "completed" ? "정상" : endLabel(n)} 종료)  in: ${n.in.join(" | ")}`;
    default:
      throw new Error(`침묵 전이가 아닙니다: ${n.id} (${n.kind})`);
  }
}

export function buildContext(ir: IR): TemplateContext {
  const varType = new Map(ir.variables.map((v) => [v.name, v.type]));
  const tasks = userTasks(ir);

  // ── 역할 상수 (정렬) ──
  const roleNames = ir.roles.map((r) => roleConst(r.key));
  const roleWidth = Math.max(...roleNames.map((n) => n.length));
  const roles = ir.roles.map((r, i) => ({
    line: `bytes32 public constant ${padEnd(roleNames[i]!, roleWidth)} = keccak256("${r.key}");`,
  }));

  // ── 플로우 비트 상수 (정렬) ──
  const sortedFlows = [...ir.flows].sort((a, b) => a.bit - b.bit);
  const flowWidth = Math.max(...sortedFlows.map((f) => f.id.length));
  const shiftWidth = Math.max(...sortedFlows.map((f) => String(f.bit).length));
  const fromLabels = sortedFlows.map((f) => flowFromLabel(ir, f.id));
  const fromWidth = Math.max(...fromLabels.map((s) => s.length));
  const described = new Set<string>();
  const flows = sortedFlows.map((f, i) => ({
    line:
      `uint256 private constant ${padEnd(f.id, flowWidth)} = 1 << ${padEnd(`${f.bit};`, shiftWidth + 1)} ` +
      `// ${padEnd(fromLabels[i]!, fromWidth)} -> ${flowToLabel(ir, f.id, described)}`,
  }));

  // ── 태스크 상수 (정렬, 이름 충돌 시 _2) ──
  const usedTags = new Set<string>();
  const tags = tasks.map((t) => uniqueName(taskTag(t), usedTags));
  const taskConstNames = tags.map((t) => taskConst(t));
  const taskWidth = Math.max(...taskConstNames.map((n) => n.length));
  const taskConsts = tasks.map((t, i) => ({
    line: `uint8 public constant ${padEnd(taskConstNames[i]!, taskWidth)} = ${t.taskId};`,
  }));

  // ── 프로세스 변수 ──
  const vars = ir.variables.map((v) => ({
    line: `${v.type} ${v.name};${v.type === "bytes32" ? " // 오프체인 문서는 해시만 저장" : ""}`,
  }));

  // ── 사용자 태스크 함수 ──
  const usedFnNames = new Set<string>();
  const taskCtxs: TaskCtx[] = tasks.map((t, i) => {
    const fnName = uniqueName(t.name, usedFnNames);
    const paramName = (v: string) => (v === fnName ? `${v}_` : v);
    const params = ["uint256 id", ...t.inputs.map((inp) => `${varType.get(inp.variable)} ${paramName(inp.variable)}`)].join(", ");
    const sets = t.inputs.length ? `  sets: ${t.inputs.map((x) => x.variable).join(", ")}` : "";
    const pays = t.payment ? `  pays: ${t.payment.amountVar} → ${"role" in t.payment.to ? t.payment.to.role : t.payment.to.address}` : "";
    const ctx: TaskCtx = {
      doc: `/// T${t.taskId}: ${t.label} [${t.role}]  in: ${t.in.join(" | ")}  out: ${t.out.join(" | ")}${sets}${pays}`,
      name: fnName,
      params,
      roleConst: roleConst(t.role),
      inMask: mask(t.in),
      outMask: mask(t.out),
      taskConst: taskConstNames[i]!,
      sets: t.inputs.map((x) => ({ variable: x.variable, param: paramName(x.variable) })),
    };
    if (t.payment) {
      ctx.payment = {
        token: getAddress(t.payment.token), // 주소 리터럴은 체크섬 형식이어야 컴파일된다
        to: "role" in t.payment.to ? `roleOf[id][${roleConst(t.payment.to.role)}]` : getAddress(t.payment.to.address),
        amountVar: t.payment.amountVar,
      };
    }
    return ctx;
  });

  // ── 침묵 전이: XOR → AND split → AND join → End (5.2) ──
  const silent = ir.silent.map((id) => nodeById(ir, id));
  const steps: StepCtx[] = [];
  for (const n of nodesOfKind(ir, "xorSplit").filter((n) => silent.includes(n))) {
    const branches = n.branches.map((b) => {
      const c = compileExpr(b.cond, ir);
      return `${c.atomic ? c.sol : `(${c.sol})`} ? ${b.flow}`;
    });
    steps.push({ comment: stepComment(n), inMask: mask(n.in), xor: { ternary: `${branches.join(" : ")} : ${n.default}` } });
  }
  for (const n of nodesOfKind(ir, "andSplit").filter((n) => silent.includes(n))) {
    steps.push({ comment: stepComment(n), inMask: mask(n.in), andSplit: { outMask: `(${n.out.join(" | ")})` } });
  }
  for (const n of nodesOfKind(ir, "andJoin").filter((n) => silent.includes(n))) {
    steps.push({ comment: stepComment(n), inMask: `(${n.in.join(" | ")})`, andJoin: { outMask: mask(n.out) } });
  }
  for (const n of nodesOfKind(ir, "endEvent").filter((n) => silent.includes(n))) {
    steps.push({ comment: stepComment(n), inMask: mask(n.in), end: { completed: n.outcome === "completed" ? "true" : "false" } });
  }

  // ── L1 타이머 ──
  const timers: TimerCtx[] = tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.timer)
    .map(({ t, i }) => {
      const d = t.timer!.deadline;
      const fnName = taskCtxs[i]!.name;
      return {
        doc: `/// T${t.taskId} timeout: ${t.label} 기한(${"var" in d ? d.var : `${d.seconds}s`}) 경과 시 누구나 호출  in: ${t.in.join(" | ")}  out: ${t.timer!.out}`,
        fn: `expire${fnName.charAt(0).toUpperCase()}${fnName.slice(1)}`,
        taskConst: taskConstNames[i]!,
        inMask: mask(t.in),
        outMask: mask([t.timer!.out]),
        deadline: "var" in d ? `vars[id].${d.var}` : String(d.seconds),
      };
    });

  // ── 조회 ──
  const enabled = tasks.map((t, i) => ({ inMask: mask(t.in), taskConst: taskConstNames[i]! }));

  // 시작 이벤트 → 첫 플로우
  const start = nodesOfKind(ir, "startEvent")[0];
  if (!start) throw new Error("시작 이벤트가 없습니다");
  const startFlow = outFlows(start)[0];
  if (!startFlow) throw new Error("시작 이벤트에 나가는 플로우가 없습니다");

  return {
    contractName: ir.process.id,
    processName: ir.process.name,
    hasPayment: tasks.some((t) => !!t.payment),
    hasTimer: timers.length > 0,
    timers,
    roles,
    roleCount: ir.roles.length,
    roleOrder: ir.roles.map((r) => r.key).join(", "),
    roleConsts: roleNames.join(", "),
    flows,
    taskConsts,
    vars,
    tasks: taskCtxs,
    steps,
    enabled,
    startFlow,
  };
}
