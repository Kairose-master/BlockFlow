import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { IR_VERSION, type IR, maskOf, userTasks } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, "..", "schema", "bf-ir.schema.json"), "utf8"));
const examplesDir = join(here, "..", "examples");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

function load(file: string): IR {
  return JSON.parse(readFileSync(join(examplesDir, file), "utf8")) as IR;
}

describe("bf-ir/0.1 JSON Schema", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".json")).sort();

  it("예시가 3개 이상 있다 (Phase 0 완료 기준)", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const f of files) {
    it(`${f} 가 스키마에 맞는다`, () => {
      const ok = validate(load(f));
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });
  }

  it("버전이 다르면 거부한다", () => {
    const ir = load("expense-approval.json");
    expect(validate({ ...ir, version: "bf-ir/0.2" })).toBe(false);
  });

  it("cond 와 default 를 같이 가진 플로우를 거부한다", () => {
    const ir = load("expense-approval.json");
    const flows = ir.flows.map((x) => (x.id === "F3" ? { ...x, default: true } : x));
    expect(validate({ ...ir, flows })).toBe(false);
  });

  it("알 수 없는 노드 kind 를 거부한다", () => {
    const ir = load("expense-approval.json");
    const nodes = ir.nodes.map((n) => (n.id === "A1" ? { ...n, kind: "orSplit" } : n));
    expect(validate({ ...ir, nodes })).toBe(false);
  });

  it("헬퍼", () => {
    const ir = load("expense-approval.json");
    expect(ir.version).toBe(IR_VERSION);
    expect(userTasks(ir).map((t) => t.name)).toEqual(["submit", "approve", "pay", "uploadReceipt"]);
    expect(maskOf(ir, ["F4", "F11"])).toBe((1n << 3n) | (1n << 10n));
  });
});
