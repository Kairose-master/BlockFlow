# 측정 (자동 생성: `pnpm bench`)

solc 0.8.37, optimizer 200, evmVersion cancun · JS EVM (@ethereumjs/vm, Cancun) · 2026-09-16

가이드 6.8 형식. 태스크 가스는 시나리오 생성기가 만든 모든 도달 경로를 실행해 얻은 최소~최대다. 시간은 이 머신의 단일 실행값이라 참고용이다.

## 프로세스별

| 프로세스 | 요소 | 파싱 | soundness (상태 수) | 생성 | solc | 바이트코드 | 배포 gas | createInstance gas (1번째 / 2번째) | 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 신용 심사 (템플릿) (CreditReview) | 태스크 4, 플로우 12, 역할 4, 타이머 | 21.82 ms | 2.26 ms (13) | 7.83 ms | 548.52 ms | 4,905 B | 1,109,385 | 194,576 / 177,476 | 5 |
| 경비 승인 (ExpenseApproval) | 태스크 4, 플로우 12, 역할 3, L0 | 6.45 ms | 0.33 ms (13) | 0.7 ms | 248.58 ms | 3,960 B | 905,046 | 169,126 / 152,026 | 5 |
| 해외 송금 (FxTransfer) | 태스크 3, 플로우 6, 역할 2, 오라클 | 4.02 ms | 0.1 ms (7) | 0.57 ms | 225.2 ms | 3,760 B | 861,903 | 143,863 / 126,763 | 2 |
| 청구 결제 (InvoicePayment) | 태스크 3, 플로우 6, 역할 2, 결제 | 3.94 ms | 0.15 ms (7) | 0.54 ms | 246.23 ms | 3,810 B | 872,725 | 143,823 / 126,723 | 2 |
| 휴가 신청 (LeaveRequest) | 태스크 2, 플로우 6, 역할 2, 타이머 | 3.78 ms | 0.1 ms (7) | 0.44 ms | 278.32 ms | 4,031 B | 920,459 | 143,896 / 126,796 | 3 |
| 논문 심사 (PaperReview) | 태스크 4, 플로우 10, 역할 4, L0 | 4.27 ms | 0.12 ms (11) | 0.51 ms | 229.45 ms | 4,110 B | 937,512 | 194,567 / 177,467 | 4 |
| 구매 승인 (PurchaseOrder) | 태스크 4, 플로우 9, 역할 4, L0 | 4.09 ms | 0.14 ms (10) | 0.56 ms | 234.18 ms | 4,115 B | 938,604 | 194,545 / 177,445 | 3 |
| 공급망 납품 (SupplyChain) | 태스크 5, 플로우 8, 역할 4, L0 | 4.11 ms | 0.1 ms (9) | 0.5 ms | 243.8 ms | 4,379 B | 995,792 | 194,541 / 177,441 | 2 |
| 여행 예약 (TravelBooking) | 태스크 5, 플로우 15, 역할 3, L0 | 5.04 ms | 0.34 ms (16) | 0.52 ms | 249.84 ms | 4,489 B | 1,019,346 | 169,144 / 152,044 | 9 |

## 태스크 완료 gas

| 프로세스 | 태스크 | 종류 | 입력 수 | gas (최소 ~ 최대) |
|---|---|---|---|---|
| CreditReview | apply_ | 사용자 | 3 | 86,812 ~ 106,736 |
| CreditReview | score | 사용자 | 1 | 39,818 ~ 62,130 |
| CreditReview | disburse | 사용자 | 1 | 59,503 |
| CreditReview | score (만료) | 타이머 만료 | 0 | 39,046 |
| CreditReview | approve | 사용자 | 1 | 39,918 ~ 60,055 |
| ExpenseApproval | submit | 사용자 | 1 | 39,986 ~ 59,868 |
| ExpenseApproval | pay | 사용자 | 0 | 37,190 ~ 37,193 |
| ExpenseApproval | uploadReceipt | 사용자 | 1 | 59,529 ~ 59,532 |
| ExpenseApproval | approve | 사용자 | 1 | 39,839 ~ 60,008 |
| FxTransfer | request | 사용자 | 1 | 63,580 |
| FxTransfer | fetchRate | 오라클 | 1 | 39,536 ~ 59,673 |
| FxTransfer | send_ | 사용자 | 1 | 59,400 |
| InvoicePayment | invoice | 사용자 | 2 | 61,783 |
| InvoicePayment | review | 사용자 | 1 | 39,687 ~ 59,824 |
| InvoicePayment | pay | 결제(ERC-20) | 0 | 63,736 |
| LeaveRequest | request | 사용자 | 2 | 64,508 |
| LeaveRequest | approve | 사용자 | 1 | 39,811 ~ 59,716 |
| LeaveRequest | approve (만료) | 타이머 만료 | 0 | 38,939 |
| PaperReview | submitPaper | 사용자 | 1 | 59,687 |
| PaperReview | reviewA | 사용자 | 1 | 39,512 ~ 59,627 |
| PaperReview | reviewB | 사용자 | 1 | 39,570 ~ 59,685 |
| PaperReview | decide | 사용자 | 1 | 39,818 ~ 63,963 |
| PurchaseOrder | request | 사용자 | 2 | 62,073 ~ 81,987 |
| PurchaseOrder | order | 사용자 | 0 | 37,070 |
| PurchaseOrder | confirmDelivery | 사용자 | 1 | 59,393 |
| PurchaseOrder | approve | 사용자 | 1 | 39,782 ~ 59,919 |
| SupplyChain | ship | 사용자 | 2 | 61,843 |
| SupplyChain | deliver | 사용자 | 1 | 59,395 |
| SupplyChain | inspect | 사용자 | 2 | 42,323 ~ 64,451 |
| SupplyChain | raiseClaim | 사용자 | 1 | 59,283 |
| SupplyChain | pay | 사용자 | 1 | 59,280 |
| TravelBooking | request | 사용자 | 2 | 62,399 ~ 82,281 |
| TravelBooking | bookFlight | 사용자 | 1 | 59,612 ~ 59,893 |
| TravelBooking | bookHotel | 사용자 | 1 | 59,546 ~ 59,827 |
| TravelBooking | confirm | 사용자 | 1 | 40,031 ~ 59,936 |
| TravelBooking | approveBudget | 사용자 | 1 | 39,915 ~ 60,084 |

## 요약

- 사용자 태스크 완료 gas: 37,070 ~ 106,736 (입력 0개 ≈ 37k, 1개 ≈ 60k, 2개 ≈ 82k — 슬롯 쓰기 1개당 약 22k)
- 배포 gas: 861,903 ~ 1,109,385, 인스턴스 생성: 역할 수에 비례 (역할당 RoleBound 저장·이벤트)
- soundness 검사: 모든 예시 2.26 ms 이하 (L0 상태 수 수십 개 규모, 7.2)
- 문헌 대비 (6.8): Caterpillar 컴파일형 인스턴스 생성 1.1~2.8M, ChorChain 인스턴스=배포 4.5M, 俞东进 2021 0.21M → 다중 인스턴스 단일 컨트랙트(D3)가 인스턴스 생성을 한 자릿수 줄인다.
