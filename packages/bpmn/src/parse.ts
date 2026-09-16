/**
 * parse.ts — BPMN XML → IR (가이드 5.2 변환 규칙) + 구조 규칙 R1~R12 (4.5).
 *
 * 흐름: bpmn-moddle 로 XML 을 읽고 → L0 팔레트 밖 요소를 거부하고 → 그래프(Graph)를 만든 뒤
 *       → R1~R12 를 검사하고 → 통과하면 IR 로 변환한다 (XOR 합류 정규화, 비트 배정, 이름 생성).
 *
 * 진단(Diagnostic)은 비전문가용 한국어 메시지 + 요소 id 를 가진다. UI 는 id 로 요소에 빨간 배지를 붙인다.
 */
import { BpmnModdle, type ModdleElement } from "bpmn-moddle";
import type { EndEventNode, Flow, IR, Node, Payment, Role, ServiceTaskNode, TaskInput, Timer, UserTaskNode, VarType, Variable } from "@blockflow/ir";
import { compileExpr, ExprError } from "@blockflow/codegen/expr";
import * as names from "@blockflow/codegen/names";
import BC from "../moddle/bc.json" with { type: "json" };

export interface Diagnostic {
  /** 규칙 번호 (R1~R12) 또는 "L0" (지원하지 않는 요소) / "XML". */
  rule: string;
  /** 비전문가용 메시지. */
  message: string;
  /** 문제 요소의 BPMN id (있으면). */
  elementId?: string;
  /** 개발자용 상세. */
  detail?: string;
}

export class ParseError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    super(`BPMN 검증 실패 (${diagnostics.length}건):\n` + diagnostics.map((d) => `  [${d.rule}] ${d.message}${d.elementId ? ` (${d.elementId})` : ""}`).join("\n"));
    this.name = "ParseError";
  }
}

export interface ParseResult {
  ir: IR;
  /** 파서 경고 (규칙 위반은 아님). */
  warnings: string[];
}

/** 브라우저·Node 공용 moddle 인스턴스 팩토리. */
export function createModdle(): BpmnModdle {
  return new BpmnModdle({ bc: BC as unknown as Record<string, unknown> });
}

const VAR_TYPES = new Set<string>(["uint256", "int256", "bool", "address", "bytes32"]);

// ───────────── 그래프 (moddle 요소를 평탄화) ─────────────

type Kind = "start" | "end" | "task" | "service" | "xor" | "and" | "timer";

interface GNode {
  id: string;
  kind: Kind;
  name: string;
  in: string[];
  out: string[];
  /** xor 의 기본 플로우 id */
  defaultFlow?: string;
  /** task */
  laneId?: string;
  taskId?: number;
  fn?: string;
  tag?: string;
  inputs: TaskInput[];
  /** L1 결제 (bc:payToken / bc:payTo / bc:payAmountVar) */
  pay?: { token: string; to: string; amountVar: string };
  /** timer(경계 이벤트): 붙은 태스크 id, 기한 */
  attachedTo?: string;
  deadlineVar?: string;
  deadlineSeconds?: number;
  /** end */
  outcome?: string;
}

interface GFlow {
  id: string;
  from: string;
  to: string;
  cond?: string;
  /** 문서 순서 */
  order: number;
}

interface Graph {
  processId: string;
  processName: string;
  variables: Variable[];
  lanes: { id: string; name: string; roleKey: string; binding: string; nodeIds: string[] }[];
  nodes: Map<string, GNode>;
  flows: Map<string, GFlow>;
}

function arr(x: unknown): ModdleElement[] {
  return Array.isArray(x) ? (x as ModdleElement[]) : [];
}

function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function ref(x: unknown): string {
  return typeof x === "object" && x !== null && "id" in x ? str((x as ModdleElement).id) : "";
}

function extValues(el: ModdleElement, type: string): ModdleElement[] {
  const ext = el.extensionElements as ModdleElement | undefined;
  if (!ext) return [];
  return arr(ext.values)
    .filter((v) => v.$type === type)
    .flatMap((v) => arr(v.values));
}

const SUPPORTED = new Set([
  "bpmn:StartEvent", "bpmn:EndEvent", "bpmn:UserTask", "bpmn:ExclusiveGateway", "bpmn:ParallelGateway",
  "bpmn:SequenceFlow", "bpmn:LaneSet", "bpmn:Lane", "bpmn:BoundaryEvent", "bpmn:ServiceTask",
]);

const UNSUPPORTED_MESSAGES: Record<string, string> = {
  "bpmn:Task": "일반 태스크 대신 사용자 태스크를 쓰세요",
  "bpmn:ScriptTask": "스크립트 태스크는 아직 지원하지 않아요",
  "bpmn:SendTask": "메시지 태스크는 L1 에서 지원돼요",
  "bpmn:ReceiveTask": "메시지 태스크는 L1 에서 지원돼요",
  "bpmn:InclusiveGateway": "포괄(OR) 게이트웨이는 L1 에서 지원돼요",
  "bpmn:EventBasedGateway": "이벤트 게이트웨이는 L1 에서 지원돼요",
  "bpmn:IntermediateCatchEvent": "중간 이벤트(타이머·메시지)는 L1 에서 지원돼요",
  "bpmn:IntermediateThrowEvent": "중간 이벤트는 L1 에서 지원돼요",
  "bpmn:SubProcess": "서브프로세스는 L2 에서 지원돼요",
  "bpmn:CallActivity": "콜 액티비티는 L2 에서 지원돼요",
  "bpmn:DataObjectReference": "데이터 객체 대신 프로세스 변수를 쓰세요",
  "bpmn:DataStoreReference": "데이터 저장소 대신 프로세스 변수를 쓰세요",
};

function buildGraph(defs: ModdleElement, diags: Diagnostic[]): Graph | undefined {
  const roots = arr(defs.rootElements);
  const processes = roots.filter((r) => r.$type === "bpmn:Process");
  // bpmn-js 는 레인을 풀(참여자) 안에 그리므로 참여자 1개짜리 협업은 허용한다 (D4: 단일 풀 + 레인).
  for (const collab of roots.filter((r) => r.$type === "bpmn:Collaboration")) {
    const participants = arr(collab.participants);
    if (participants.length > 1) {
      diags.push({ rule: "L0", message: "풀(참여자)이 여러 개인 협업 다이어그램은 아직 지원하지 않아요. 풀 하나에 역할을 레인으로 그려 주세요", elementId: str(collab.id) });
    }
    if (arr(collab.messageFlows).length) {
      diags.push({ rule: "L0", message: "메시지 플로우는 L1 에서 지원돼요", elementId: str(collab.id) });
    }
  }
  if (processes.length !== 1) {
    diags.push({ rule: "L0", message: `프로세스는 하나여야 해요 (현재 ${processes.length}개)` });
    return undefined;
  }
  const proc = processes[0]!;
  const processId = str(proc.id);
  const processName = str(proc.name);

  // 변수
  const variables: Variable[] = [];
  for (const v of extValues(proc, "bc:Variables")) {
    const name = str(v.name);
    const type = str(v.type);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) diags.push({ rule: "R12", message: `변수 이름 '${name}' 은 영문자로 시작하는 영숫자여야 해요`, elementId: processId });
    else if (names.isReserved(name) || ["id", "m", "v", "inst", "bits", "roles", "roleAccounts", "i", "p", "consume", "produce", "taskId", "inFlow"].includes(name)) {
      diags.push({ rule: "R12", message: `'${name}' 은 쓸 수 없는 이름이에요. 다른 이름을 붙여 주세요 (예: ${name}Value)`, elementId: processId });
    }
    if (!VAR_TYPES.has(type)) diags.push({ rule: "R9", message: `변수 '${name}' 의 타입 '${type}' 은 쓸 수 없어요 (uint256, int256, bool, address, bytes32 중 하나)`, elementId: processId });
    if (variables.some((x) => x.name === name)) diags.push({ rule: "R12", message: `변수 '${name}' 이 두 번 선언됐어요`, elementId: processId });
    const variable: Variable = { name, type: type as VarType };
    const initial = str(v.initial);
    if (initial) variable.initial = initial;
    variables.push(variable);
  }

  // 레인
  const lanes: Graph["lanes"] = [];
  for (const ls of arr(proc.laneSets)) {
    for (const lane of arr(ls.lanes)) {
      if (arr(lane.childLaneSet ? (lane.childLaneSet as ModdleElement).lanes : []).length) {
        diags.push({ rule: "L0", message: "레인 안의 레인(중첩)은 지원하지 않아요", elementId: str(lane.id) });
      }
      const name = str(lane.name);
      lanes.push({
        id: str(lane.id),
        name,
        roleKey: str(lane.get("bc:roleKey")),
        binding: str(lane.get("bc:bindingMode")) || "static",
        nodeIds: arr(lane.flowNodeRef).map((n) => str(n.id)),
      });
    }
  }

  const nodes = new Map<string, GNode>();
  const flows = new Map<string, GFlow>();
  let order = 0;
  for (const fe of arr(proc.flowElements)) {
    const id = str(fe.id);
    const type = fe.$type;
    if (!SUPPORTED.has(type)) {
      diags.push({ rule: "L0", message: UNSUPPORTED_MESSAGES[type] ?? `'${type.replace("bpmn:", "")}' 요소는 아직 지원하지 않아요`, elementId: id });
      continue;
    }
    const base = { id, name: str(fe.name), in: arr(fe.incoming).map((f) => str(f.id)), out: arr(fe.outgoing).map((f) => str(f.id)), inputs: [] as TaskInput[] };
    switch (type) {
      case "bpmn:StartEvent":
      case "bpmn:EndEvent": {
        if (arr(fe.eventDefinitions).length) {
          diags.push({ rule: "L0", message: "타이머·메시지 같은 이벤트 종류는 L1 에서 지원돼요. 빈 시작/종료 이벤트를 쓰세요", elementId: id });
        }
        const n: GNode = { ...base, kind: type === "bpmn:StartEvent" ? "start" : "end" };
        if (type === "bpmn:EndEvent") n.outcome = str(fe.get("bc:outcome")) || "completed";
        nodes.set(id, n);
        break;
      }
      case "bpmn:BoundaryEvent": {
        const defs = arr(fe.eventDefinitions);
        if (defs.length !== 1 || defs[0]!.$type !== "bpmn:TimerEventDefinition") {
          diags.push({ rule: "L1", message: "경계 이벤트는 기한(타이머)만 지원해요", elementId: id });
        }
        const n: GNode = { ...base, kind: "timer", attachedTo: ref(fe.attachedToRef) };
        const dv = str(fe.get("bc:deadlineVar"));
        if (dv) n.deadlineVar = dv;
        const ds = fe.get("bc:deadlineSeconds");
        if (typeof ds === "number") n.deadlineSeconds = ds;
        if (fe.cancelActivity === false) diags.push({ rule: "L1", message: "기한 이벤트는 태스크를 중단시키는(실선) 형태만 지원해요", elementId: id });
        nodes.set(id, n);
        break;
      }
      case "bpmn:ServiceTask":
      case "bpmn:UserTask": {
        const n: GNode = { ...base, kind: type === "bpmn:ServiceTask" ? "service" : "task" };
        const taskId = fe.get("bc:taskId");
        if (typeof taskId === "number") n.taskId = taskId;
        const fn = str(fe.get("bc:fn"));
        if (fn) n.fn = fn;
        const tag = str(fe.get("bc:tag"));
        if (tag) n.tag = tag;
        const payToken = str(fe.get("bc:payToken")), payTo = str(fe.get("bc:payTo")), payAmountVar = str(fe.get("bc:payAmountVar"));
        if (payToken || payTo || payAmountVar) n.pay = { token: payToken, to: payTo, amountVar: payAmountVar };
        for (const inp of extValues(fe, "bc:Inputs")) {
          const input: TaskInput = { variable: str(inp.variable), label: str(inp.label) || str(inp.variable) };
          if (inp.required === false) input.required = false;
          n.inputs.push(input);
        }
        nodes.set(id, n);
        break;
      }
      case "bpmn:ExclusiveGateway": {
        const n: GNode = { ...base, kind: "xor" };
        const d = ref(fe.default);
        if (d) n.defaultFlow = d;
        nodes.set(id, n);
        break;
      }
      case "bpmn:ParallelGateway":
        nodes.set(id, { ...base, kind: "and" });
        break;
      case "bpmn:SequenceFlow": {
        const f: GFlow = { id, from: ref(fe.sourceRef), to: ref(fe.targetRef), order: order++ };
        const ce = fe.conditionExpression as ModdleElement | undefined;
        const body = ce ? str(ce.body).trim() : "";
        if (body) f.cond = body;
        flows.set(id, f);
        break;
      }
      default:
        break; // LaneSet 은 위에서 처리
    }
  }
  // 레인 소속
  for (const lane of lanes) for (const nid of lane.nodeIds) {
    const n = nodes.get(nid);
    if (n) n.laneId = lane.id;
  }
  return { processId, processName, variables, lanes, nodes, flows };
}

// ───────────── 규칙 R1~R12 ─────────────

function checkRules(g: Graph, diags: Diagnostic[]): void {
  const nodes = [...g.nodes.values()];
  const flows = [...g.flows.values()];
  const push = (rule: string, message: string, elementId?: string, detail?: string) => {
    const d: Diagnostic = { rule, message };
    if (elementId) d.elementId = elementId;
    if (detail) d.detail = detail;
    diags.push(d);
  };

  // 플로우 참조 무결성 (XML 이 깨진 경우)
  for (const f of flows) {
    if (!g.nodes.has(f.from) || !g.nodes.has(f.to)) push("XML", "연결이 끊긴 화살표가 있어요", f.id, `${f.from} -> ${f.to}`);
  }
  if (diags.some((d) => d.rule === "XML")) return;

  // R1
  const starts = nodes.filter((n) => n.kind === "start");
  if (starts.length !== 1) push("R1", "시작점은 하나여야 해요", starts[1]?.id ?? starts[0]?.id, `시작 이벤트 ${starts.length}개`);
  for (const s of starts) {
    if (s.in.length) push("R1", "시작점으로 들어오는 화살표는 없어야 해요", s.id);
    if (s.out.length !== 1) push("R1", "시작점에서 나가는 화살표는 하나여야 해요", s.id);
  }
  // R2
  const ends = nodes.filter((n) => n.kind === "end");
  if (!ends.length) push("R2", "끝나는 지점이 필요해요");
  for (const e of ends) {
    if (e.out.length) push("R2", "끝나는 지점에서 나가는 화살표는 없어야 해요", e.id);
    if (!e.in.length) push("R2", "끝나는 지점으로 들어오는 화살표가 없어요", e.id);
  }
  // R3
  for (const t of nodes.filter((n) => n.kind === "task" || n.kind === "service")) {
    if (t.in.length !== 1 || t.out.length !== 1) push("R3", "태스크에서 갈라지거나 모으려면 마름모(게이트웨이)를 쓰세요", t.id, `in ${t.in.length}, out ${t.out.length}`);
  }
  // R4
  for (const gw of nodes.filter((n) => n.kind === "xor" || n.kind === "and")) {
    const split = gw.in.length === 1 && gw.out.length >= 2;
    const join = gw.in.length >= 2 && gw.out.length === 1;
    if (!split && !join) push("R4", "이 마름모는 갈라지거나 모으는 것 중 하나만 해야 해요", gw.id, `in ${gw.in.length}, out ${gw.out.length}`);
  }
  // R5 / R6
  for (const gw of nodes.filter((n) => n.out.length >= 2)) {
    if (gw.kind === "xor") {
      if (!gw.defaultFlow || !gw.out.includes(gw.defaultFlow)) push("R5", "기본 화살표를 정하세요", gw.id);
      for (const fid of gw.out) {
        const f = g.flows.get(fid)!;
        if (fid === gw.defaultFlow) {
          if (f.cond) push("R5", "기본 화살표에는 조건을 붙이지 않아요", fid);
        } else if (!f.cond) push("R5", "조건이 없는 화살표가 있어요", fid);
      }
    } else if (gw.kind === "and") {
      for (const fid of gw.out) if (g.flows.get(fid)!.cond) push("R6", "동시에 진행하는 화살표엔 조건을 붙일 수 없어요", fid);
    }
  }
  // 조건은 XOR 분기에서만
  for (const f of flows) {
    const from = g.nodes.get(f.from)!;
    if (f.cond && !(from.kind === "xor" && from.out.length >= 2)) push("R5", "조건은 갈라지는 마름모에서 나가는 화살표에만 붙일 수 있어요", f.id);
  }
  // R7
  for (const t of nodes.filter((n) => n.kind === "task")) {
    if (!t.laneId) push("R7", "이 일은 누가 하나요? 역할 칸 안으로 옮기세요", t.id);
  }
  if (!g.lanes.length) push("R7", "역할(레인)을 하나 이상 추가하세요", g.processId);
  // R8
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  for (const n of nodes) {
    succ.set(n.id, n.out.map((f) => g.flows.get(f)!.to));
    pred.set(n.id, n.in.map((f) => g.flows.get(f)!.from));
  }
  // 타이머 경계 이벤트는 붙은 태스크에서 도달한다
  for (const t of nodes.filter((n) => n.kind === "timer" && n.attachedTo)) {
    succ.get(t.attachedTo!)?.push(t.id);
    pred.get(t.id)?.push(t.attachedTo!);
  }
  const reach = (from: string[], next: Map<string, string[]>) => {
    const seen = new Set<string>(from);
    const q = [...from];
    while (q.length) for (const m of next.get(q.shift()!) ?? []) if (!seen.has(m)) { seen.add(m); q.push(m); }
    return seen;
  };
  const fwd = reach(starts.map((s) => s.id), succ);
  const bwd = reach(ends.map((e) => e.id), pred);
  for (const n of nodes) {
    if (!fwd.has(n.id) || !bwd.has(n.id)) push("R8", n.kind === "task" ? "도달할 수 없는 일이 있어요" : "도달할 수 없는 요소가 있어요", n.id);
  }
  // R9
  const irLike = { variables: g.variables, roles: g.lanes.map((l) => ({ key: roleKeyOf(l, g.lanes.indexOf(l)), label: l.name, binding: "static" as const })) };
  const condVars = new Map<string, string[]>();
  for (const f of flows) {
    if (!f.cond) continue;
    try {
      condVars.set(f.id, compileExpr(f.cond, irLike).variables);
    } catch (e) {
      const m = e instanceof ExprError ? e.message : String(e);
      const missing = /변수 '([^']+)' 가 선언되지/.exec(m);
      push("R9", missing ? `조건에 쓰인 [${missing[1]}]는 아직 정의되지 않았어요` : "조건식을 이해할 수 없어요", f.id, m);
    }
  }
  for (const t of nodes.filter((n) => n.kind === "task" || n.kind === "service")) {
    for (const inp of t.inputs) {
      if (!g.variables.some((v) => v.name === inp.variable)) push("R9", `입력 [${inp.label}] 이 가리키는 변수 '${inp.variable}' 가 선언되지 않았어요`, t.id);
    }
  }
  // R10: 게이트웨이 이전 모든 경로에서 조건 변수가 설정됐는가 (must-정의 전방 분석)
  const all = new Set(g.variables.map((v) => v.name));
  const defIn = new Map<string, Set<string>>();
  for (const n of nodes) defIn.set(n.id, n.kind === "start" ? new Set() : new Set(all));
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (n.kind === "start") continue;
      const preds = pred.get(n.id) ?? [];
      // AND 합류는 모든 가지가 실행된 뒤이므로 합집합, 그 외(XOR 합류 등)는 교집합
      const isAndJoin = n.kind === "and" && n.in.length >= 2;
      let acc: Set<string> | undefined;
      for (const p of preds) {
        const pn = g.nodes.get(p)!;
        const out = new Set(defIn.get(p)!);
        for (const i of pn.inputs) out.add(i.variable);
        acc = acc ? (isAndJoin ? new Set([...acc, ...out]) : new Set([...acc].filter((x) => out.has(x)))) : out;
      }
      const next = acc ?? new Set<string>();
      const cur = defIn.get(n.id)!;
      if (next.size !== cur.size || [...next].some((x) => !cur.has(x))) {
        defIn.set(n.id, next);
        changed = true;
      }
    }
  }
  for (const t of nodes.filter((n) => n.kind === "timer" && n.deadlineVar && n.attachedTo)) {
    const host = g.nodes.get(t.attachedTo!);
    if (host && g.variables.some((v) => v.name === t.deadlineVar) && !defIn.get(host.id)!.has(t.deadlineVar!)) {
      push("R10", `[${labelOfVar(g, t.deadlineVar!)}]을 입력받기 전에 기한으로 쓰고 있어요`, t.id, `변수 ${t.deadlineVar}`);
    }
  }
  for (const t of nodes.filter((n) => n.kind === "task" && n.pay?.amountVar)) {
    const definedHere = new Set([...defIn.get(t.id)!, ...t.inputs.map((i) => i.variable)]);
    if (g.variables.some((v) => v.name === t.pay!.amountVar) && !definedHere.has(t.pay!.amountVar)) {
      push("R10", `[${labelOfVar(g, t.pay!.amountVar)}]을 입력받기 전에 지급 금액으로 쓰고 있어요`, t.id, `변수 ${t.pay!.amountVar}`);
    }
  }
  for (const gw of nodes.filter((n) => n.kind === "xor" && n.out.length >= 2)) {
    const defined = defIn.get(gw.id)!;
    for (const fid of gw.out) {
      for (const v of condVars.get(fid) ?? []) {
        if (!defined.has(v)) push("R10", `[${labelOfVar(g, v)}]을 입력받기 전에 조건에서 쓰고 있어요`, fid, `변수 ${v}`);
      }
    }
  }
  // L1 타이머 경계 이벤트
  for (const t of nodes.filter((n) => n.kind === "timer")) {
    const host = t.attachedTo ? g.nodes.get(t.attachedTo) : undefined;
    if (!host || (host.kind !== "task" && host.kind !== "service")) push("L1", "기한 이벤트는 할 일(사용자 태스크)이나 외부 서비스에 붙여야 해요", t.id);
    if (t.in.length) push("L1", "기한 이벤트로 들어오는 화살표는 없어야 해요", t.id);
    if (t.out.length !== 1) push("L1", "기한이 지나면 어디로 갈지 화살표 하나를 그리세요", t.id);
    if (host && nodes.some((o) => o.kind === "timer" && o !== t && o.attachedTo === host.id)) push("L1", "할 일 하나에는 기한 이벤트 하나만 붙일 수 있어요", t.id);
    if (!t.deadlineVar && !t.deadlineSeconds) push("L1", "기한을 정하세요 (값 또는 초)", t.id);
    if (t.deadlineVar) {
      const v = g.variables.find((x) => x.name === t.deadlineVar);
      if (!v) push("L1", `기한으로 쓸 값 '${t.deadlineVar}' 이 없어요`, t.id);
      else if (v.type !== "uint256") push("L1", `기한 [${t.deadlineVar}] 은 0 이상의 숫자(초)여야 해요`, t.id);
    }
    if (t.deadlineSeconds !== undefined && t.deadlineSeconds < 1) push("L1", "기한은 1초 이상이어야 해요", t.id);
    for (const fid of t.out) if (g.flows.get(fid)?.cond) push("R5", "기한 화살표에는 조건을 붙이지 않아요", fid);
  }
  // L1 결제 태스크
  const roleKeysAll = new Set(g.lanes.map((l, i) => roleKeyOf(l, i)));
  for (const t of nodes.filter((n) => n.kind === "task" && n.pay)) {
    const pay = t.pay!;
    if (!/^0x[0-9a-fA-F]{40}$/.test(pay.token)) push("L1", "결제에 쓸 토큰 주소(0x…)를 넣어 주세요", t.id);
    if (!pay.to) push("L1", "누구에게 지급하는지(역할 또는 주소)를 정하세요", t.id);
    else if (!roleKeysAll.has(pay.to) && !/^0x[0-9a-fA-F]{40}$/.test(pay.to)) push("L1", `받는 쪽 '${pay.to}' 는 역할 이름이나 지갑 주소여야 해요`, t.id);
    const amount = g.variables.find((v) => v.name === pay.amountVar);
    if (!amount) push("L1", "지급 금액으로 쓸 값을 고르세요", t.id);
    else if (amount.type !== "uint256") push("L1", `지급 금액 [${pay.amountVar}] 은 0 이상의 숫자여야 해요`, t.id);
  }
  // R11
  if (flows.length > 256) push("R11", "프로세스가 너무 커요. 나눠 주세요", g.processId, `플로우 ${flows.length}개`);
  // R12
  if (!g.processName) push("R12", "프로세스 이름을 붙여 주세요", g.processId);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(g.processId)) push("R12", "프로세스 id 는 영문자로 시작하는 영숫자여야 해요 (컨트랙트 이름이 돼요)", g.processId);
  for (const t of nodes.filter((n) => n.kind === "task" || n.kind === "service")) if (!t.name) push("R12", "이름을 붙여 주세요", t.id);
  for (const t of nodes.filter((n) => n.kind === "service" && n.pay)) push("L1", "외부 서비스(오라클) 태스크에는 결제를 붙일 수 없어요", t.id);
  for (const l of g.lanes) if (!l.name) push("R12", "역할 이름을 붙여 주세요", l.id);
  // taskId 중복
  const seenTaskIds = new Map<number, string>();
  for (const t of nodes.filter((n) => (n.kind === "task" || n.kind === "service") && n.taskId !== undefined)) {
    const other = seenTaskIds.get(t.taskId!);
    if (other) push("R12", "태스크 번호가 겹쳐요", t.id, `taskId ${t.taskId} = ${other}`);
    seenTaskIds.set(t.taskId!, t.id);
  }
}

function labelOfVar(g: Graph, name: string): string {
  for (const n of g.nodes.values()) for (const i of n.inputs) if (i.variable === name) return i.label;
  return name;
}

function roleKeyOf(lane: Graph["lanes"][number], index: number): string {
  if (lane.roleKey) return lane.roleKey;
  const derived = names.toIdentifier(lane.name, `Role${index + 1}`);
  return derived.charAt(0).toUpperCase() + derived.slice(1);
}

// ───────────── IR 변환 (5.2) ─────────────

function toIR(g: Graph): IR {
  const laneIndex = new Map(g.lanes.map((l, i) => [l.id, i]));
  const roles: Role[] = g.lanes.map((l, i) => ({ key: roleKeyOf(l, i), label: l.name, binding: (l.binding as Role["binding"]) || "static" }));

  // 문서 순서로 노드 id 부여
  const docNodes = [...g.nodes.values()];
  const irId = new Map<string, string>();
  let t = 0, x = 0, a = 0, e = 0;
  const outcomeCount = new Map<string, number>();
  for (const n of docNodes) {
    switch (n.kind) {
      case "start":
        irId.set(n.id, "start");
        break;
      case "task":
      case "service":
        irId.set(n.id, `T${++t}`);
        break;
      case "xor":
        if (n.out.length >= 2) irId.set(n.id, `X${++x}`);
        break; // XOR 합류는 노드가 되지 않는다
      case "and":
        irId.set(n.id, `A${++a}`);
        break;
      case "timer":
        break; // 붙은 태스크의 timer 로 흡수된다
      case "end": {
        const oc = n.outcome ?? "completed";
        const c = (outcomeCount.get(oc) ?? 0) + 1;
        outcomeCount.set(oc, c);
        const base = oc === "completed" ? "end_ok" : `end_${oc}`;
        irId.set(n.id, c === 1 ? base : `${base}_${c}`);
        e++;
        break;
      }
    }
  }

  // XOR 합류 정규화: 합류 게이트웨이를 지나 실제 목적지까지 따라간다
  const resolveTarget = (nodeId: string): string => {
    let cur = g.nodes.get(nodeId)!;
    const seen = new Set<string>();
    while (cur.kind === "xor" && cur.in.length >= 2 && cur.out.length === 1) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = g.nodes.get(g.flows.get(cur.out[0]!)!.to)!;
    }
    return cur.id;
  };
  const joinIds = new Set(docNodes.filter((n) => n.kind === "xor" && n.in.length >= 2 && n.out.length === 1).map((n) => n.id));

  // 플로우: 합류 게이트웨이에서 나가는 플로우는 사라지고, 들어오는 플로우가 목적지로 재연결된다
  const sortedFlows = [...g.flows.values()].filter((f) => !joinIds.has(f.from)).sort((p, q) => p.order - q.order);
  const flowIrId = new Map<string, string>();
  const flows: Flow[] = sortedFlows.map((f, i) => {
    const fid = `F${i + 1}`;
    flowIrId.set(f.id, fid);
    const fromNode = g.nodes.get(f.from)!;
    const fromIr = fromNode.kind === "timer" ? irId.get(fromNode.attachedTo!)! : irId.get(f.from)!;
    const flow: Flow = { id: fid, bit: i, from: fromIr, to: irId.get(resolveTarget(f.to))!, bpmnId: f.id };
    if (fromNode.kind === "timer") flow.timer = true;
    const from = g.nodes.get(f.from)!;
    if (from.kind === "xor" && from.out.length >= 2) {
      if (from.defaultFlow === f.id) flow.default = true;
      else if (f.cond) flow.cond = f.cond;
    }
    return flow;
  });

  // 각 IR 노드의 in 은 "재연결 후 나에게 도착하는 플로우들"
  const inOf = new Map<string, string[]>();
  for (const f of flows) inOf.set(f.to, [...(inOf.get(f.to) ?? []), f.id]);

  const usedFn = new Set<string>();
  const nodes: Node[] = [];
  let taskSeq = 0;
  const explicitIds = new Set(docNodes.filter((n) => (n.kind === "task" || n.kind === "service") && n.taskId !== undefined).map((n) => n.taskId!));
  const nextFreeTaskId = () => {
    do taskSeq++;
    while (explicitIds.has(taskSeq));
    return taskSeq;
  };
  for (const n of docNodes) {
    const id = irId.get(n.id);
    if (!id) continue;
    const ins = inOf.get(id) ?? [];
    const outs = n.out.map((f) => flowIrId.get(f)!).filter(Boolean);
    switch (n.kind) {
      case "start":
        nodes.push({ id, kind: "startEvent", bpmnId: n.id, out: outs });
        break;
      case "end": {
        const end: EndEventNode = { id, kind: "endEvent", bpmnId: n.id, in: ins, outcome: n.outcome ?? "completed" };
        if (n.name) end.label = n.name;
        nodes.push(end);
        break;
      }
      case "service": {
        const fnBase = n.fn ?? names.toIdentifier(n.name, id.toLowerCase());
        const svc: ServiceTaskNode = {
          id, kind: "serviceTask", bpmnId: n.id,
          taskId: n.taskId ?? nextFreeTaskId(),
          name: names.uniqueName(names.isReserved(fnBase) ? fnBase + "_" : fnBase, usedFn),
          label: n.name, inputs: n.inputs, in: ins, out: outs,
        };
        if (n.tag) svc.tag = n.tag;
        const timer = docNodes.find((o) => o.kind === "timer" && o.attachedTo === n.id);
        if (timer) svc.timer = { deadline: timer.deadlineVar ? { var: timer.deadlineVar } : { seconds: timer.deadlineSeconds ?? 0 }, out: flowIrId.get(timer.out[0]!)!, bpmnId: timer.id };
        nodes.push(svc);
        break;
      }
      case "task": {
        const lane = g.lanes[laneIndex.get(n.laneId!)!]!;
        const fnBase = n.fn ?? names.toIdentifier(n.name, id.toLowerCase());
        const task: UserTaskNode = {
          id, kind: "userTask", bpmnId: n.id,
          taskId: n.taskId ?? nextFreeTaskId(),
          name: names.uniqueName(names.isReserved(fnBase) ? fnBase + "_" : fnBase, usedFn),
          label: n.name,
          role: roles[laneIndex.get(lane.id)!]!.key,
          inputs: n.inputs,
          in: ins, out: outs,
        };
        if (n.tag) task.tag = n.tag;
        if (n.pay) {
          const to: Payment["to"] = /^0x[0-9a-fA-F]{40}$/.test(n.pay.to) ? { address: n.pay.to } : { role: n.pay.to };
          task.payment = { token: n.pay.token, to, amountVar: n.pay.amountVar };
        }
        const timer = docNodes.find((o) => o.kind === "timer" && o.attachedTo === n.id);
        if (timer) {
          const t: Timer = { deadline: timer.deadlineVar ? { var: timer.deadlineVar } : { seconds: timer.deadlineSeconds ?? 0 }, out: flowIrId.get(timer.out[0]!)!, bpmnId: timer.id };
          task.timer = t;
        }
        nodes.push(task);
        break;
      }
      case "xor": {
        const branches = n.out.filter((f) => f !== n.defaultFlow).map((f) => ({ flow: flowIrId.get(f)!, cond: g.flows.get(f)!.cond! }));
        nodes.push({ id, kind: "xorSplit", bpmnId: n.id, in: ins, branches, default: flowIrId.get(n.defaultFlow!)! });
        break;
      }
      case "and":
        if (n.out.length >= 2) nodes.push({ id, kind: "andSplit", bpmnId: n.id, in: ins, out: outs });
        else nodes.push({ id, kind: "andJoin", bpmnId: n.id, in: ins, out: outs });
        break;
    }
  }
  void e;

  const silent = nodes.filter((n) => n.kind !== "startEvent" && n.kind !== "userTask" && n.kind !== "serviceTask").map((n) => n.id);
  return {
    version: "bf-ir/0.1",
    process: { id: g.processId, name: g.processName, bpmnId: g.processId },
    roles,
    variables: g.variables,
    flows,
    nodes,
    silent,
  };
}

// ───────────── 진입점 ─────────────

/** BPMN XML 을 검사만 한다 (규칙 위반 목록 반환, 비어 있으면 통과). */
export async function lintBpmn(xml: string): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];
  let defs: ModdleElement;
  try {
    const r = await createModdle().fromXML(xml);
    defs = r.rootElement;
    for (const w of r.warnings) diags.push({ rule: "XML", message: "다이어그램 파일에 알 수 없는 내용이 있어요", detail: w.message });
  } catch (e) {
    return [{ rule: "XML", message: "다이어그램 파일을 읽을 수 없어요", detail: (e as Error).message }];
  }
  const g = buildGraph(defs, diags);
  if (g && !diags.some((d) => d.rule === "L0")) checkRules(g, diags);
  return diags;
}

/** BPMN XML → IR. 규칙 위반이 있으면 ParseError 를 던진다. */
export async function parseBpmn(xml: string): Promise<ParseResult> {
  const diags: Diagnostic[] = [];
  const r = await createModdle().fromXML(xml);
  const warnings = r.warnings.map((w) => w.message);
  const g = buildGraph(r.rootElement, diags);
  if (g && !diags.some((d) => d.rule === "L0")) checkRules(g, diags);
  if (!g || diags.length) throw new ParseError(diags);
  return { ir: toIR(g), warnings };
}
