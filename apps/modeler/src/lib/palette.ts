/**
 * 팔레트 제한 (가이드 4.2): 손 도구, 선택, 시작 이벤트, 종료 이벤트, 사용자 태스크, XOR, AND 만 남긴다.
 * 기본 PaletteProvider 를 같은 서비스 이름(paletteProvider)으로 덮어쓴다. 레인은 툴바의 "역할 추가" 로만.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Entry = Record<string, unknown>;

class BlockFlowPaletteProvider {
  static $inject = ["palette", "create", "elementFactory", "handTool", "lassoTool"];

  constructor(
    palette: any,
    private readonly create: any,
    private readonly elementFactory: any,
    private readonly handTool: any,
    private readonly lassoTool: any,
  ) {
    palette.registerProvider(this);
  }

  getPaletteEntries(): Record<string, Entry> {
    const { create, elementFactory, handTool, lassoTool } = this;
    const createAction = (type: string, group: string, className: string, title: string) => {
      const listener = (event: unknown) => create.start(event, elementFactory.createShape({ type }));
      return { group, className, title, action: { dragstart: listener, click: listener } };
    };
    return {
      "hand-tool": { group: "tools", className: "bpmn-icon-hand-tool", title: "화면 이동", action: { click: (e: unknown) => handTool.activateHand(e) } },
      "lasso-tool": { group: "tools", className: "bpmn-icon-lasso-tool", title: "여러 개 선택", action: { click: (e: unknown) => lassoTool.activateSelection(e) } },
      "tool-separator": { group: "tools", separator: true },
      "create.start-event": createAction("bpmn:StartEvent", "event", "bpmn-icon-start-event-none", "시작"),
      "create.end-event": createAction("bpmn:EndEvent", "event", "bpmn-icon-end-event-none", "끝"),
      "create.user-task": createAction("bpmn:UserTask", "activity", "bpmn-icon-user-task", "할 일 (사용자 태스크)"),
      "create.service-task": createAction("bpmn:ServiceTask", "activity", "bpmn-icon-service-task", "외부 서비스 (오라클이 값을 돌려줌)"),
      "create.exclusive-gateway": createAction("bpmn:ExclusiveGateway", "gateway", "bpmn-icon-gateway-xor", "조건에 따라 갈라짐 (XOR)"),
      "create.parallel-gateway": createAction("bpmn:ParallelGateway", "gateway", "bpmn-icon-gateway-parallel", "동시에 진행 (AND)"),
      "create.timer-boundary": {
        group: "event", className: "bpmn-icon-intermediate-event-catch-timer", title: "기한 (할 일 위에 놓으세요)",
        action: {
          click: (event: unknown) => create.start(event, elementFactory.createShape({ type: "bpmn:BoundaryEvent", eventDefinitionType: "bpmn:TimerEventDefinition" })),
          dragstart: (event: unknown) => create.start(event, elementFactory.createShape({ type: "bpmn:BoundaryEvent", eventDefinitionType: "bpmn:TimerEventDefinition" })),
        },
      },
    };
  }
}

export const ALLOWED_PALETTE_ENTRIES = 10;

const paletteModule = {
  __init__: ["paletteProvider"],
  paletteProvider: ["type", BlockFlowPaletteProvider],
};
export default paletteModule;
