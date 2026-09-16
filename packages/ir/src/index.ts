/**
 * BlockFlow 중간표현(IR) — bf-ir/0.1
 *
 * 가이드 5장. 플랫폼 중립 JSON. 파서(BPMN→IR), 검증기, 코드 생성기, 시뮬레이터, UI 가 같은 모델을 쓴다.
 * JSON Schema 는 ../schema/bf-ir.schema.json 에 있고, 두 정의는 항상 같이 바뀐다.
 */

export const IR_VERSION = "bf-ir/0.1" as const;

/** 온체인에 값으로 저장 가능한 타입 (D7). string 은 클라이언트가 해시로 바꿔 bytes32 로 보낸다. */
export type VarType = "uint256" | "int256" | "bool" | "address" | "bytes32";

export type BindingMode = "static" | "ownerRebind" | "open";

export interface ProcessMeta {
  /** 컨트랙트 이름이 된다. Solidity 식별자여야 한다. */
  id: string;
  /** 사람이 읽는 이름 (한글 가능). */
  name: string;
  /** 원본 BPMN 의 IPFS CID (선택). */
  sourceCid?: string;
  /** 원본 bpmn:Process 의 id. */
  bpmnId?: string;
}

export interface Role {
  /** 역할 상수 이름 (ROLE_{KEY}) 과 keccak256 프리이미지. 예: "Manager". */
  key: string;
  label: string;
  binding: BindingMode;
}

export interface Variable {
  name: string;
  type: VarType;
  /** 초기값 (Solidity 리터럴 문자열). L0 에서는 사용하지 않음. */
  initial?: string;
}

export interface Flow {
  id: string;
  /** marking 의 비트 위치 (0..255). 문서 순서로 결정적으로 부여. */
  bit: number;
  from: string;
  to: string;
  /** XOR 분기 조건 (bc:expr). default 와 배타. */
  cond?: string;
  /** XOR 분기의 기본 플로우. */
  default?: boolean;
  /** 타이머 경계 이벤트에서 나가는 만료 경로 (from 은 태스크 노드) */
  timer?: boolean;
  /** 원본 bpmn:SequenceFlow id (UI 가 다이어그램에 marking 을 칠할 때 사용). */
  bpmnId?: string;
}

export interface TaskInput {
  variable: string;
  label: string;
  required?: boolean;
}

export interface StartEventNode {
  id: string;
  kind: "startEvent";
  /** 원본 BPMN 요소 id. */
  bpmnId?: string;
  out: string[];
}

export interface EndEventNode {
  id: string;
  kind: "endEvent";
  /** 원본 BPMN 요소 id. */
  bpmnId?: string;
  in: string[];
  /** "completed" 는 정상 종료. 그 외 문자열(예: "rejected")은 비정상 종료. */
  outcome: string;
  /** 주석/UI 용 라벨. 없으면 outcome 을 쓴다. */
  label?: string;
}

/**
 * L1 결제 태스크 (4.3 bc:payment): 완료 시 msg.sender(담당자) 가 ERC-20 을 `to` 에게 `amountVar` 만큼 보낸다.
 * transferFrom 이므로 담당자가 컨트랙트에 미리 approve 해야 한다. token 은 주소 리터럴 (v0.1).
 */
export interface Payment {
  token: string;
  to: { role: string } | { address: string };
  amountVar: string;
}

/**
 * L1 타이머 경계 이벤트 (4.3 bc:deadlineVar): 태스크가 활성화된 시각(startedAt) + 기한이 지나면 누구나
 * expire{Task}(id) 를 호출해 태스크 토큰을 만료 경로(out)로 옮길 수 있다. 기한은 변수(초) 또는 리터럴(초).
 */
export interface Timer {
  deadline: { var: string } | { seconds: number };
  /** 만료 경로 플로우 (from = 이 태스크, timer: true) */
  out: string;
  bpmnId?: string;
}

export interface UserTaskNode {
  id: string;
  kind: "userTask";
  /** 원본 BPMN 요소 id. */
  bpmnId?: string;
  /** 이벤트/UI 용 정수 ID (1..). */
  taskId: number;
  /** 함수 이름 (Solidity 식별자). */
  name: string;
  label: string;
  role: string;
  inputs: TaskInput[];
  /** XOR 합류가 앞에 있으면 여러 개 (5.2 합류 정규화). */
  in: string[];
  out: string[];
  /** TASK_{TAG} 상수용 짧은 이름. 없으면 name 에서 파생. */
  tag?: string;
  /** L1 결제 태스크 */
  payment?: Payment;
  /** L1 타이머 경계 이벤트 */
  timer?: Timer;
}

export interface XorBranch {
  flow: string;
  cond: string;
}

export interface XorSplitNode {
  id: string;
  kind: "xorSplit";
  /** 원본 BPMN 요소 id. */
  bpmnId?: string;
  in: string[];
  branches: XorBranch[];
  default: string;
}

export interface AndSplitNode {
  id: string;
  kind: "andSplit";
  /** 원본 BPMN 요소 id. */
  bpmnId?: string;
  /** 여러 개면 "어느 하나라도 있으면 소비" (1-safe 전제). */
  in: string[];
  out: string[];
}

export interface AndJoinNode {
  id: string;
  kind: "andJoin";
  /** 원본 BPMN 요소 id. */
  bpmnId?: string;
  in: string[];
  out: string[];
}

/**
 * L1 서비스 태스크 (오라클 콜백, 4.1): 토큰이 도착하면 컨트랙트가 ServiceRequested(id, taskId) 를 내고,
 * 프로세스 소유자가 지정한 오라클 주소가 fulfill{Fn}(id, inputs…) 로 응답한다. 응답값은 프로세스 변수에 저장된다.
 */
export interface ServiceTaskNode {
  id: string;
  kind: "serviceTask";
  bpmnId?: string;
  taskId: number;
  name: string;
  label: string;
  /** 오라클이 돌려주는 값 (함수 인자) */
  inputs: TaskInput[];
  in: string[];
  out: string[];
  tag?: string;
  timer?: Timer;
}

export type Node =
  | StartEventNode
  | EndEventNode
  | UserTaskNode
  | ServiceTaskNode
  | XorSplitNode
  | AndSplitNode
  | AndJoinNode;

export type NodeKind = Node["kind"];

export interface IR {
  version: typeof IR_VERSION;
  process: ProcessMeta;
  roles: Role[];
  variables: Variable[];
  flows: Flow[];
  nodes: Node[];
  /** _step() 에서 처리되는 침묵 전이 노드 id 목록 (게이트웨이, 종료 이벤트). */
  silent: string[];
}

// ───────────── 조회 헬퍼 ─────────────

export function nodeById(ir: IR, id: string): Node {
  const n = ir.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`IR: 노드 '${id}' 가 없습니다`);
  return n;
}

export function flowById(ir: IR, id: string): Flow {
  const f = ir.flows.find((x) => x.id === id);
  if (!f) throw new Error(`IR: 플로우 '${id}' 가 없습니다`);
  return f;
}

export function userTasks(ir: IR): UserTaskNode[] {
  return ir.nodes.filter((n): n is UserTaskNode => n.kind === "userTask");
}

/** 함수가 되는 태스크 전부 (사용자 태스크 + 서비스 태스크), 문서 순서 */
export function taskNodes(ir: IR): (UserTaskNode | ServiceTaskNode)[] {
  return ir.nodes.filter((n): n is UserTaskNode | ServiceTaskNode => n.kind === "userTask" || n.kind === "serviceTask");
}

export function nodesOfKind<K extends NodeKind>(ir: IR, kind: K): Extract<Node, { kind: K }>[] {
  return ir.nodes.filter((n): n is Extract<Node, { kind: K }> => n.kind === kind);
}

/** 플로우 id 목록 → 비트마스크 (bigint). */
export function maskOf(ir: IR, flowIds: readonly string[]): bigint {
  let m = 0n;
  for (const id of flowIds) m |= 1n << BigInt(flowById(ir, id).bit);
  return m;
}

/** 노드의 입력 플로우 목록 (startEvent 는 없음). */
export function inFlows(n: Node): string[] {
  return n.kind === "startEvent" ? [] : n.in;
}

/** 노드의 출력 플로우 목록 (xorSplit 은 branches + default, userTask 는 out + 타이머 만료 경로, endEvent 는 없음). */
export function outFlows(n: Node): string[] {
  switch (n.kind) {
    case "endEvent":
      return [];
    case "xorSplit":
      return [...n.branches.map((b) => b.flow), n.default];
    case "userTask":
    case "serviceTask":
      return n.timer ? [...n.out, n.timer.out] : n.out;
    default:
      return n.out;
  }
}
