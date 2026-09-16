/**
 * Phase 1 완료 기준 (가이드 11장): 손으로 그린 BPMN 5개(승인/구매/여행예약/논문심사/공급망)가 모두
 * 파싱 → IR 검증 → soundness → Solidity 생성 → 컴파일을 통과한다. 배포·실행은 codegen/test/scenarios.test.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { generate } from "@blockflow/codegen";
import { checkSoundness, checkStructure } from "@blockflow/validator";
import { lintBpmn, parseBpmn, ParseError } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const EXAMPLES = join(here, "..", "examples");
const schema = JSON.parse(readFileSync(join(ROOT, "packages", "ir", "schema", "bf-ir.schema.json"), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const read = (f: string) => readFileSync(join(EXAMPLES, f), "utf8");
const files = readdirSync(EXAMPLES).filter((f) => f.endsWith(".bpmn")).sort();

describe("BPMN → IR", () => {
  it("손으로 그린 BPMN 5개(승인/구매/여행예약/논문심사/공급망) + L1 예시 2개(결제, 타이머) + 신용 심사 템플릿", () => {
    expect(files).toEqual(["credit-review.bpmn", "expense-approval.bpmn", "invoice-payment.bpmn", "leave-request.bpmn", "paper-review.bpmn", "purchase-order.bpmn", "supply-chain.bpmn", "travel-booking.bpmn"]);
  });

  it("Solidity 예약어(days 등)를 변수 이름으로 쓰면 R12", async () => {
    const xml = read("leave-request.bpmn").replace(/leaveDays/g, "days");
    const d = await lintBpmn(xml);
    expect(d).toContainEqual(expect.objectContaining({ rule: "R12", message: expect.stringContaining("'days'") }));
  });

  for (const f of files) {
    it(`${f}: 규칙 통과 → IR 스키마·구조·soundness 통과 → 커밋된 컨트랙트와 diff 0`, async () => {
      expect(await lintBpmn(read(f))).toEqual([]);
      const { ir, warnings } = await parseBpmn(read(f));
      expect(warnings).toEqual([]);
      expect(validateSchema(ir), JSON.stringify(validateSchema.errors)).toBe(true);
      expect(checkStructure(ir)).toEqual([]);
      expect(checkSoundness(ir).problems).toEqual([]);
      const committed = readFileSync(join(ROOT, "contracts", "src", `${ir.process.id}.sol`), "utf8");
      expect(generate(ir)).toBe(committed);
    });
  }

  it("경비 승인 BPMN 은 부록 B IR 과 같은 구조로 변환된다 (XOR 합류 정규화, 비트 배정)", async () => {
    const { ir } = await parseBpmn(read("expense-approval.bpmn"));
    const appendixB = JSON.parse(readFileSync(join(ROOT, "packages", "ir", "examples", "expense-approval.json"), "utf8"));
    // 파서는 종료 노드 id 를 end_<outcome> 으로 만들고 부록 B 는 end_rej 를 쓴다. id 만 맞추고 bpmnId 는 뺀다.
    const strip = (x: unknown): unknown =>
      JSON.parse(JSON.stringify(x, (k, v) => (k === "bpmnId" ? undefined : v === "end_rejected" ? "end_rej" : v)));
    // 종료 이벤트 라벨은 BPMN 이름에서 오므로(부록 B 에는 없음) 비교에서 뺀다.
    const byId = (xs: { id: string; kind?: string; label?: string }[]) =>
      [...xs].sort((a, b) => a.id.localeCompare(b.id)).map((n) => (n.kind === "endEvent" ? { ...n, label: undefined } : n));
    expect(strip(ir.flows)).toEqual(appendixB.flows);
    // 노드 순서는 다이어그램의 문서 순서를 따르므로 집합으로 비교한다 (생성 코드는 동일).
    expect(byId(strip(ir.nodes) as { id: string }[])).toEqual(byId(appendixB.nodes));
    expect(ir.roles).toEqual(appendixB.roles);
    expect(ir.silent.map((x) => (x === "end_rejected" ? "end_rej" : x)).sort()).toEqual([...appendixB.silent].sort());
    // 다이어그램 매핑
    expect(ir.flows.map((f) => f.bpmnId)).toContain("Flow_11");
    expect(ir.nodes.find((n) => n.id === "A1")?.bpmnId).toBe("Gateway_Fork");
  });
});

describe("규칙 R1~R12 (비전문가용 메시지)", () => {
  const base = read("expense-approval.bpmn");
  const rules = async (xml: string) => (await lintBpmn(xml)).map((d) => d.rule);
  const messages = async (xml: string) => (await lintBpmn(xml)).map((d) => `[${d.rule}] ${d.message}`);

  it("R1 시작 이벤트 2개", async () => {
    const xml = base.replace('<bpmn:startEvent id="StartEvent_1" name="시작">', '<bpmn:startEvent id="StartEvent_0" name="시작2"><bpmn:outgoing>Flow_0</bpmn:outgoing></bpmn:startEvent><bpmn:sequenceFlow id="Flow_0" sourceRef="StartEvent_0" targetRef="Task_Submit"/><bpmn:startEvent id="StartEvent_1" name="시작">')
      .replace('<bpmn:incoming>Flow_1</bpmn:incoming>\n      <bpmn:outgoing>Flow_2</bpmn:outgoing>', '<bpmn:incoming>Flow_1</bpmn:incoming><bpmn:incoming>Flow_0</bpmn:incoming>\n      <bpmn:outgoing>Flow_2</bpmn:outgoing>');
    const m = await messages(xml);
    expect(m).toContain("[R1] 시작점은 하나여야 해요");
    expect(m).toContain("[R3] 태스크에서 갈라지거나 모으려면 마름모(게이트웨이)를 쓰세요");
  });

  it("R4 합류 게이트웨이에 나가는 화살표 없음 / R8 도달 불가", async () => {
    const xml = base.replace(/<bpmn:endEvent id="EndEvent_Done" name="완료">\s*<bpmn:incoming>Flow_10<\/bpmn:incoming>\s*<\/bpmn:endEvent>/, "")
      .replace('<bpmn:sequenceFlow id="Flow_10" sourceRef="Gateway_Sync" targetRef="EndEvent_Done"/>', "")
      .replace("<bpmn:outgoing>Flow_10</bpmn:outgoing>", "")
      .replace("<bpmn:flowNodeRef>EndEvent_Done</bpmn:flowNodeRef>", "");
    const r = await rules(xml);
    expect(r).not.toContain("XML");
    expect(r).toContain("R4"); // Gateway_Sync 가 in 2 / out 0
    expect(r).toContain("R8"); // Gateway_Sync 에서 종료로 갈 수 없음
  });

  it("R2 종료 이벤트 없음", async () => {
    let xml = base;
    for (const [id, flow] of [["EndEvent_Done", "Flow_10"], ["EndEvent_Rejected", "Flow_12"]]) {
      xml = xml.replace(new RegExp(`<bpmn:endEvent id="${id}"[^>]*>\\s*<bpmn:incoming>${flow}</bpmn:incoming>\\s*</bpmn:endEvent>`), "")
        .replace(new RegExp(`<bpmn:sequenceFlow id="${flow}"[^>]*/>`), "")
        .replace(`<bpmn:outgoing>${flow}</bpmn:outgoing>`, "")
        .replace(` default="${flow}"`, "")
        .replace(`<bpmn:flowNodeRef>${id}</bpmn:flowNodeRef>`, "");
    }
    const m = await messages(xml);
    expect(m).not.toContainEqual(expect.stringContaining("[XML]"));
    expect(m).toContain("[R2] 끝나는 지점이 필요해요");
  });

  it("R5 기본 플로우 없음 / 조건 없는 화살표", async () => {
    const xml = base.replace('<bpmn:exclusiveGateway id="Gateway_Amount" name="고액인가?" default="Flow_4">', '<bpmn:exclusiveGateway id="Gateway_Amount" name="고액인가?">');
    const m = await messages(xml);
    expect(m).toContain("[R5] 기본 화살표를 정하세요");
    expect(m).toContain("[R5] 조건이 없는 화살표가 있어요");
  });

  it("R6 AND 분기에 조건", async () => {
    const xml = base.replace('<bpmn:sequenceFlow id="Flow_6" sourceRef="Gateway_Fork" targetRef="Task_Pay"/>',
      '<bpmn:sequenceFlow id="Flow_6" sourceRef="Gateway_Fork" targetRef="Task_Pay"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">approved</bpmn:conditionExpression></bpmn:sequenceFlow>');
    expect(await messages(xml)).toContain("[R6] 동시에 진행하는 화살표엔 조건을 붙일 수 없어요");
  });

  it("R7 레인 밖 태스크", async () => {
    const xml = base.replace("<bpmn:flowNodeRef>Task_Pay</bpmn:flowNodeRef>", "");
    const d = await lintBpmn(xml);
    expect(d).toContainEqual(expect.objectContaining({ rule: "R7", elementId: "Task_Pay", message: "이 일은 누가 하나요? 역할 칸 안으로 옮기세요" }));
  });

  it("R9 선언되지 않은 변수", async () => {
    const xml = base.replace("amount &gt; 1000", "total &gt; 1000");
    expect(await messages(xml)).toContain("[R9] 조건에 쓰인 [total]는 아직 정의되지 않았어요");
  });

  it("R9 타입 오류", async () => {
    const xml = base.replace("amount &gt; 1000", "approved &gt; 1000");
    const d = await lintBpmn(xml);
    expect(d[0]).toMatchObject({ rule: "R9", elementId: "Flow_3" });
  });

  it("R10 입력받기 전에 조건에서 사용", async () => {
    // 승인 여부(approved)를 입력받는 태스크에서 입력을 제거
    const xml = base.replace('<bc:inputs><bc:input variable="approved" label="승인 여부"/></bc:inputs>', "<bc:inputs/>");
    expect(await messages(xml)).toContain("[R10] [approved]을 입력받기 전에 조건에서 쓰고 있어요");
  });

  it("R12 이름 없는 태스크", async () => {
    const xml = base.replace('name="지급" bc:taskId="3"', 'bc:taskId="3"');
    const d = await lintBpmn(xml);
    expect(d).toContainEqual(expect.objectContaining({ rule: "R12", elementId: "Task_Pay", message: "이름을 붙여 주세요" }));
  });

  it("L0 밖 요소 (서비스 태스크, 타이머)", async () => {
    const xml = base.replace('<bpmn:userTask id="Task_Pay" name="지급" bc:taskId="3" bc:fn="pay">', '<bpmn:serviceTask id="Task_Pay" name="지급">').replace(/(<bpmn:userTask id="Task_Pay"[\s\S]*?)<\/bpmn:userTask>/, "$1</bpmn:userTask>");
    const d = await lintBpmn(xml.replace(/<\/bpmn:userTask>(\s*<bpmn:userTask id="Task_Receipt")/, "</bpmn:serviceTask>$1"));
    expect(d.map((x) => x.rule)).toContain("L0");
    expect(d.find((x) => x.rule === "L0")?.message).toMatch(/서비스 태스크/);
  });

  it("parseBpmn 은 ParseError 를 던진다", async () => {
    await expect(parseBpmn(base.replace("amount &gt; 1000", "total &gt; 1000"))).rejects.toBeInstanceOf(ParseError);
  });

  it("깨진 XML", async () => {
    const d = await lintBpmn("<bpmn:definitions");
    expect(d[0]?.rule).toBe("XML");
  });
});
