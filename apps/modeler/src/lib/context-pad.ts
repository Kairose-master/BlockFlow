/**
 * 컨텍스트 패드 제한: 연결·삭제·(허용 요소) 이어 붙이기만. 렌치(교체 메뉴)와 create-append-anything 은 뺀다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Entry = Record<string, unknown>;

const APPENDABLE = [
  { type: "bpmn:UserTask", className: "bpmn-icon-user-task", title: "할 일 이어 붙이기" },
  { type: "bpmn:ExclusiveGateway", className: "bpmn-icon-gateway-xor", title: "조건 분기 이어 붙이기" },
  { type: "bpmn:ParallelGateway", className: "bpmn-icon-gateway-parallel", title: "동시 진행 이어 붙이기" },
  { type: "bpmn:EndEvent", className: "bpmn-icon-end-event-none", title: "끝 이어 붙이기" },
];

class BlockFlowContextPadProvider {
  static $inject = ["contextPad", "modeling", "elementFactory", "connect", "create", "autoPlace"];

  constructor(
    contextPad: any,
    private readonly modeling: any,
    private readonly elementFactory: any,
    private readonly connect: any,
    private readonly create: any,
    private readonly autoPlace: any,
  ) {
    contextPad.registerProvider(this);
  }

  getContextPadEntries(element: any): Record<string, Entry> {
    const { modeling, elementFactory, connect, create, autoPlace } = this;
    const type: string = element.type;
    const entries: Record<string, Entry> = {};
    const isLabel = !!element.labelTarget;
    if (isLabel) return entries;

    const remove = { group: "edit", className: "bpmn-icon-trash", title: "삭제", action: { click: () => modeling.removeElements([element]) } };

    if (type === "bpmn:Participant") {
      entries["lane-add"] = { group: "edit", className: "bpmn-icon-lane-insert-below", title: "역할(레인) 추가", action: { click: () => addLane(modeling, element) } };
      return entries;
    }
    if (type === "bpmn:Lane") {
      entries["lane-add"] = { group: "edit", className: "bpmn-icon-lane-insert-below", title: "아래에 역할 추가", action: { click: () => modeling.addLane(element, "bottom") } };
      entries["delete"] = remove;
      return entries;
    }
    if (type === "bpmn:SequenceFlow") {
      entries["delete"] = remove;
      return entries;
    }
    if (type !== "bpmn:EndEvent") {
      for (const a of APPENDABLE) {
        const start = (event: unknown) => create.start(event, elementFactory.createShape({ type: a.type }), { source: element });
        const click = autoPlace
          ? () => autoPlace.append(element, elementFactory.createShape({ type: a.type }))
          : start;
        entries[`append.${a.type}`] = { group: "model", className: a.className, title: a.title, action: { click, dragstart: start } };
      }
      entries["connect"] = {
        group: "connect", className: "bpmn-icon-connection-multi", title: "화살표 연결",
        action: { click: (e: unknown) => connect.start(e, element), dragstart: (e: unknown) => connect.start(e, element) },
      };
    }
    entries["delete"] = remove;
    return entries;
  }
}

/** 풀에 레인 추가: 레인이 없으면 하나로 쪼개고, 있으면 마지막 레인 아래에 붙인다. */
export function addLane(modeling: any, participant: any): any {
  const lanes = (participant.children ?? []).filter((c: any) => c.type === "bpmn:Lane");
  if (!lanes.length) return modeling.splitLane(participant, 1)?.[0];
  const last = lanes.reduce((a: any, b: any) => (b.y > a.y ? b : a));
  return modeling.addLane(last, "bottom");
}

const contextPadModule = {
  __init__: ["contextPadProvider"],
  contextPadProvider: ["type", BlockFlowContextPadProvider],
};
export default contextPadModule;
