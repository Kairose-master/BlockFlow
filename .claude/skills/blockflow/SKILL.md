---
name: blockflow
description: >
  BlockFlow 저장소에서 BPMN 다이어그램을 스마트 컨트랙트로 컴파일·검증·실행하는 절차.
  BPMN 파일을 검사하거나(R1~R12), IR/Solidity/Foundry 테스트를 생성하거나, 생성물을 재생성·검증하거나,
  새 BPMN 예시·규칙·템플릿 변경을 추가할 때 사용한다.
license: MIT
version: "0.1.0"
allowed-tools: "Bash(pnpm:*), Bash(git diff:*), Bash(forge:*)"
metadata:
  repository: Kairose-master/BlockFlow
  guide: docs/bpmn_sc_control_guide.pdf
---

## Overview

파이프라인은 `BPMN XML → IR(JSON) → validator → codegen → Solidity/.t.sol → solc 0.8.37 → JS EVM/forge` 다.
각 단계의 코드 위치: `packages/bpmn/src/parse.ts` → `packages/ir` → `packages/validator` → `packages/codegen`
(`emit.ts`, `templates/*.mustache`, `scenarios.ts`, `foundry.ts`) → `contracts/`.

## Instructions

1. BPMN 파일을 만들거나 고쳤으면 먼저 규칙 검사: `pnpm bpmn lint <file.bpmn>`.
   진단은 `[R#] 비전문가 메시지 (요소 id)` 형식이다. `references/rules.md` 에 규칙과 흔한 원인이 있다.
2. 컨트랙트를 보고 싶으면 `pnpm bpmn compile <file.bpmn>` (stdout). IR 을 보려면 `--ir out.json`.
3. 예시로 추가하려면 `packages/bpmn/examples/<name>.bpmn` 에 두고 `pnpm gen:examples` 를 실행한다.
   `contracts/src/<Id>.sol` 과 `contracts/test/generated/<Id>.t.sol` 이 생긴다. 둘 다 커밋한다.
4. 파서·템플릿·IR 을 바꿨으면 `pnpm gen:examples && git diff --stat contracts/` 로 생성물 변화를 확인하고,
   `pnpm typecheck && pnpm test` 를 통과시킨다. ExpenseApproval.sol 이 바뀌면 부록 C 와 어긋나는 것이므로 의도인지 확인한다.
5. Foundry 가 있으면 `cd contracts && forge test -vv`. 없으면 CI 결과를 본다 (같은 테스트를 JS EVM 에서도 `pnpm test` 가 돈다).

## Output

- 생성 컨트랙트: 6개 구역(역할 상수 / 플로우 비트 / 변수 / 인스턴스 관리 / 태스크 함수 / 엔진). 상세는 `references/codegen.md`.
- 생성 테스트: `{Id}Handler`, `{Id}Invariants`(noGhostTokens·endedMeansEmpty·noDeadlock·xorExclusive), `{Id}Scenarios`(경로마다 `test_path_n`).

## Error Handling

- `[XML]` 진단: 참조가 끊긴 id (`flowNodeRef`, `default`, `incoming/outgoing`) 를 먼저 찾는다.
- `Soundness 검사 실패`: 1-safe 위반·데드락·남은 토큰·도달 불가 노드. AND 분기/합류 짝이 맞는지, XOR 기본 플로우가 있는지 본다.
- 생성물 diff 가 CI 에서 실패: 로컬에서 `pnpm gen:examples` 를 다시 돌리고 커밋한다.

## When to Use

- "이 BPMN 이 왜 컴파일이 안 되지" → 1.
- "새 프로세스 예시 추가" → 3.
- "템플릿/규칙/IR 변경" → 4.
- 런타임(배포·태스크 완료·이벤트 구독)을 만질 때는 `packages/runtime` 의 `ProcessAdapter` 를 통해서만 쓰기 호출을 한다 (simulate → send).

## Resources

- `references/rules.md` — R1~R12 와 흔한 원인
- `references/codegen.md` — 상태 인코딩과 템플릿 구역
- `docs/DESIGN.md` — 설계 결정 D1~D12, 로드맵
