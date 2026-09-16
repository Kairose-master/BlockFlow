import { describe, expect, it } from "vitest";
import { compileExpr, ExprError } from "../src/expr";

const ir = {
  variables: [
    { name: "amount", type: "uint256" as const },
    { name: "delta", type: "int256" as const },
    { name: "approved", type: "bool" as const },
    { name: "payee", type: "address" as const },
    { name: "docHash", type: "bytes32" as const },
  ],
  roles: [{ key: "Manager", label: "팀장", binding: "static" as const }],
};

describe("bc:expr → Solidity", () => {
  it("비교식", () => {
    const c = compileExpr("amount > 1000", ir);
    expect(c.sol).toBe("v.amount > 1000");
    expect(c.atomic).toBe(false);
    expect(c.variables).toEqual(["amount"]);
  });

  it("단독 bool 변수는 atomic", () => {
    const c = compileExpr("approved", ir);
    expect(c).toMatchObject({ sol: "v.approved", atomic: true });
    expect(compileExpr("!approved", ir)).toMatchObject({ sol: "!v.approved", atomic: true });
  });

  it("논리 연결과 괄호", () => {
    expect(compileExpr("approved && amount >= 3 || (amount < 1 && !approved)", ir).sol).toBe(
      "v.approved && v.amount >= 3 || (v.amount < 1 && !v.approved)",
    );
    expect(compileExpr("!(approved || amount == 0)", ir).sol).toBe("!(v.approved || v.amount == 0)");
  });

  it("역할 주소 비교", () => {
    const c = compileExpr("payee == role(Manager)", ir);
    expect(c.sol).toBe("v.payee == roleOf[id][ROLE_MANAGER]");
    expect(c.roles).toEqual(["Manager"]);
    expect(compileExpr("payee != 0x0000000000000000000000000000000000000001", ir).sol).toBe(
      "v.payee != 0x0000000000000000000000000000000000000001",
    );
  });

  it("int256 은 음수 리터럴과 비교 가능, uint256 은 불가", () => {
    expect(compileExpr("delta < -5", ir).sol).toBe("v.delta < -5");
    expect(() => compileExpr("amount < -5", ir)).toThrow(ExprError);
  });

  it("타입 오류를 거부한다", () => {
    expect(() => compileExpr("approved > 1", ir)).toThrow(ExprError);
    expect(() => compileExpr("amount == approved", ir)).toThrow(ExprError);
    expect(() => compileExpr("docHash < docHash", ir)).toThrow(ExprError);
    expect(() => compileExpr("amount", ir)).toThrow(ExprError);
    expect(() => compileExpr("1 == 1", ir)).toThrow(ExprError);
  });

  it("선언되지 않은 변수/역할을 거부한다", () => {
    expect(() => compileExpr("total > 1", ir)).toThrow(/선언되지 않았습니다/);
    expect(() => compileExpr("payee == role(Finance)", ir)).toThrow(/역할 'Finance'/);
  });

  it("산술 연산은 L0 에서 제외", () => {
    expect(() => compileExpr("amount + 1 > 2", ir)).toThrow(ExprError);
    expect(() => compileExpr("amount * 2 > 2", ir)).toThrow(ExprError);
  });

  it("문법 오류", () => {
    expect(() => compileExpr("amount >", ir)).toThrow(ExprError);
    expect(() => compileExpr("(amount > 1", ir)).toThrow(ExprError);
    expect(() => compileExpr("amount > 1 2", ir)).toThrow(ExprError);
  });
});
