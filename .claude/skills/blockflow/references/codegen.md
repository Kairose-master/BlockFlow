# 생성 코드 구조 (packages/codegen)

```
// 시퀀스 플로우 1개 = uint256 marking 의 비트 1개 (1-safe)
// 태스크 활성:   marking & F_in != 0
// 태스크 완료:   marking = (marking & ~F_in) | F_out  → _step() 으로 침묵 전이 고정점
// AND split:    (m & ~F_in) | (F_o1 | F_o2)
// AND join:     if (m & (F_i1|F_i2) == (F_i1|F_i2)) (m & ~(F_i1|F_i2)) | F_out
// XOR split:    m &= ~F_in; m |= cond1 ? F_b1 : F_default
```

템플릿: `templates/contract.sol.mustache` + `partials/{roles,flows,task,step}.mustache`, 테스트는 `templates/test.t.sol.mustache`.
정렬·주석·마스크 문자열은 `src/emit.ts` 가 만들고 템플릿은 줄 배치만 한다. 조건식은 `src/expr.ts` (AST → Solidity / 평가).
시나리오는 `src/scenarios.ts` 가 컨트랙트 의미론을 흉내 내어 경로마다 계획을 만들고 `src/foundry.ts` 가 `.t.sol` 로 렌더링한다.

IR 선택 필드: `userTask.tag` (TASK_ 상수), `endEvent.label`, `*.bpmnId` (다이어그램 매핑).
