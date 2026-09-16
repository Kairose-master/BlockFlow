/* eslint-disable @typescript-eslint/no-explicit-any */
/** bpmn-js 요소/비즈니스 객체를 다루는 얇은 헬퍼. 속성 패널과 툴바가 같이 쓴다. */

export type Modeler = {
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  get<T = any>(name: string): T;
  on(event: string, cb: (e: any) => void): void;
  destroy(): void;
};

export type Shape = any;

/** 다이어그램의 프로세스 비즈니스 객체 (풀이 있으면 participant.processRef). */
export function getProcess(modeler: Modeler): { process: any; participant: Shape | undefined } {
  const canvas = modeler.get("canvas");
  const root = canvas.getRootElement();
  const bo = root.businessObject;
  if (bo.$type === "bpmn:Process") return { process: bo, participant: undefined };
  const registry = modeler.get("elementRegistry");
  const participant = registry.filter((e: any) => e.type === "bpmn:Participant")[0];
  return { process: participant?.businessObject?.processRef, participant };
}

/** extensionElements 안에서 주어진 타입의 첫 요소 */
export function getExt(bo: any, type: string): any | undefined {
  return (bo.extensionElements?.values ?? []).find((v: any) => v.$type === type);
}

/** 프로세스 변수 목록 */
export function getVariables(process: any): { name: string; type: string }[] {
  return (getExt(process, "bc:Variables")?.values ?? []).map((v: any) => ({ name: v.name ?? "", type: v.type ?? "uint256" }));
}

/** 태스크 입력 목록 */
export function getInputs(task: any): { variable: string; label: string }[] {
  return (getExt(task, "bc:Inputs")?.values ?? []).map((v: any) => ({ variable: v.variable ?? "", label: v.label ?? "" }));
}

/**
 * extensionElements 의 한 컨테이너(bc:Variables / bc:Inputs)를 통째로 바꾼다.
 * shape 가 있으면 modeling.updateModdleProperties 로 undo 가능하게, 없으면 직접 set.
 */
export function setExtList(modeler: Modeler, shape: Shape | undefined, bo: any, containerType: string, itemType: string, items: Record<string, unknown>[]) {
  const moddle = modeler.get("moddle");
  const modeling = modeler.get("modeling");
  const container = moddle.create(containerType, { values: items.map((it) => moddle.create(itemType, it)) });
  const others = (bo.extensionElements?.values ?? []).filter((v: any) => v.$type !== containerType);
  const extensionElements = moddle.create("bpmn:ExtensionElements", { values: [...others, container] });
  if (shape) modeling.updateModdleProperties(shape, bo, { extensionElements });
  else {
    bo.extensionElements = extensionElements;
    extensionElements.$parent = bo;
  }
}

export function setProps(modeler: Modeler, shape: Shape, props: Record<string, unknown>) {
  modeler.get("modeling").updateProperties(shape, props);
}

export function setBoProps(modeler: Modeler, shape: Shape, bo: any, props: Record<string, unknown>) {
  modeler.get("modeling").updateModdleProperties(shape, bo, props);
}

/** XOR 분기 게이트웨이인가 (out ≥ 2) */
export function isXorSplit(shape: Shape): boolean {
  return shape?.type === "bpmn:ExclusiveGateway" && (shape.outgoing?.length ?? 0) >= 2;
}

export function download(name: string, text: string, mime = "application/xml") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
