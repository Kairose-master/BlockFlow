import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generate } from "@blockflow/codegen";
import { ensureLayout, lintBpmn, parseBpmn } from "../src/index";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
const ROOT = join(EXAMPLES, "..", "..", "..");

describe("자동 배치 (DI 생성)", () => {
  for (const f of readdirSync(EXAMPLES).filter((x) => x.endsWith(".bpmn")).sort()) {
    it(`${f}: 풀+레인+노드+엣지 DI 가 생기고 의미는 그대로다`, async () => {
      const xml = readFileSync(join(EXAMPLES, f), "utf8");
      const { xml: out, nodes } = await ensureLayout(xml);
      expect(nodes).toBeGreaterThan(0);
      expect(out).toContain("bpmndi:BPMNDiagram");
      expect(out).toContain("<bpmn:participant");
      expect((out.match(/<bpmndi:BPMNShape /g) ?? []).length).toBeGreaterThanOrEqual(nodes + 1);
      expect(out).toMatch(/bpmnElement="Lane_/);
      expect(await lintBpmn(out)).toEqual([]);
      const { ir } = await parseBpmn(out);
      expect(generate(ir)).toBe(readFileSync(join(ROOT, "contracts", "src", `${ir.process.id}.sol`), "utf8"));
      // 두 번 적용해도 변하지 않는다
      expect((await ensureLayout(out)).xml).toBe(out);
    });
  }
});
