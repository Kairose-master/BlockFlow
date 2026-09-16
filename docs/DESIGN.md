# BlockFlow 설계 요약

원문: [`bpmn_sc_control_guide.pdf`](bpmn_sc_control_guide.pdf) — "BPMN 기반 비전문가용 스마트 컨트랙트 제어 도구 — 세부 구현 가이드" (2026-09-16, 22쪽).
이 문서는 코드를 읽을 때 옆에 두는 요약이며, 근거 연구·검증 표기·참고문헌은 원문을 본다.

## 1. 한 문장 정의와 "제어"

비전문가가 BPMN 다이어그램을 그리는 것만으로 다자간 업무 프로세스를 스마트 컨트랙트로 배포하고, 같은 다이어그램 위에서
인스턴스를 만들고, 자기 차례의 태스크를 완료하고, 진행 상태를 보고, 프로세스를 멈추거나 교체하는 웹 도구.

선행연구 대부분은 **생성**에서 멈춘다. 이 도구의 차별점은 생성 이후의 **제어 루프**이며, 6개 동작으로 고정한다.

| # | 제어 동작 | 누가 | 온체인 효과 |
|---|---|---|---|
| C1 | 프로세스 배포 | 소유자 | 컨트랙트 1개 배포 |
| C2 | 인스턴스 생성 + 역할 배정 | 소유자 (또는 허용된 역할) | `createInstance()` |
| C3 | 태스크 완료 (데이터 입력 포함) | 해당 역할 담당자 | `taskFn(id, args)` |
| C4 | 역할 담당자 교체 | 소유자 | `rebindRole()` |
| C5 | 일시정지 / 재개 | 소유자 | `setPaused()` |
| C6 | 프로세스 버전 교체 | 소유자 (+선택적 투표) | 새 컨트랙트 배포 + 마이그레이션 정책 |

설계 목표 (우선순위 순): 정확성 → 비전문가 UX (이메일/패스키 로그인만) → 감사 가능성 (온체인 이벤트 타임라인) → 낮은 비용 (태스크 1건 ≤ 60k gas) → 점진적 표현력 (L0 → L1 → L2).

비목표 (MVP): 임의 Solidity 삽입, 크로스체인/ZK/상태채널, Hyperledger Fabric 타깃 (IR 은 플랫폼 중립으로 두어 후속 가능).

## 2. 선행연구에서 가져온 설계 결정

| # | 질문 | 결정 |
|---|---|---|
| D1 | 상태 저장 | 시퀀스 플로우 1개 = `uint256 marking` 비트 1개. `marking & inFlow != 0` 이 "태스크 활성". 256 플로우까지 컨트랙트 1개 |
| D2 | 컴파일형 vs 해석형 | MVP 는 컴파일형 (프로세스 1개 = 컨트랙트 1개). 생성 코드가 사람이 읽을 수 있어 감사가 쉽다. 버전 교체(C6)는 새 컨트랙트 + 마이그레이션 정책 |
| D3 | 인스턴스마다 배포? | 아니오. 한 컨트랙트에 다중 인스턴스 (`mapping(uint => Instance)`). 인스턴스 생성 152k~169k gas |
| D4 | 오케스트레이션 vs 코레오그래피 | 레인 = 역할인 단일 풀 프로세스. 다자간 메시지는 L1 메시지 이벤트로 흡수 |
| D5 | 역할 바인딩 | 생성 시 정적 바인딩 + 소유자 교체(rebind). 동적 지명/승인 정책은 L2 |
| D6 | 게이트웨이 조건 평가 | 프로세스 변수 위의 작은 조건 DSL 을 `_step()` 안 Solidity 식으로 컴파일. 변수는 태스크 완료 시 인자로 |
| D7 | 데이터 | 값 타입(uint/int/bool/address/bytes32)만 온체인, 문서는 bytes32 해시 |
| D8 | LLM | 코드 생성은 규칙 기반 템플릿만. LLM 은 자연어→BPMN 초안, 다이어그램 설명, 테스트 초안에만 |
| D9 | 검증 | 4단계: 구조 규칙 → Petri net soundness → Slither + SMTChecker(CHC) → 자동 생성 Foundry 불변식 |
| D10 | 지갑/가스 | 임베디드 지갑(패스키) + 가스 스폰서. Base + paymaster 또는 Kaia fee delegation |
| D11 | 모델러 | bpmn-js 18 + 팔레트 제한 + moddle 확장 + 토큰 시뮬레이션 + form-js |
| D12 | 산업계 참고 | "XML 중간표현 → 키워드 매핑 → 템플릿 렌더링" 3단 구조 = 5·6장 파이프라인 |

## 3. 아키텍처

```
Browser (Next.js): Modeler(bpmn-js 18) · Validator(클라, 구조 규칙) · Control Panel(인스턴스 보드/폼/타임라인) · Wallet UI(Privy·패스키)
        │ BPMN XML                │ IR / 컨트랙트 주소                │ 서명 요청 (UserOp / FeeDelegated tx)
Backend (Node 22 / TS): parser(bpmn-moddle→IR) · validator(규칙 + Petri net BFS) · codegen(IR→Solidity, Mustache)
                        compile(solc-js 0.8.37, 워커) · verify(slither·SMTChecker·forge) · deploy(viem) · indexer(watchContractEvent→DB)
                        gas(paymaster ERC-7677 / Kaia fee-payer) · storage(Postgres + IPFS)
        │ JSON-RPC
EVM 체인 (Base Sepolia → Base) 또는 Kaia Kairos → Kaia : ProcessContract (프로세스당 1개)
```

신뢰 경계: **온체인 컨트랙트만이 정확성의 근거**. 백엔드·인덱서는 편의 계층이며 다운돼도 익스플로러 + ABI 로 제어 가능해야 한다.
가스 스폰서는 함수 allowlist 로 남용을 막는다.

## 4. BPMN 서브셋

| 레벨 | 요소 |
|---|---|
| **L0 (MVP)** | 시작/종료 이벤트(none), 사용자 태스크, XOR 게이트웨이 분기/합류, AND 게이트웨이 분기/합류, 시퀀스 플로우(조건식·기본 플로우), 레인(=역할), 프로세스 변수 |
| L1 | 서비스 태스크(오라클 콜백), 타이머 경계 이벤트, 메시지 이벤트, 결제 태스크(ERC-20), 루프(1-safe 조건 하), OR 게이트웨이 |
| L2 | 서브프로세스, 콜 액티비티, 다중 인스턴스, 코레오그래피 뷰, DMN, 동적 역할 정책 |

**L0 형식 제약: 프로세스는 1-safe 워크플로우 넷** (모든 플로우에 토큰 최대 1개). 비트맵 인코딩의 정확성 조건이며 검증기가 강제한다.

### 모델러 구현 메모 (`apps/modeler`)

- bpmn-js 는 레인을 풀(참여자) 안에 그리므로 새 다이어그램은 협업 + 참여자 1개로 시작한다. 파서는 참여자 1개짜리 협업을 허용한다.
- 속성 패널은 bpmn-js-properties-panel 대신 React 로 직접 만들었다 (한국어 라벨·조건 빌더를 자유롭게 두기 위해). `modeling.updateProperties` / `updateModdleProperties` 로 쓰므로 undo 가 된다.
- 예시 BPMN(DI 없음)은 `packages/bpmn/src/layout.ts` 가 레인 인식 자동 배치로 좌표를 붙여 연다.
- 컴파일은 서버 라우트(`/api/compile`)에서 규칙 → IR → soundness → Solidity → solc 0.8.37 을 실행한다. 브라우저에는 파서·규칙만 번들된다.

### 확장 속성 (moddle 네임스페이스 `bc`, 부록 A = `packages/bpmn/moddle/bc.json`)

| 대상 | 속성 | 의미 |
|---|---|---|
| `bpmn:Process` | `bc:variables` | 프로세스 변수 선언 `{name, type, initial}` |
| `bpmn:Lane` | `bc:roleKey`, `bc:bindingMode` (`static | ownerRebind | open`) | 역할 상수 이름, 바인딩 방식 |
| `bpmn:UserTask` | `bc:inputs`, `bc:taskId` | 완료 시 입력값 → 함수 인자 + form-js 필드; 이벤트/UI 용 정수 ID |
| `bpmn:SequenceFlow` | `conditionExpression` (bc:expr) | 4.4 DSL |
| `bpmn:ExclusiveGateway` | `default` | 기본 플로우 필수 (토큰 소실 방지) |

### 조건식 DSL (`bc:expr`) — `packages/codegen/src/expr.ts`

```
expr := or ; or := and { "||" and } ; and := cmp { "&&" cmp } ;
cmp  := term ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) term | "!" cmp | "(" or ")" | boolvar ;
term := variable | integer | "true" | "false" | "role(" identifier ")" ;
```
타입 검사: uint256/int256 은 정수와만, bool 은 `==`/`!=`/단독, address 는 `role(...)`/리터럴과만. 나눗셈·곱셈(산술 전반)은 L0 제외.
컴파일: `amount > 1000` → `v.amount > 1000`. UI 는 "만약 [금액] 이 [보다 큼] [1000]" 식 자연어 빌더.

### 정형성 규칙 R1~R12 (클라이언트 즉시 검사) — `packages/bpmn/src/parse.ts`

| # | 규칙 | 비전문가용 메시지 |
|---|---|---|
| R1 | 시작 이벤트 정확히 1개, 들어오는 플로우 없음 | "시작점은 하나여야 해요" |
| R2 | 종료 이벤트 ≥ 1개, 나가는 플로우 없음 | "끝나는 지점이 필요해요" |
| R3 | 모든 태스크는 in 1, out 1 (분기는 게이트웨이로만) | "태스크에서 갈라지려면 마름모를 쓰세요" |
| R4 | 게이트웨이는 분기(in 1, out ≥2) 또는 합류(in ≥2, out 1) 중 하나 | "이 마름모는 갈라지거나 모으는 것 중 하나만" |
| R5 | XOR 분기의 모든 나가는 플로우에 조건, 기본 플로우 1개 필수 | "조건이 없는 화살표가 있어요 / 기본 화살표를 정하세요" |
| R6 | AND 분기 플로우에는 조건 없음 | "동시에 진행하는 화살표엔 조건을 붙일 수 없어요" |
| R7 | 모든 태스크는 레인 안 | "이 일은 누가 하나요?" |
| R8 | 시작→모든 노드, 모든 노드→어떤 종료 도달 가능 | "도달할 수 없는 일이 있어요" |
| R9 | 조건식 타입 검사 통과, 참조 변수 선언됨 | "조건에 쓰인 [x]는 아직 정의되지 않았어요" |
| R10 | 조건 변수는 그 게이트웨이 이전 태스크 입력에서 설정됨 (모든 경로) | "[금액]을 입력받기 전에 조건에서 쓰고 있어요" |
| R11 | 시퀀스 플로우 ≤ 256 | "프로세스가 너무 커요" |
| R12 | 요소 이름 비어 있지 않음 | "이름을 붙여 주세요" |

## 5. 중간표현 (IR, `bf-ir/0.1`) — `packages/ir`

플랫폼 중립 JSON. (1) 코드 생성기가 BPMN 을 다시 파싱하지 않게, (2) Fabric/Go 백엔드를 나중에 붙일 수 있게, (3) 검증기·시뮬레이터·UI 가 같은 모델을 쓰게.

변환 규칙 (BPMN → IR):
- **비트 배정**: 시퀀스 플로우를 문서 순서로 정렬해 0부터. 결정적이어야 재컴파일 시 동일 결과.
- **합류 정규화**: XOR 합류는 노드를 만들지 않고 들어오는 플로우를 다음 노드의 `in` 집합으로 병합. AND 합류만 노드로 남긴다.
- AND 분기의 `in` 이 여러 개면 "어느 하나라도 있으면 소비" (`m & (F4|F11) != 0`). 1-safe 검증이 있어야 안전.
- 종료 이벤트가 여러 개면 `outcome` 으로 구분.
- 침묵 전이 순서: `_step()` 에서 XOR → AND split → AND join → End. 고정점까지 돌므로 순서는 가스에만 영향.

Petri net 뷰: place = flow, transition = node 인 워크플로우 넷. 검증기와 토큰 시뮬레이터가 공유.

## 6. Solidity 생성 규칙 — `packages/codegen`

프로세스 1개 → 컨트랙트 1개, 고정된 6개 구역: 역할 상수 / 플로우 비트 상수 / 변수 구조체 / 인스턴스 관리 / 태스크 함수 / 엔진.
**의존성 없음** — OpenZeppelin 을 import 하지 않는다 (익스플로러 verify 가 단일 파일이면 압도적으로 쉽고 감사 대상이 작다).

```solidity
// 태스크 활성:   marking & F_in != 0
// 태스크 완료:   marking = (marking & ~F_in) | F_out
// AND split:    marking = (marking & ~F_in) | (F_o1 | F_o2 | ...)
// AND join:     if (marking & (F_i1|F_i2) == (F_i1|F_i2)) marking = (marking & ~(F_i1|F_i2)) | F_out
// XOR split:    marking &= ~F_in;  marking |= cond1 ? F_b1 : cond2 ? F_b2 : F_default
```

사용자 태스크 1개 = 함수 1개: `whenNotPaused onlyRole(id, ROLE_X)` → `_require(id, F_in, TASK_n)` → 입력 저장 → `_fire(id, F_in, F_out, TASK_n)`.
string 입력은 받지 않는다 (클라이언트가 keccak/IPFS CID 로 bytes32). `msg.sender` 는 스마트 계정 주소. `tx.origin` 금지.

이벤트: `InstanceCreated`, `RoleBound`, `TaskCompleted`(타임라인), `MarkingChanged`(인덱서는 이것만 보면 상태 복원), `InstanceEnded`.
안전장치: `onlyRole`, `whenNotPaused`, `AlreadyEnded`. 재진입은 외부 호출이 없는 L0 에서 불필요 (L1 결제 태스크부터 `nonReentrant` 인라인).

템플릿 배치: `templates/contract.sol.mustache` + `partials/{roles,flows,task,step}.mustache`, `src/{emit,expr,names}.ts`.

### 가스 측정치 (예시 컨트랙트, JS EVM, Cancun) — `pnpm test` 가 재현

| 동작 | gas |
|---|---|
| 배포 | 905,046 |
| createInstance (역할 3) | 152,026 ~ 169,126 |
| 태스크 완료 (변수 저장 포함) | 59,868 ~ 60,008 |
| 태스크 완료 (저장 없음) | 37,190 |
| 거부된 호출 (커스텀 에러) | 26,197 ~ 30,627 |

## 7. 검증 파이프라인

| 단계 | 시점 | 도구 | 상태 |
|---|---|---|---|
| V1 구조 규칙 R1~R12 | 그리는 중 (클라) | 자체 TS | **구현됨** `packages/bpmn/src/parse.ts` (`lintBpmn`) |
| V2 Soundness | 저장/컴파일 요청 시 | 자체 Petri net BFS | **구현됨** `packages/validator/src/soundness.ts` |
| V3 정적 분석 | 컴파일 후 | solc + Slither 0.11.6 + SMTChecker(CHC) | Phase 1 |
| V4 자동 테스트 | 배포 전 | Foundry 1.8 invariant + 시나리오 | **구현됨** `packages/codegen/src/{scenarios,foundry}.ts` → `contracts/test/generated` |
| V5 미리보기 | 언제나 | bpmn-js-token-simulation 0.40 | **구현됨** `apps/modeler` "미리보기" |

V2 알고리즘: 상태 = marking 하나 (1-safe + 비트맵). 조건식은 비결정적 선택으로 추상화. BFS 로 (a) 1-safe 위반, (b) 데드락, (c) 종료 시 marking ≠ 0 ("남은 토큰"), (d) dead task 를 검출.
L0 는 상태 수가 수백~수천이라 밀리초 안에 끝난다.

SMTChecker: `engine: chc`, `solvers: [z3]`, `targets: [assert, underflow, overflow, outOfBounds]`, `invariants: [contract]`. BMC 는 쓰지 않는다.
Slither 검출기 → 비전문가 문장 매핑표를 유지. 생성 코드는 고정 골격이라 예상 밖 경고는 템플릿 버그로 취급해 배포를 막는다.

## 8. 런타임·제어 UI (Phase 3) — `apps/modeler` 의 /processes, /processes/[addr], /todo, /history

구현 메모: 서버 싱글턴 `Engine`(`src/lib/engine.ts`) 이 어댑터·인덱서·등록부·데모 사용자를 들고 있다. 로컬 모드는 인메모리 체인,
rpc 모드는 viem 어댑터 + `.blockflow/state.json` 스냅샷. 모든 쓰기 API 는 `x-blockflow-user` 헤더로 서명자를 고르고 simulate → send 를 탄다.
보드는 `IR.flows[].bpmnId` 로 marking 비트를 다이어그램 플로우에 칠하고, 활성 태스크에 펄스를 준다.

화면 4개: 내 프로세스(카드, 일시정지 토글) / 프로세스 보드(다이어그램 위 토큰, 활성 태스크 펄스) / 할 일(form-js 폼 → 완료) / 기록(타임라인, 재생 슬라이더).
다이어그램 위 제어 매핑: 시작 이벤트 클릭 = C2, 활성 태스크 클릭 = C3, 레인 헤더 = C4, 프로세스 헤더 = C5, "새 버전 배포" = C6.
인덱서: `viem.watchContractEvent`, 재시작 시 `fromBlock` 부터 재생. 다운 시 UI 는 `enabledTasks()`/`instances()` 직접 조회로 폴백.
트랜잭션 전 `simulateContract` 로 커스텀 에러를 잡아 "이 일은 아직 차례가 아니에요" 로 번역.

## 9. 지갑·가스 추상화 (Phase 2~3)

- **경로 A — Base + 스마트 계정 + Paymaster**: Privy 또는 Coinbase Base Account (패스키), EIP-7702 위임 또는 ERC-4337 EntryPoint v0.7 + permissionless.js. 스폰서 정책 = ProcessContract 주소 + 태스크 함수 셀렉터만 허용. 테스트넷 Base Sepolia (84532).
- **경로 B — Kaia 수수료 대납**: `TxTypeFeeDelegatedSmartContractExecution` 등 프로토콜 네이티브 대납. `@kaiachain/viem-ext`. 테스트넷 Kairos (1001).
- 권장: 한국 사용자·기관 데모면 B, 글로벌/오픈소스면 A. IR·생성기는 동일하고 배포·서명 어댑터(`deploy()`, `sendTask()`, `watch()`)만 다르므로 어댑터 인터페이스를 먼저 고정.
- 남용 방지: 함수 allowlist + 계정당 일일 한도 + `simulateContract` 성공한 호출만 릴레이.
- 어댑터 인터페이스는 `packages/runtime/src/adapter.ts` 에 고정했다 (`deploy / read / simulate / send / watch`).
  `send` 는 항상 `simulate` 를 먼저 하고 실패하면 트랜잭션을 보내지 않는다. 커스텀 에러 → 비전문가 문장 표는 `errors.ts`,
  Safe Transaction Builder 호환 "서명 없는 트랜잭션 패키지" 는 `package.ts` (소유자 제어를 다중서명 지갑에서 실행하거나 백엔드 다운 시 폴백).
- 참고: Aomi Labs (`github.com/aomi-labs`) 의 실행 파이프라인 — Anvil 포크 위 배치 시뮬레이션 → 지갑 요청 큐 → 사용자 서명,
  AA 모드 자동 선택 (Ethereum 은 EIP-7702, L2 는 ERC-4337, Pimlico/Alchemy 스폰서, 둘 다 실패 시 조용한 폴백 없이 에러),
  wagmi + Para(Privy) / Base Account 위젯. 위젯·런타임은 Aomi 백엔드가 필요해 그대로 쓰진 않지만, "시뮬레이션 우선·서명 없는 패키지·
  모드 자동 선택 + 명시적 실패" 원칙은 Phase 3 어댑터 설계에 반영한다. liqsteward 의 "도구는 서명·전송하지 않는다" 경계도 같다.

## 10. 스택 (2026-09 검증)

bpmn-js 18.28 · bpmn-moddle 10.2 · properties-panel 5.65/3.55 · token-simulation 0.40 · form-js 1.26 · solc-js 0.8.37 · Foundry 1.8.3 · Hardhat 3.16 (선택) ·
viem 2.56 / wagmi 3.7 · permissionless.js 0.4 · Privy 3.43 / Base Account 2.5 · @kaiachain/viem-ext 2.1 · Slither 0.11.6 · Node 22 / TS / Postgres / IPFS · Next.js + Tailwind.

## 11. 로드맵 (단독 개발, 주 단위)

| Phase | 주 | 산출물 | 완료 기준 |
|---|---|---|---|
| **0 골격** | 1–2 | 리포 구조, IR 스키마, 예시 IR 3개, 6.6 컨트랙트 템플릿 재생성 diff 0 | `pnpm test` 스냅샷 통과 — **완료** |
| **1 컴파일러** | 3–5 | bpmn-moddle 파서 → IR, V1 규칙, V2 BFS, Mustache 생성기, solc 컴파일, Foundry 테스트 생성 | 손으로 그린 BPMN 5개(승인/구매/여행예약/논문심사/공급망)가 모두 배포·실행 — **완료** (`packages/bpmn/examples`, JS EVM + forge) |
| **2 모델러** | 6–8 | 팔레트 제한, bc 속성 패널, 조건 빌더, 토큰 시뮬레이션, 한국어 오류 메시지 | 구현 완료 (`apps/modeler`, Playwright E2E 5건). 비개발자 3명 사용자 테스트는 미실시 |
| 3 런타임 | 9–12 | 배포 어댑터, 인덱서, 4개 화면, 임베디드 지갑 + 스폰서 | 3인 3역할로 인스턴스 10건 완주, 가스 0원 체감 |
| 4 확장 | 13+ | L1 요소, 버전 교체 투표, 신용서비스 프리셋, 논문화 | — |

각 Phase 끝에 논문화 가능한 측정(가스 표, 검증 시간, 사용자 테스트 성공률)을 남긴다.

## 12. 리스크

1-safe 제약 이해 부족(루프 그리기) → R3/R4 로 태스크 분기 금지, 루프는 L1 프리셋으로만 · 조건식이 온체인 변수에만 의존 → L1 오라클 태스크 ·
프라이버시(금액 노출) → 커밋 해시 저장 옵션 · bpmn-js 워터마크 → 유지 · 스폰서 비용 폭주 → 정책 + 일일 한도 ·
EIP-7702 위임 보안 → 불변 CREATE2 대상만 · 256+ 플로우 → `uint256[]` marking (L2) 또는 서브프로세스 분할.
