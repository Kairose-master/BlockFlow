# @blockflow/bpmn

BPMN 서브셋(L0) 관련 자산.

- `moddle/bc.json` — bpmn-moddle 확장 (네임스페이스 `bc`, 가이드 부록 A).
  `bc:Variables` 는 `bpmn:Process`, `bc:Inputs` 는 `bpmn:UserTask` 의 `extensionElements` 자식으로 저장한다.
  `bc:roleKey` / `bc:bindingMode` 는 `bpmn:Lane`, `bc:taskId` 는 `bpmn:UserTask` 의 속성이다.

Phase 1 에서 `bpmn-moddle` 기반 파서(BPMN XML → IR)와 구조 규칙 R1~R12 검사기가 여기에 들어온다.
