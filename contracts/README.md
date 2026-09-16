# contracts

`src/` 의 컨트랙트는 전부 `packages/ir/examples/*.json` 에서 **생성기가 만든 산출물**이다. 손으로 고치지 말고
IR 이나 템플릿을 고친 뒤 `pnpm gen:examples` 로 다시 생성한다 (`pnpm test` 의 스냅샷 테스트가 diff 0 을 강제한다).

- `src/ExpenseApproval.sol` — 가이드 6.6 / 부록 C 의 검증된 예시 (solc 0.8.37, optimizer 200, cancun: 경고 0, 3,960 B)
- `src/PurchaseOrder.sol`, `src/PaperReview.sol` — 추가 예시 (XOR 합류가 태스크로 병합된 경우, AND 분기 단일 입력)
- `test/ExpenseApproval.t.sol` — 부록 D 불변식 + 7.6 시나리오 (Foundry)

## Foundry 로 실행

```bash
cd contracts
forge install foundry-rs/forge-std   # 최초 1회 (lib/ 은 커밋하지 않는다)
forge test -vv
```

Foundry 가 없는 환경에서는 `pnpm test` 가 solc-js 0.8.37 + @ethereumjs/vm 으로 같은 시나리오를 실행한다
(`packages/codegen/test/evm.test.ts`).
