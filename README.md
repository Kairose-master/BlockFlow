# BlockFlow

**BPMN 다이어그램을 그리면 스마트 컨트랙트가 되고, 같은 다이어그램으로 그 컨트랙트를 계속 제어할 수 있는 비전문가용 도구.**

프로그래밍·지갑·가스를 모르는 사람이 BPMN 을 그리는 것만으로 다자간 업무 프로세스를 스마트 컨트랙트로 배포하고,
다이어그램 위에서 인스턴스를 만들고, 자기 차례의 태스크를 완료하고, 진행 상태를 보고, 프로세스를 멈추거나 교체한다.

설계 근거와 세부 스펙은 [`docs/bpmn_sc_control_guide.pdf`](docs/bpmn_sc_control_guide.pdf) (세부 구현 가이드, 22쪽) 이고,
그 요약이 [`docs/DESIGN.md`](docs/DESIGN.md) 다. 이 README 는 저장소 사용법만 다룬다.

## 현재 상태 — Phase 0 "골격" (가이드 11장)

| 완료 기준 | 상태 |
|---|---|
| 리포 구조 | pnpm 워크스페이스: `packages/{ir,validator,codegen,bpmn}` + `contracts/` |
| IR 스키마 (JSON Schema) | `packages/ir/schema/bf-ir.schema.json` (bf-ir/0.1) + TS 타입 |
| 예시 IR 3개 손으로 작성 | `packages/ir/examples/{expense-approval,purchase-order,paper-review}.json` |
| 6.6 예시 컨트랙트를 템플릿에서 재생성해 부록 C 와 **diff 0** | `pnpm test` 의 `codegen 스냅샷` — 바이트 단위 일치, solc 0.8.37 경고 0, 3,960 B |
| `pnpm test` 에서 codegen 스냅샷 통과 | 통과. 추가로 7.6 의 17개 트랜잭션 시나리오를 JS EVM 에서 재현 (가스 수치까지 일치) |

Phase 1 이후 (BPMN 파서, 모델러, 런타임, 지갑) 는 `docs/DESIGN.md` 의 로드맵을 따른다.

## 구조

```
packages/
  ir/          @blockflow/ir        IR 타입 + JSON Schema + 예시 IR             (가이드 5장, 부록 B)
  validator/   @blockflow/validator IR 구조 검사 + Petri net BFS soundness 검사  (7.2)
  codegen/     @blockflow/codegen   IR → Solidity (Mustache 템플릿, 조건식 DSL)   (6장, 4.4)
  bpmn/        @blockflow/bpmn      bc moddle 확장 JSON. 파서는 Phase 1           (부록 A)
contracts/
  src/         생성된 컨트랙트 (손으로 고치지 않음)                              (부록 C)
  test/        Foundry 불변식 + 시나리오 테스트                                  (부록 D, 7.6)
docs/          구현 가이드 PDF, 설계 요약
```

## 시작하기

Node ≥ 22, pnpm 10.

```bash
pnpm install
pnpm test            # vitest: 스키마·DSL·soundness·codegen 스냅샷·solc 컴파일·JS EVM 시나리오
pnpm typecheck
pnpm check:sound     # 예시 IR 의 soundness 검사 결과 출력
pnpm codegen packages/ir/examples/expense-approval.json          # Solidity 를 stdout 으로
pnpm gen:examples    # 모든 예시 IR → contracts/src/*.sol 재생성
```

Foundry 가 있으면:

```bash
cd contracts && forge install foundry-rs/forge-std && forge test -vv
```

## 파이프라인 (한 프로세스의 일생)

```
BPMN XML ──(Phase 1 파서)──▶ IR(JSON) ──▶ validator ──▶ codegen ──▶ Solidity ──▶ solc 0.8.37 ──▶ 배포/제어
                                            │ 구조 검사              │ Mustache        │ 경고 0
                                            │ 1-safe·데드락·         │ 조건식 DSL       │ Slither/SMTChecker (Phase 1)
                                            │ 남은 토큰·dead task    │ 이름 충돌 처리    │ Foundry 불변식 (부록 D)
```

핵심 인코딩 (D1): **시퀀스 플로우 1개 = `uint256 marking` 의 비트 1개**. 태스크 활성 = `marking & F_in != 0`.
프로세스 1개 = 컨트랙트 1개, 인스턴스는 컨트랙트 안의 `mapping` (D2, D3). 게이트웨이·종료 이벤트는 `_step()` 안의 침묵 전이.

## IR 에 대한 메모

부록 B 의 IR 에 다음 선택 필드를 더했다 (스키마에 반영):

- `userTask.tag` — `TASK_{TAG}` 상수용 짧은 이름. 없으면 함수 이름에서 파생 (`uploadReceipt` → `UPLOAD_RECEIPT`). 부록 C 의 `TASK_RECEIPT` 를 재현하려면 `"tag": "RECEIPT"`.
- `endEvent.label` — 주석/UI 라벨. `outcome` 이 `completed` 가 아닌 종료는 `InstanceEnded(id, false)` 로 나간다. 종료 결과가 3개 이상이면 5.2 의 `outcomeCode` 로 확장한다 (Phase 1).

조건식 DSL (`bc:expr`, 4.4) 은 비교·논리·`role(X)` 만 지원하고 산술은 L0 에서 제외한다. 정수 리터럴은 상대 변수 타입(uint256/int256)에 맞춘다.

## 라이선스

MIT. bpmn-js·form-js 는 워터마크 유지 조건 라이선스이므로 Phase 2 에서 그대로 유지한다 (12장).
