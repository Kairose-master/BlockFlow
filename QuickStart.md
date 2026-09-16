# BlockFlow 빠른 시작

BPMN 다이어그램을 그리면 스마트 컨트랙트가 만들어지고, 그 위에서 "새 건 시작 → 담당자별 할 일 완료 → 종료" 를 돌려 볼 수 있다.
코드나 지갑을 몰라도 된다. 10분이면 첫 프로세스를 끝까지 돌린다.

## 0. 준비물

| 항목 | 버전 | 확인 |
|---|---|---|
| Node.js | 22 이상 | `node -v` |
| pnpm | 10 | `corepack enable && pnpm -v` |
| (선택) Foundry | 최신 | `forge --version` — 없어도 된다. CI 가 대신 돌린다 |
| (선택) Chromium | — | E2E 테스트에서만 필요 |

```bash
git clone https://github.com/Kairose-master/BlockFlow.git
cd BlockFlow
pnpm install
pnpm typecheck && pnpm test   # 99개 테스트가 통과하면 준비 끝 (약 10~20초)
```

## 1. 모델러 켜기 (로컬 모드)

```bash
pnpm modeler
# → http://localhost:3000
```

별도 노드나 지갑이 필요 없다. 서버 안에 인메모리 EVM 이 떠 있고, 데모 사용자 8명이 미리 들어 있다.
화면 오른쪽 위 **사용자 선택**으로 역할을 바꿔 가며 쓴다.

| 데모 사용자 | 쓰임 |
|---|---|
| 운영자 (소유자) | 배포, 새 건 시작, 담당자 교체, 일시정지 |
| 김신청 · 이팀장 · 박재무 | 경비 승인 예시의 신청자 · 팀장 · 재무 |
| 최구매 · 정공급 · 한심사 | 구매·청구·심사 예시 |
| 오라클 (외부 서비스) | 외부 서비스 단계에 답하는 계정 |

서버를 껐다 켜면 로컬 체인은 초기화된다 (배포한 프로세스도 사라진다). 남기고 싶으면 5장의 rpc 모드를 쓴다.

## 2. 첫 프로세스 5분 완주 — 경비 승인

1. **예시 열기**: 모델러 상단 `예시 열기…` 드롭다운에서 **경비 승인** 을 고른다. 레인 3개(신청자·팀장·재무)와 태스크 4개가 보인다.
2. **컴파일**: `컴파일` 을 누른다. 다이어그램 규칙(R1~R12)과 soundness 를 검사한 뒤 Solidity 를 만든다.
   오류가 있으면 해당 요소가 빨갛게 표시되고, 아래에 한국어 설명이 뜬다.
3. **배포**: 사용자를 **운영자 (소유자)** 로 두고 `배포` 를 누른다. 프로세스 보드로 이동한다.
4. **새 건 시작**: 보드에서 `새 건 시작` → 신청자=김신청, 팀장=이팀장, 재무=박재무 → 확인. 다이어그램의 첫 태스크에 토큰이 놓인다.
5. **할 일 완료**: 사용자를 **김신청** 으로 바꾸고 **할 일** 메뉴로 간다. 카드에 금액(예: 5000)을 넣고 `완료`.
   이어서 **이팀장**(승인) → **박재무**(지급) → **김신청**(영수증) 순서로 사용자를 바꿔 가며 완료한다.
6. **기록 보기**: **기록** 메뉴에서 타임라인과 재생 슬라이더로 어떤 순서로 진행됐는지 확인한다.

보드에서 할 수 있는 제어 (가이드의 C1~C6):

| 하고 싶은 것 | 어디서 |
|---|---|
| 새 건 시작 + 담당자 지정 | 보드 `새 건 시작` |
| 담당자 교체 | 보드 인스턴스의 역할 드롭다운 |
| 잠시 멈춤 / 재개 | 내 프로세스 카드의 일시정지 토글 |
| 다이어그램 고쳐서 새 버전 배포 | 보드 `다이어그램 편집 (새 버전)` → 컴파일 → 배포. 이전 버전은 새 건을 받지 않는다 |
| 기한 지난 단계 만료 처리 | 보드의 `만료 처리` (로컬 모드는 `1시간 건너뛰기` 로 시험 가능) |

## 3. 다른 예시 9개

`예시 열기…` 드롭다운에 모두 들어 있다. 새 요소를 배우려면 이 순서를 권한다.

| 예시 | 배우는 것 |
|---|---|
| 경비 승인 | 기본 흐름, 조건 분기(금액이 크면 승인 필요) |
| 구매 승인 · 휴가 신청 | 예/아니오 분기, 타이머(기한이 지나면 누구나 만료 처리해 다음 경로로) |
| 여행 예약 | 병렬(항공+호텔을 동시에 진행하고 합류) |
| 논문 심사 · 공급망 납품 | 4개 역할, 여러 검토자 |
| 청구 결제 | **결제 태스크**: 완료하면 ERC-20 토큰이 공급사에게 간다. 로컬 모드는 데모 토큰을 자동으로 심어 준다 |
| 해외 송금 | **외부 서비스**: 환율을 오라클 사용자가 답한다 |
| 신용 심사 (템플릿) | 타이머 + 고액 위원회 승인 + 약정 지급이 한 번에 |

## 4. 내 프로세스 그리기

1. 모델러에서 `새로 만들기`. 팔레트에는 필요한 9개 요소만 있다: 레인, 시작, 사용자 태스크, 외부 서비스, 예/아니오 분기(XOR), 동시 진행(AND) 나눔/합류, 타이머, 종료.
2. **레인** 하나가 **역할** 하나다. 레인을 클릭해 오른쪽 패널에서 역할 이름(영문 키)을 적는다.
3. **태스크**를 레인에 놓고, 패널에서 이 단계가 받을 값(이름·종류: 숫자/예아니오/글)을 추가한다.
4. **분기**에서 나가는 화살표마다 조건을 조건 빌더로 고른다(`amount > 1000`, `approved == true`). 하나는 "그 외" 로 둔다.
5. `컴파일` → 오류 문장을 보고 고친다 → `배포`.

규칙 요약 (자세한 건 `docs/DESIGN.md` 4장):

- 시작 하나, 종료는 여러 개 가능. 태스크는 들어오는 화살표 1개, 나가는 화살표 1개.
- 분기에서 쓰는 값은 그 전에 어떤 태스크가 반드시 채웠어야 한다.
- 동시 진행을 나눴으면 반드시 합류시킨다. 같은 곳으로 두 토큰이 가면 안 된다 (soundness 검사가 잡는다).
- 값 이름은 영문 소문자로 시작하고, `id`, `days`, `owner` 같은 예약어는 피한다.

초안은 브라우저에 자동 저장된다. 컴파일 결과 옆 `배포 번들` 은 소스·ABI·바이트코드를 내려받아 Remix, 다중서명 지갑, FISCO BCOS 콘솔 등 다른 곳에서 배포할 때 쓴다.

## 5. 실제 노드에 붙이기 (rpc 모드)

로컬 Hardhat 노드:

```bash
# 터미널 1
pnpm --filter @blockflow/devnode node        # http://127.0.0.1:8545, chainId 31337

# 터미널 2
BLOCKFLOW_RPC_URL=http://127.0.0.1:8545 pnpm modeler
```

chainId 31337 이면 Hardhat 기본 계정이 데모 사용자로 자동 배정된다. 배포 목록과 인덱스는 `.blockflow/state.json` 에 남아 재시작해도 유지된다.

다른 체인(테스트넷, FISCO BCOS Ethereum 호환 레인 등):

```bash
pnpm chain:probe https://rpc.example.org      # eth_* 메서드, EIP-1559, PUSH0 지원 여부를 먼저 점검

BLOCKFLOW_RPC_URL=https://rpc.example.org \
BLOCKFLOW_CHAIN_ID=12345 \
BLOCKFLOW_KEYS=0xkey1,0xkey2,0xkey3 \        # 데모 사용자 순서대로 배정된다 (첫 키 = 운영자)
pnpm modeler
```

| 환경 변수 | 뜻 | 기본값 |
|---|---|---|
| `BLOCKFLOW_RPC_URL` | 없으면 로컬 인메모리 모드 | — |
| `BLOCKFLOW_CHAIN_ID` | 체인 id | 31337 |
| `BLOCKFLOW_KEYS` | 쉼표로 나눈 개인키 목록 | 31337 이면 Hardhat 키 |
| `BLOCKFLOW_EVM_VERSION` | 생성 컨트랙트의 EVM 버전 `paris`/`shanghai`/`cancun` (PUSH0 미지원 노드는 `paris`) | cancun |
| `BLOCKFLOW_STATE` | 배포 목록 저장 파일 | `.blockflow/state.json` |
| `BLOCKFLOW_POLL_MS` | 이벤트 폴링 간격 | 1000 |

주의: 개인키는 데모·테스트용만 넣는다. 결제 태스크는 rpc 모드에서 실제 토큰의 잔액과 허용량을 확인한 뒤에만 보낸다.

## 6. 명령줄만 쓰기

```bash
pnpm bpmn lint packages/bpmn/examples/expense-approval.bpmn      # 규칙 검사만
pnpm bpmn compile packages/bpmn/examples/expense-approval.bpmn   # Solidity 를 stdout 으로
pnpm codegen packages/ir/examples/expense-approval.json          # 중간표현(IR) → Solidity
pnpm check:sound                                                 # 예시 IR 의 soundness 결과
pnpm gen:examples     # 예시 전부 → contracts/src, contracts/test/generated (CI 가 diff 0 검사)
pnpm bench            # 예시 9개의 시간·크기·가스 측정표 → docs/measurements.md
```

Foundry 가 있으면 생성된 불변식·시나리오 테스트도 돌릴 수 있다.

```bash
cd contracts && forge install foundry-rs/forge-std && forge test -vv
```

## 7. 앱 테스트 (E2E)

```bash
pnpm modeler:build
PW_CHROMIUM=/path/to/chromium pnpm modeler:e2e     # Playwright 14건: 모델러 7 + 콘솔 7
# rpc 모드로 돌리면(BLOCKFLOW_RPC_URL 설정) 결제 테스트 1건은 건너뛴다 — 예시 토큰 주소에 컨트랙트가 없어서
```

## 8. 막혔을 때

| 증상 | 확인 |
|---|---|
| `컴파일` 이 빨간 요소를 가리킨다 | 아래 문장이 규칙 번호(R1~R12)와 고칠 방법을 알려 준다. 값 이름·조건·화살표 수를 본다 |
| "이 일은 아직 차례가 아니에요" | 다른 사용자 차례다. 보드에서 토큰 위치를 보고 사용자를 바꾼다 |
| 할 일이 비어 있다 | 내가 그 건의 담당자로 지정됐는지(보드 인스턴스의 역할) 확인한다 |
| rpc 모드 기동 시 경고 | `pnpm chain:probe <url>` 결과대로 노드가 `eth_*` 를 지원하는지, PUSH0 이 안 되면 `BLOCKFLOW_EVM_VERSION=paris` |
| 로컬 모드에서 배포한 게 사라졌다 | 서버 재시작으로 인메모리 체인이 초기화된 것. 남기려면 rpc 모드 |
| rpc 모드에서 "이 체인에는 결제 토큰(0x1000…)이 없어요" | 예시의 결제 토큰 주소는 로컬 모드용 자리표시다. 속성 패널에서 그 체인에 있는 ERC-20 주소로 바꾼다 |
| `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm install` 후 `pnpm-lock.yaml` 을 함께 커밋 |

더 읽기: `README.md` (현재 상태·구조), `docs/DESIGN.md` (설계 결정·규칙·생성 규칙), `docs/measurements.md` (측정표), `CLAUDE.md` (기여 규칙).
