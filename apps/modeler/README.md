# @blockflow/modeler

가이드 Phase 2 — 비전문가용 모델러 (Next.js 16 + bpmn-js 18).

- **팔레트 제한** (4.2): 손·선택·시작·끝·할 일·XOR·AND 만. 컨텍스트 패드도 연결·삭제·이어 붙이기만 (교체 메뉴 없음).
- **역할 추가** 버튼 → 풀 안에 레인을 만든다 (bpmn:Lane).
- **속성 패널** (4.3 `bc` 확장, 한국어): 프로세스 값, 역할 식별자·담당자 지정 방식, 할 일 영문 이름·입력값, 화살표 조건, 끝 결과.
- **조건 빌더** (4.4): "만약 [금액] 이 [보다 큼] [1000]" 드롭다운 → `bc:expr`. 빌더가 못 다루는 식은 직접 입력.
- **즉시 검사** (V1): 편집할 때마다 R1~R12 를 돌려 요소에 빨간 배지 + 목록 (클릭하면 요소 선택).
- **미리보기** (V5): bpmn-js-token-simulation.
- **컴파일**: `/api/compile` 가 규칙 → IR → soundness → Solidity → solc 0.8.37 (경고 0) 까지 서버에서 실행하고 요약·소스를 보여준다.
- **예시 열기**: `packages/bpmn/examples/*.bpmn` 을 `/api/examples/:name` 이 레인 인식 자동 배치(DI)로 돌려준다.

```bash
pnpm modeler            # http://localhost:3000 (개발)
pnpm modeler:build && pnpm --filter @blockflow/modeler start
pnpm modeler:e2e        # Playwright (빌드 후). 로컬 Chromium 을 쓰려면 PW_CHROMIUM=/path/to/chrome
```

bpmn-js·token-simulation 의 워터마크는 라이선스 조건대로 유지한다.

## 제어 화면 (Phase 3)

| 화면 | 경로 | 온체인 |
|---|---|---|
| 그리기 | `/` | 컴파일 성공 후 "배포하기" (C1, 소유자) |
| 내 프로세스 | `/processes` | 카드(진행 n건), 일시정지/재개 (C5, 소유자) |
| 프로세스 보드 | `/processes/[address]` | 다이어그램에 marking 색칠·활성 태스크 펄스, 새 건 시작 + 담당자 지정 (C2), 담당자 교체 (C4), 내 차례 폼 (C3), 기록 |
| 할 일 | `/todo` | 내가 담당자인 활성 태스크 카드 → 폼 → 완료 (C3) |
| 기록 | `/history` | 모든 프로세스의 타임라인 |

"나는" 셀렉터로 데모 사용자를 고른다(임베디드 지갑 자리). 서버는 `x-blockflow-user` 헤더로 서명자를 정하고, 쓰기는 항상 시뮬레이션 뒤에 보낸다.

환경변수: `BLOCKFLOW_RPC_URL`(없으면 로컬 인메모리 체인), `BLOCKFLOW_CHAIN_ID`(기본 31337), `BLOCKFLOW_KEYS`(쉼표 구분 개인키; 31337 이면 Hardhat 키 자동), `BLOCKFLOW_STATE`(스냅샷 경로).
