/**
 * structure.ts — IR 수준 구조 검사.
 *
 * BPMN 수준의 R1~R12 (가이드 4.5) 는 Phase 1 의 bpmn 파서에서 검사한다. 여기서는 IR 이
 * 코드 생성에 안전한지(참조 무결성, 비트 유일성, 타입 선언 등)만 본다. 메시지는 개발자용.
 */
import { type IR, inFlows, outFlows } from "@blockflow/ir";

/** Solidity 예약어 (names.ts 와 같은 목록의 부분집합; validator 는 codegen 에 의존하지 않으므로 여기 둔다) */
const SOLIDITY_KEYWORDS = new Set([
  "abstract", "address", "after", "alias", "anonymous", "apply", "as", "assembly", "auto", "bool", "break", "byte", "bytes", "calldata",
  "case", "catch", "constant", "constructor", "continue", "contract", "copyof", "default", "define", "delete", "do", "else", "emit",
  "enum", "error", "event", "external", "fallback", "false", "final", "fixed", "for", "function", "hex", "if", "immutable",
  "implements", "import", "in", "indexed", "inline", "int", "interface", "internal", "is", "let", "library", "macro", "mapping",
  "match", "memory", "modifier", "mutable", "new", "null", "of", "override", "partial", "payable", "pragma", "private", "promise",
  "public", "pure", "receive", "reference", "relocatable", "return", "returns", "sealed", "sizeof", "static", "storage", "string",
  "struct", "supports", "switch", "throw", "true", "try", "type", "typedef", "typeof", "ufixed", "uint", "unchecked", "unicode",
  "using", "var", "view", "virtual", "while",
]);
function isReserved(name: string): boolean {
  return SOLIDITY_KEYWORDS.has(name) || /^(u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?|bytes([1-9]|[12][0-9]|3[0-2])?)$/.test(name);
}

export function checkStructure(ir: IR): string[] {
  const problems: string[] = [];
  const nodeIds = new Set<string>();
  const flowIds = new Set<string>();
  const varNames = new Set(ir.variables.map((v) => v.name));
  const roleKeys = new Set(ir.roles.map((r) => r.key));

  if (ir.version !== "bf-ir/0.1") problems.push(`지원하지 않는 IR 버전: ${ir.version}`);

  // 생성 코드의 지역 변수/매개변수와 충돌하는 변수 이름
  const RESERVED_VARS = new Set([
    "id", "m", "v", "inst", "bits", "roles", "roleAccounts", "i", "p", "consume", "produce", "taskId", "inFlow",
    // Solidity 단위·전역 이름
    "wei", "gwei", "ether", "seconds", "minutes", "hours", "days", "weeks", "years", "now", "this", "super", "msg", "tx", "block",
  ]);
  for (const v of ir.variables) {
    if (RESERVED_VARS.has(v.name) || isReserved(v.name)) problems.push(`변수 이름 '${v.name}' 은 Solidity/생성 코드에서 예약돼 있음`);
  }

  for (const n of ir.nodes) {
    if (nodeIds.has(n.id)) problems.push(`노드 id 중복: ${n.id}`);
    nodeIds.add(n.id);
  }

  const bits = new Set<number>();
  for (const f of ir.flows) {
    if (flowIds.has(f.id)) problems.push(`플로우 id 중복: ${f.id}`);
    flowIds.add(f.id);
    if (bits.has(f.bit)) problems.push(`플로우 비트 중복: ${f.id} (bit ${f.bit})`);
    bits.add(f.bit);
    if (f.bit < 0 || f.bit > 255) problems.push(`플로우 비트 범위 초과: ${f.id} (bit ${f.bit})`);
    if (!nodeIds.has(f.from)) problems.push(`플로우 ${f.id} 의 from 노드가 없음: ${f.from}`);
    if (!nodeIds.has(f.to)) problems.push(`플로우 ${f.id} 의 to 노드가 없음: ${f.to}`);
    if (f.cond && f.default) problems.push(`플로우 ${f.id}: cond 와 default 는 동시에 못 씀`);
  }
  if (ir.flows.length > 256) problems.push(`플로우가 256개를 넘음 (${ir.flows.length}) — L0 한계 (R11)`);

  // 노드 in/out 이 flows 의 from/to 와 일치하는지
  for (const n of ir.nodes) {
    for (const id of inFlows(n)) {
      const f = ir.flows.find((x) => x.id === id);
      if (!f) problems.push(`노드 ${n.id} 의 in 플로우가 없음: ${id}`);
      else if (f.to !== n.id) problems.push(`플로우 ${id} 의 to(${f.to}) 가 노드 ${n.id} 와 다름`);
    }
    for (const id of outFlows(n)) {
      const f = ir.flows.find((x) => x.id === id);
      if (!f) problems.push(`노드 ${n.id} 의 out 플로우가 없음: ${id}`);
      else if (f.from !== n.id) problems.push(`플로우 ${id} 의 from(${f.from}) 이 노드 ${n.id} 와 다름`);
    }
  }
  // 모든 플로우가 어떤 노드의 in/out 에 나타나는지
  const referenced = new Set<string>();
  for (const n of ir.nodes) for (const id of [...inFlows(n), ...outFlows(n)]) referenced.add(id);
  for (const f of ir.flows) if (!referenced.has(f.id)) problems.push(`플로우 ${f.id} 를 참조하는 노드가 없음`);

  const starts = ir.nodes.filter((n) => n.kind === "startEvent");
  if (starts.length !== 1) problems.push(`시작 이벤트는 정확히 1개여야 함 (현재 ${starts.length}) (R1)`);
  if (!ir.nodes.some((n) => n.kind === "endEvent")) problems.push("종료 이벤트가 없음 (R2)");

  const taskIds = new Set<number>();
  const fnNames = new Set<string>();
  for (const n of ir.nodes) {
    switch (n.kind) {
      case "userTask":
        if (taskIds.has(n.taskId)) problems.push(`taskId 중복: ${n.taskId} (${n.id})`);
        taskIds.add(n.taskId);
        if (fnNames.has(n.name)) problems.push(`태스크 함수명 중복: ${n.name} (${n.id})`);
        fnNames.add(n.name);
        if (!roleKeys.has(n.role)) problems.push(`태스크 ${n.id} 의 역할이 선언되지 않음: ${n.role} (R7)`);
        if (n.out.length !== 1) problems.push(`태스크 ${n.id} 는 나가는 플로우가 1개여야 함 (R3, 타이머 만료 경로는 timer 에 둔다)`);
        if (n.in.length < 1) problems.push(`태스크 ${n.id} 는 들어오는 플로우가 필요함 (R3)`);
        for (const inp of n.inputs) {
          if (!varNames.has(inp.variable)) problems.push(`태스크 ${n.id} 의 입력 변수가 선언되지 않음: ${inp.variable}`);
        }
        if (n.timer) {
          const f = ir.flows.find((x) => x.id === n.timer!.out);
          if (!f) problems.push(`타이머 태스크 ${n.id} 의 만료 플로우가 없음: ${n.timer.out}`);
          else if (f.from !== n.id || !f.timer) problems.push(`타이머 태스크 ${n.id} 의 만료 플로우 ${f.id} 는 from=${n.id}, timer=true 여야 함`);
          if ("var" in n.timer.deadline) {
            const v = ir.variables.find((x) => x.name === (n.timer!.deadline as { var: string }).var);
            if (!v) problems.push(`타이머 태스크 ${n.id} 의 기한 변수가 선언되지 않음`);
            else if (v.type !== "uint256") problems.push(`타이머 태스크 ${n.id} 의 기한 변수 ${v.name} 은 uint256(초) 이어야 함`);
          }
        }
        if (n.payment) {
          const amount = ir.variables.find((v) => v.name === n.payment!.amountVar);
          if (!amount) problems.push(`결제 태스크 ${n.id} 의 금액 변수가 선언되지 않음: ${n.payment.amountVar}`);
          else if (amount.type !== "uint256") problems.push(`결제 태스크 ${n.id} 의 금액 변수 ${amount.name} 은 uint256 이어야 함`);
          if ("role" in n.payment.to && !roleKeys.has(n.payment.to.role)) problems.push(`결제 태스크 ${n.id} 의 받는 역할이 선언되지 않음: ${n.payment.to.role}`);
          if (!/^0x[0-9a-fA-F]{40}$/.test(n.payment.token)) problems.push(`결제 태스크 ${n.id} 의 토큰 주소가 잘못됨`);
        }
        break;
      case "xorSplit": {
        const flows = new Map(ir.flows.map((f) => [f.id, f]));
        if (n.branches.length < 1) problems.push(`XOR ${n.id}: 조건 분기가 최소 1개 필요 (R4)`);
        const def = flows.get(n.default);
        if (!def) problems.push(`XOR ${n.id}: 기본 플로우 ${n.default} 가 없음 (R5)`);
        else if (!def.default) problems.push(`XOR ${n.id}: 플로우 ${n.default} 에 default: true 가 없음 (R5)`);
        for (const b of n.branches) {
          const f = flows.get(b.flow);
          if (f && f.cond !== b.cond) problems.push(`XOR ${n.id}: 플로우 ${b.flow} 의 cond 가 노드와 다름`);
        }
        break;
      }
      case "andSplit":
        if (n.out.length < 2) problems.push(`AND split ${n.id}: 나가는 플로우가 2개 이상이어야 함 (R4)`);
        for (const id of n.out) {
          const f = ir.flows.find((x) => x.id === id);
          if (f?.cond) problems.push(`AND split ${n.id}: 플로우 ${id} 에 조건이 있음 (R6)`);
        }
        break;
      case "andJoin":
        if (n.in.length < 2) problems.push(`AND join ${n.id}: 들어오는 플로우가 2개 이상이어야 함 (R4)`);
        if (n.out.length !== 1) problems.push(`AND join ${n.id}: 나가는 플로우는 1개 (R4)`);
        break;
      case "startEvent":
        if (n.out.length !== 1) problems.push(`시작 이벤트 ${n.id}: 나가는 플로우는 1개`);
        break;
      case "endEvent":
        break;
    }
  }

  for (const id of ir.silent) {
    const n = ir.nodes.find((x) => x.id === id);
    if (!n) problems.push(`silent 에 없는 노드: ${id}`);
    else if (n.kind === "userTask" || n.kind === "startEvent") problems.push(`silent 에 ${n.kind} 는 올 수 없음: ${id}`);
  }
  for (const n of ir.nodes) {
    if ((n.kind === "xorSplit" || n.kind === "andSplit" || n.kind === "andJoin" || n.kind === "endEvent") && !ir.silent.includes(n.id)) {
      problems.push(`침묵 전이 노드 ${n.id} (${n.kind}) 가 silent 목록에 없음`);
    }
  }

  return problems;
}
