/**
 * Phase 0 완료 기준 (가이드 11장): 템플릿에서 재생성한 컨트랙트가 부록 C(= contracts/src/ExpenseApproval.sol)
 * 와 diff 0 이고, solc 0.8.37 에서 경고 0 으로 컴파일된다.
 */
import { describe, expect, it } from "vitest";
import { generate } from "../src/index";
import { compile, solcVersion } from "./helpers/solc";
import { exampleFiles, loadExample, readContract } from "./helpers/examples";

describe("codegen 스냅샷", () => {
  it("solc 0.8.37 을 쓴다", () => {
    expect(solcVersion()).toMatch(/^0\.8\.37/);
  });

  for (const file of exampleFiles()) {
    const ir = loadExample(file);

    // contracts/src 는 packages/bpmn/examples 에서 생성된다. 손으로 쓴 IR 예시 중 부록 B 는 부록 C 와 diff 0 이어야 한다.
    if (file === "expense-approval.json") {
      it(`${file} (부록 B) → contracts/src/ExpenseApproval.sol (부록 C) 과 diff 0`, () => {
        expect(generate(ir)).toBe(readContract(ir.process.id));
      });
    }

    it(`${file} 생성 코드가 경고 0 으로 컴파일된다`, () => {
      const c = compile(generate(ir), ir.process.id);
      expect(c.diagnostics).toEqual([]);
      expect(c.bytecode.length).toBeGreaterThan(2);
    });

    it(`${file} 생성은 결정적이다`, () => {
      expect(generate(ir)).toBe(generate(ir));
    });
  }

  // 이식성: 구버전 EVM(paris = PUSH0 없음, shanghai) 을 쓰는 컨소시엄 체인(FISCO BCOS 3.7 LTS 등)에서도 컴파일된다
  for (const evm of ["paris", "shanghai"] as const) {
    it(`모든 예시가 evmVersion=${evm} 로도 경고 0 으로 컴파일된다`, () => {
      for (const file of exampleFiles()) {
        const ir = loadExample(file);
        const c = compile(generate(ir), ir.process.id, evm);
        expect(c.diagnostics, `${file} @ ${evm}`).toEqual([]);
      }
    });
  }

  it("ExpenseApproval 바이트코드 크기가 가이드 6.6 (3,960 B) 과 같다", () => {
    const c = compile(readContract("ExpenseApproval"), "ExpenseApproval");
    expect((c.bytecode.length - 2) / 2).toBe(3960);
  });

  it("검증 실패 IR 은 생성하지 않는다", () => {
    const ir = loadExample("expense-approval.json");
    // AND join 의 한쪽 입력을 끊어 데드락을 만든다.
    const broken = structuredClone(ir);
    const t4 = broken.nodes.find((n) => n.id === "T4");
    if (t4?.kind !== "userTask") throw new Error("T4");
    t4.out = ["F9"];
    broken.flows = broken.flows.map((f) => (f.id === "F9" ? { ...f, to: "T4" } : f));
    expect(() => generate(broken)).toThrow();
  });
});
