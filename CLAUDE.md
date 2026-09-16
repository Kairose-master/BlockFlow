# BlockFlow — 작업 규칙 (Claude Code / 코딩 에이전트용)

BPMN 다이어그램 → 스마트 컨트랙트 생성·제어 도구. 설계 근거는 `docs/bpmn_sc_control_guide.pdf`, 요약은 `docs/DESIGN.md`.
저장소 전용 스킬: `.claude/skills/blockflow/SKILL.md` (파이프라인·검증 절차).

## 명령

```bash
pnpm install
pnpm typecheck && pnpm test      # 커밋 전 필수. vitest: 스키마·DSL·soundness·스냅샷·solc 컴파일·JS EVM 실행
pnpm gen:examples                 # packages/bpmn/examples/*.bpmn → contracts/src/*.sol + contracts/test/generated/*.t.sol
pnpm bpmn lint <file.bpmn>        # 규칙 R1~R12
pnpm bpmn compile <file.bpmn>     # BPMN → Solidity (stdout)
cd contracts && forge test -vv    # Foundry 가 있을 때 (CI 가 항상 실행)
pnpm modeler                      # 앱 개발 서버 (apps/modeler, http://localhost:3000) — 로컬 체인 모드
pnpm --filter @blockflow/devnode node   # Hardhat 3 노드; BLOCKFLOW_RPC_URL=http://127.0.0.1:8545 로 rpc 모드
pnpm chain:probe <rpcUrl>         # 새 체인(FISCO BCOS 등)에 붙이기 전 eth_* 호환성 점검
pnpm modeler:build && PW_CHROMIUM=/path/to/chrome pnpm modeler:e2e   # Playwright E2E
```

## 지켜야 할 것

- `contracts/src/*.sol`, `contracts/test/generated/*.t.sol` 은 **생성물**이다. 손으로 고치지 말고 IR·템플릿·파서를 고친 뒤 `pnpm gen:examples` 로 재생성한다. CI 가 diff 0 을 검사한다.
- `contracts/src/ExpenseApproval.sol` 은 가이드 부록 C 와 바이트 단위로 같아야 한다 (`codegen 스냅샷` 테스트). 템플릿을 바꾸면 부록 C 도 함께 바뀌는 셈이므로 근거를 커밋 메시지에 적는다.
- 생성 코드는 OpenZeppelin 을 import 하지 않는다 (단일 파일, 6.1). `tx.origin` 금지 (6.5).
- IR 스키마(`packages/ir/schema/bf-ir.schema.json`)와 TS 타입(`packages/ir/src/index.ts`)은 항상 같이 바꾼다.
- 규칙 메시지(R1~R12, 커스텀 에러 번역)는 비전문가용 한국어 문장이다. "함수·트랜잭션·가스" 라는 말을 쓰지 않는다 (1.2).
- 조건식 DSL(4.4)에 산술을 추가하지 않는다 (L0). 새 BPMN 요소는 레벨(L0/L1/L2) 을 먼저 정한다.
- L1 요소(결제·타이머)는 템플릿의 `{{#hasPayment}}`/`{{#hasTimer}}` 섹션 안에만 코드를 낸다. L0 예시의 생성물이 1바이트라도 바뀌면 안 된다.
- 프로세스 변수 이름은 생성 코드의 지역 이름(`id`, `m`, `v`, `inst` …)과 겹치면 안 된다 (validator 가 막는다).

## 패키지 의존 방향

`ir` ← `validator` ← `codegen` ← `bpmn`, `runtime` ← `ir`, `apps/modeler` ← 전부. 역방향 import 금지 (테스트는 예외).
런타임 쓰기 호출은 반드시 `ProcessAdapter.send`(simulate 선행) 를 거친다. `packages/runtime/test/viem.test.ts` 는 Hardhat 노드를 스폰하므로 90초까지 걸릴 수 있다.
브라우저 번들에 들어가는 코드(`packages/bpmn`, `@blockflow/codegen/expr`, `/names`)는 `node:fs` 등 Node 전용 API 를 쓰지 않는다.
