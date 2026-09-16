# @blockflow/bpmn

BPMN 서브셋(L0) → IR 컴파일러 앞단 (가이드 4장, 5.2, Phase 1).

- `moddle/bc.json` — bpmn-moddle 확장 (네임스페이스 `bc`, 부록 A + `bc:fn`/`bc:tag`/`bc:outcome`).
- `src/parse.ts` — `lintBpmn(xml)` 는 규칙 R1~R12 진단(비전문가용 한국어 메시지 + 요소 id)을 돌려주고,
  `parseBpmn(xml)` 는 통과한 다이어그램을 IR 로 바꾼다 (XOR 합류 정규화, 문서 순서 비트 배정, 함수명 생성).
- `examples/*.bpmn` — 손으로 그린 프로세스 5개: 경비 승인, 구매 승인, 여행 예약, 논문 심사, 공급망 납품.
  (DI 없이 의미 요소만 있다. Phase 2 모델러가 열면 자동 배치된다.)

## bc 확장 속성 요약

| 요소 | 속성 | 의미 |
|---|---|---|
| `bpmn:process/extensionElements` | `<bc:variables><bc:variable name type initial?/></bc:variables>` | 프로세스 변수 |
| `bpmn:lane` | `bc:roleKey`, `bc:bindingMode` | 역할 상수 이름 (없으면 레인 이름에서 파생), 바인딩 |
| `bpmn:userTask` | `bc:taskId`, `bc:fn`, `bc:tag` | 정수 ID(없으면 문서 순서), 함수 이름(없으면 라벨에서 파생), `TASK_{TAG}` |
| `bpmn:userTask/extensionElements` | `<bc:inputs><bc:input variable label required?/></bc:inputs>` | 완료 시 입력 → 함수 인자 |
| `bpmn:sequenceFlow/conditionExpression` | `bc:expr` (4.4 DSL) | XOR 분기 조건 |
| `bpmn:exclusiveGateway@default` | 표준 | 기본 플로우 (필수) |
| `bpmn:endEvent` | `bc:outcome` | `completed`(기본) 외의 값은 비정상 종료 |

## CLI

```bash
pnpm bpmn lint packages/bpmn/examples/expense-approval.bpmn
pnpm bpmn compile packages/bpmn/examples/expense-approval.bpmn --ir out.json --sol out.sol --test out.t.sol
pnpm gen:examples     # examples/*.bpmn → contracts/src/*.sol + contracts/test/generated/*.t.sol
```
