# BlockFlow

**BPMN 다이어그램을 그리면 스마트 컨트랙트가 되고, 같은 다이어그램으로 그 컨트랙트를 계속 제어할 수 있는 비전문가용 도구.**

프로그래밍·지갑·가스를 모르는 사람이 BPMN 을 그리는 것만으로 다자간 업무 프로세스를 스마트 컨트랙트로 배포하고,
다이어그램 위에서 인스턴스를 만들고, 자기 차례의 태스크를 완료하고, 진행 상태를 보고, 프로세스를 멈추거나 교체한다.

설계 근거와 세부 스펙은 [`docs/bpmn_sc_control_guide.pdf`](docs/bpmn_sc_control_guide.pdf) (세부 구현 가이드, 22쪽) 이고,
그 요약이 [`docs/DESIGN.md`](docs/DESIGN.md) 다. 이 README 는 저장소 사용법만 다룬다.

## 현재 상태 (가이드 11장 로드맵)

**Phase 0 "골격" — 완료**

| 완료 기준 | 상태 |
|---|---|
| 리포 구조 | pnpm 워크스페이스: `packages/{ir,validator,codegen,bpmn}` + `contracts/` |
| IR 스키마 (JSON Schema) | `packages/ir/schema/bf-ir.schema.json` (bf-ir/0.1) + TS 타입 |
| 예시 IR 3개 손으로 작성 | `packages/ir/examples/{expense-approval,purchase-order,paper-review}.json` |
| 6.6 예시 컨트랙트를 템플릿에서 재생성해 부록 C 와 **diff 0** | 바이트 단위 일치, solc 0.8.37 경고 0, 3,960 B |
| `pnpm test` 에서 codegen 스냅샷 통과 | 통과. 7.6 의 17개 트랜잭션 시나리오를 JS EVM 에서 재현 (가스 수치까지 일치) |

**Phase 1 "컴파일러" — 완료 (모델러 없이 손으로 쓴 BPMN XML 기준)**

| 완료 기준 | 상태 |
|---|---|
| bpmn-moddle 파서 → IR | `packages/bpmn/src/parse.ts` — bc 확장, XOR 합류 정규화, 문서 순서 비트 배정 |
| V1 규칙 R1~R12 | 같은 파일. 비전문가용 한국어 메시지 + 요소 id (UI 배지용) |
| V2 BFS | `packages/validator` (Phase 0 에서 선행) |
| Mustache 생성기, solc 컴파일 | `packages/codegen` + solc-js 0.8.37 |
| Foundry 테스트 생성 | `packages/codegen/src/{scenarios,foundry}.ts` — 불변식 4개 + 도달 경로마다 시나리오 1개 (음성 케이스 포함) |
| 손으로 그린 BPMN 5개(승인/구매/여행예약/논문심사/공급망)가 모두 배포·실행 | `packages/bpmn/examples/*.bpmn` (+ L1 예시 2개: 결제, 타이머) → `contracts/src/*.sol`. `pnpm test` 가 JS EVM 에서 5개 전부 배포하고 모든 경로를 실행, CI 의 `forge test` 가 같은 시나리오와 불변식을 실행 |

**Phase 2 "모델러" — 구현 완료 (`apps/modeler`, Next.js 16 + bpmn-js 18)**

| 완료 기준 | 상태 |
|---|---|
| 팔레트 제한 | 손·선택·시작·끝·할 일·XOR·AND 7개. 컨텍스트 패드도 연결·삭제·이어 붙이기만 |
| bc 속성 패널 | 프로세스 값, 역할(레인) 식별자·담당자 지정 방식, 할 일 영문 이름·입력값, 화살표 조건·기본 화살표, 끝 결과 — 전부 한국어 |
| 조건 빌더 | "만약 [금액] 이 [보다 큼] [1000]" 드롭다운 ↔ `bc:expr` |
| 토큰 시뮬레이션 | bpmn-js-token-simulation 0.40 "미리보기" |
| 한국어 오류 메시지 | 편집 즉시 R1~R12 검사 → 요소 배지 + 목록 (클릭하면 요소 선택) |
| 비개발자 3명이 설명 없이 "경비 승인" 을 그려 컴파일 통과 | **사람 대상 테스트는 아직**. 자동 E2E(Playwright 5건)는 예시 열기 → 컴파일 = 부록 C, 규칙 위반 즉시 표시, 빈 다이어그램에서 역할·값 추가까지 확인 |

```bash
pnpm modeler   # http://localhost:3000
```

**Phase 3 "런타임" — 구현 완료 (지갑·가스 스폰서 제외)**

| 완료 기준 | 상태 |
|---|---|
| 배포 어댑터 | `packages/runtime`: `ProcessAdapter`(deploy/read/simulate/send/watch) + 로컬 EVM 어댑터 + viem 어댑터(JSON-RPC, 폴링 재생). Hardhat 3 노드(`tools/devnode`) 위에서 테스트 |
| 인덱서 | `Indexer`: MarkingChanged/TaskCompleted 로 인스턴스 상태·타임라인 복원, 스냅샷 저장 후 lastBlock 부터 재생, read() 폴백 |
| 4개 화면 | `apps/modeler`: 그리기(모델러+배포) / 내 프로세스(카드, 일시정지) / 프로세스 보드(다이어그램에 marking 색칠, 새 건 시작, 담당자 교체, 기록) / 할 일(내 차례 카드 + 폼) / 기록(타임라인) |
| 임베디드 지갑 + 스폰서 | **미구현**. 지금은 데모 사용자 선택으로 서명자를 고른다(로컬 체인·Hardhat). Privy/Base Account + paymaster 또는 Kaia 대납은 `Signer` 교체로 붙인다 (9장) |
| 3인 3역할로 인스턴스 완주, 가스 0원 체감 | Playwright E2E: 배포 → 새 건(담당자 3명) → 신청·승인·지급·영수증 → 완료, 담당자 교체, 일시정지. 로컬 체인 모드에선 가스가 사용자에게 보이지 않는다 |

```bash
pnpm modeler                                   # 로컬 체인 모드 (설치·키 없이 바로)
pnpm --filter @blockflow/devnode node          # Hardhat 3 JSON-RPC 노드 (다른 터미널)
BLOCKFLOW_RPC_URL=http://127.0.0.1:8545 pnpm modeler   # 실제 JSON-RPC 모드 (chainId 31337 이면 Hardhat 키 자동)
```

`packages/runtime` 의 쓰기는 항상 시뮬레이션 → 성공한 호출만 전송하고, 커스텀 에러는 비전문가 문장으로 번역한다 (8.4).
소유자 제어는 Safe Transaction Builder 호환 "서명 없는 트랜잭션 패키지" 로 내보낼 수 있다. CI 에 Slither 정적 분석(V3).
코딩 에이전트용 절차는 `CLAUDE.md` 와 `.claude/skills/blockflow/`.

**Phase 4 "확장" — 진행 중**

| 항목 | 상태 |
|---|---|
| C6 프로세스 버전 교체 | 완료. 같은 프로세스를 다시 배포하면 새 버전이 되고, 이전 버전은 새 건을 받지 않는다(진행 중인 건은 이전 버전에서 끝냄, 8.2 기본 정책) |
| L1 결제 태스크 (`bc:payToken`·`bc:payTo`·`bc:payAmountVar`) | 완료. 완료 시 담당자가 ERC-20 을 역할/주소에 전송 (transferFrom, nonReentrant + CEI, 6.5). 예시 `invoice-payment.bpmn`, 생성 Foundry 테스트가 토큰 목을 심어 검증 |
| L1 타이머 경계 이벤트 (`bc:deadlineVar` 또는 `bc:deadlineSeconds`) | 완료. 태스크 활성화 시각(startedAt)+기한이 지나면 누구나 `expire{Task}(id)` 로 만료 경로 진행. 예시 `leave-request.bpmn`, 보드에 남은 시간·"만료 처리"·(로컬) 시간 건너뛰기 |
| 신용서비스 프리셋 (앵커 논문 도메인) | 완료. `credit-review.bpmn` "신용 심사 (템플릿)" — 신청·평가(심사 기한 타이머)·고액 위원회 승인·약정 지급 |
| 모델러 초안 자동 저장·복원, 보드 → "다이어그램 편집 (새 버전)" | 완료 |
| L1 오라클·메시지·OR 게이트웨이, 버전 교체 투표 | 미구현 |

남은 것: 임베디드 지갑 + 가스 스폰서(9장), Postgres/IPFS 저장소, 나머지 L1 요소. `docs/DESIGN.md` 로드맵 참고.

## 구조

```
packages/
  ir/          @blockflow/ir        IR 타입 + JSON Schema + 예시 IR                        (가이드 5장, 부록 B)
  validator/   @blockflow/validator IR 구조 검사 + Petri net BFS soundness 검사             (7.2)
  codegen/     @blockflow/codegen   IR → Solidity, IR → Foundry 테스트, 조건식 DSL, 시나리오  (6장, 4.4, 7.4)
  bpmn/        @blockflow/bpmn      BPMN XML → IR 파서, 규칙 R1~R12, bc moddle 확장, 예시 5개 (4장, 5.2, 부록 A)
  runtime/     @blockflow/runtime   어댑터 인터페이스(deploy/simulate/send/watch), 에러 번역, 서명 없는 tx 패키지, 로컬 EVM (8.4, 9.5)
apps/
  modeler/     @blockflow/modeler   Next.js 앱: 모델러(Phase 2) + 제어 화면 4개와 배포/인스턴스/태스크 API (Phase 3)
tools/
  devnode/     @blockflow/devnode   Hardhat 3 로컬 JSON-RPC 노드 (viem 어댑터 테스트, rpc 모드 개발)
contracts/
  src/         생성된 컨트랙트 (손으로 고치지 않음)                                         (부록 C)
  test/        생성된 Foundry 테스트(generated/) + 부록 D 참조본                             (부록 D, 7.6)
docs/          구현 가이드 PDF, 설계 요약
```

## 시작하기

Node ≥ 22, pnpm 10.

```bash
pnpm install
pnpm test            # vitest: 스키마·DSL·soundness·codegen 스냅샷·solc 컴파일·JS EVM 시나리오
pnpm typecheck
pnpm check:sound     # 예시 IR 의 soundness 검사 결과 출력
pnpm bpmn lint packages/bpmn/examples/expense-approval.bpmn      # 규칙 R1~R12 검사
pnpm bpmn compile packages/bpmn/examples/expense-approval.bpmn   # BPMN → Solidity 를 stdout 으로
pnpm codegen packages/ir/examples/expense-approval.json          # IR → Solidity
pnpm gen:examples    # BPMN 예시 5개 → contracts/src/*.sol + contracts/test/generated/*.t.sol 재생성
```

Foundry 가 있으면:

```bash
cd contracts && forge install foundry-rs/forge-std && forge test -vv
```

## 파이프라인 (한 프로세스의 일생)

```
BPMN XML ──▶ bpmn 파서 ──▶ IR(JSON) ──▶ validator ──▶ codegen ──▶ Solidity ──▶ solc 0.8.37 ──▶ 배포/제어
             │ R1~R12                    │ 구조 검사        │ Mustache            │ 경고 0
             │ XOR 합류 정규화            │ 1-safe·데드락·   │ 조건식 DSL           │ Slither/SMTChecker (예정)
             │ 비트 배정·이름 생성         │ 남은 토큰·dead   │ 시나리오 → .t.sol    │ Foundry 불변식·경로 테스트
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
