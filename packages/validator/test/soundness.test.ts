import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IR, UserTaskNode } from "@blockflow/ir";
import { checkSoundness, checkStructure } from "../src/index";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ir", "examples");
const load = (f: string) => JSON.parse(readFileSync(join(examplesDir, f), "utf8")) as IR;
const task = (ir: IR, id: string): UserTaskNode => {
  const n = ir.nodes.find((x) => x.id === id);
  if (n?.kind !== "userTask") throw new Error(id);
  return n;
};

describe("구조 검사 + soundness (V2)", () => {
  for (const f of readdirSync(examplesDir).filter((x) => x.endsWith(".json")).sort()) {
    it(`${f} 는 구조·soundness 를 통과한다`, () => {
      const ir = load(f);
      expect(checkStructure(ir)).toEqual([]);
      const r = checkSoundness(ir);
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.states).toBeGreaterThan(1);
    });
  }

  it("경비 승인: 도달 상태 13개, 종료 상태는 marking 0", () => {
    const r = checkSoundness(load("expense-approval.json"));
    expect(r.states).toBe(13);
    const ended = [...r.paths.keys()].filter((k) => k.endsWith("E"));
    expect(ended).toEqual(["0E"]);
    expect(r.paths.get("0E")?.at(-1)).toMatch(/^end_(ok|rej)\(F1[02]\)$/);
  });

  it("데드락: AND split 이 한 가지만 내보내면 AND join 이 영원히 기다린다", () => {
    const ir = load("expense-approval.json");
    const a1 = ir.nodes.find((n) => n.id === "A1");
    if (a1?.kind !== "andSplit") throw new Error();
    a1.out = ["F6"]; // F7 (→ T4 영수증) 을 생산하지 않음
    const r = checkSoundness(ir);
    expect(r.ok).toBe(false);
    const kinds = r.problems.map((p) => p.kind);
    expect(kinds).toContain("deadlock");
    expect(kinds).toContain("dead");
    expect(r.problems.filter((p) => p.kind === "dead").map((p) => p.node).sort()).toEqual(["A2", "T4", "end_ok"]);
  });

  it("남은 토큰: 병렬 가지 중 하나가 곧바로 종료로 가면", () => {
    const ir = load("expense-approval.json");
    // T3 pay → end_ok 로 직결 (F8 이 A2 가 아니라 end_ok 로)
    ir.flows = ir.flows.map((f) => (f.id === "F8" ? { ...f, to: "end_ok" } : f));
    const endOk = ir.nodes.find((n) => n.id === "end_ok");
    if (endOk?.kind !== "endEvent") throw new Error();
    endOk.in = ["F10", "F8"];
    const a2 = ir.nodes.find((n) => n.id === "A2");
    if (a2?.kind !== "andJoin") throw new Error();
    a2.in = ["F9", "F9"];
    const r = checkSoundness(ir);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.kind)).toContain("leftover");
  });

  it("1-safe 위반: 이미 토큰이 있는 플로우에 생산", () => {
    const ir = load("paper-review.json");
    // T2 reviewA 가 F5 대신 F4 (T3 의 입력, 이미 토큰 있음) 를 생산하도록
    task(ir, "T2").out = ["F4"];
    ir.flows = ir.flows.map((f) => (f.id === "F4" ? { ...f, from: "T2" } : f));
    const a1 = ir.nodes.find((n) => n.id === "A1");
    if (a1?.kind !== "andSplit") throw new Error();
    a1.out = ["F3", "F4"];
    const r = checkSoundness(ir);
    expect(r.problems.map((p) => p.kind)).toContain("unsafe");
  });

  it("구조 검사: 참조 무결성", () => {
    const ir = load("purchase-order.json");
    task(ir, "T3").role = "Nobody";
    ir.flows.push({ id: "F99", bit: 3, from: "T1", to: "ghost" });
    const problems = checkStructure(ir);
    expect(problems.some((p) => p.includes("Nobody"))).toBe(true);
    expect(problems.some((p) => p.includes("비트 중복"))).toBe(true);
    expect(problems.some((p) => p.includes("ghost"))).toBe(true);
  });
});
