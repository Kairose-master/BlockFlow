/**
 * layout.ts — DI(다이어그램 좌표) 가 없는 BPMN 에 레인을 존중하는 자동 배치를 붙인다.
 *
 * 손으로 쓴 예시 BPMN 은 의미 요소만 있고 좌표가 없다. 모델러(bpmn-js)는 좌표가 있어야 그리므로
 *   - 프로세스를 협업(풀 1개) 으로 감싸고 (bpmn-js 가 레인을 풀 안에 그린다, D4 단일 풀 + 레인)
 *   - 노드 x = 시작에서의 최장 경로 층(layer), y = 레인 행 안의 슬롯
 *   - 플로우는 직교 꺾임 1번
 * 으로 배치한 XML 을 돌려준다. L0 는 루프가 없으므로 층 계산이 끝난다.
 */
import type { ModdleElement } from "bpmn-moddle";
import { createModdle } from "./parse";

const NODE_W: Record<string, number> = { "bpmn:StartEvent": 36, "bpmn:EndEvent": 36, "bpmn:UserTask": 100, "bpmn:ServiceTask": 100, "bpmn:ExclusiveGateway": 50, "bpmn:ParallelGateway": 50, "bpmn:BoundaryEvent": 36 };
const NODE_H: Record<string, number> = { "bpmn:StartEvent": 36, "bpmn:EndEvent": 36, "bpmn:UserTask": 80, "bpmn:ServiceTask": 80, "bpmn:ExclusiveGateway": 50, "bpmn:ParallelGateway": 50, "bpmn:BoundaryEvent": 36 };
const COL = 170; // 층 간격
const ROW = 110; // 슬롯 간격
const LANE_PAD = 20;
const POOL_X = 160;
const POOL_Y = 80;
const LANE_HEADER = 30; // 풀 헤더 폭

function arr(x: unknown): ModdleElement[] {
  return Array.isArray(x) ? (x as ModdleElement[]) : [];
}

export interface LayoutResult {
  xml: string;
  /** 배치한 노드 수 */
  nodes: number;
}

/** DI 가 이미 있으면 그대로 돌려준다. */
export async function ensureLayout(xml: string): Promise<LayoutResult> {
  const moddle = createModdle();
  const { rootElement: defs } = await moddle.fromXML(xml);
  const roots = arr(defs.rootElements);
  if (arr(defs.diagrams).length) return { xml, nodes: 0 };

  const process = roots.find((r) => r.$type === "bpmn:Process");
  if (!process) throw new Error("프로세스가 없습니다");

  // 협업(풀) 으로 감싸기
  let collaboration = roots.find((r) => r.$type === "bpmn:Collaboration");
  let participant: ModdleElement;
  if (!collaboration) {
    participant = moddle.create("bpmn:Participant", { id: `Participant_${process.id}`, name: process.name ?? "", processRef: process });
    collaboration = moddle.create("bpmn:Collaboration", { id: `Collaboration_${process.id}`, participants: [participant] });
    (defs.rootElements as ModdleElement[]).unshift(collaboration);
  } else {
    participant = arr(collaboration.participants)[0]!;
  }

  const boundaries = arr(process.flowElements).filter((e) => e.$type === "bpmn:BoundaryEvent");
  const nodes = arr(process.flowElements).filter((e) => e.$type !== "bpmn:SequenceFlow" && e.$type !== "bpmn:BoundaryEvent");
  const flows = arr(process.flowElements).filter((e) => e.$type === "bpmn:SequenceFlow");
  const lanes = arr(process.laneSets).flatMap((ls) => arr(ls.lanes));
  const laneOf = new Map<string, number>();
  lanes.forEach((lane, i) => arr(lane.flowNodeRef).forEach((n) => laneOf.set(n.id!, i)));

  // 층: 시작에서의 최장 경로 (DAG 가정, 안전장치로 반복 상한)
  const succ = new Map<string, string[]>();
  for (const f of flows) {
    const s = (f.sourceRef as ModdleElement).id!;
    const t = (f.targetRef as ModdleElement).id!;
    succ.set(s, [...(succ.get(s) ?? []), t]);
  }
  // 경계 이벤트의 나가는 플로우는 붙은 태스크에서 나가는 것으로 본다
  for (const b of boundaries) {
    const host = (b.attachedToRef as ModdleElement | undefined)?.id;
    if (host) for (const t of arr(b.outgoing).map((f) => (f.targetRef as ModdleElement).id!)) succ.set(host, [...(succ.get(host) ?? []), t]);
  }
  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n.id!, 0);
  for (let iter = 0; iter < nodes.length + 1; iter++) {
    let changed = false;
    for (const n of nodes) {
      for (const t of succ.get(n.id!) ?? []) {
        if ((layer.get(t) ?? 0) < (layer.get(n.id!) ?? 0) + 1) {
          layer.set(t, (layer.get(n.id!) ?? 0) + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 레인별·층별 슬롯
  const laneCount = Math.max(1, lanes.length);
  const slots = new Map<string, number>(); // nodeId → slot (레인 안 행)
  const laneRows: number[] = new Array(laneCount).fill(1);
  for (let li = 0; li < laneCount; li++) {
    const perLayer = new Map<number, number>();
    for (const n of nodes) {
      if ((laneOf.get(n.id!) ?? 0) !== li) continue;
      const l = layer.get(n.id!) ?? 0;
      const slot = perLayer.get(l) ?? 0;
      slots.set(n.id!, slot);
      perLayer.set(l, slot + 1);
      laneRows[li] = Math.max(laneRows[li]!, slot + 1);
    }
  }
  const laneHeights = laneRows.map((rows) => rows * ROW + LANE_PAD);
  const laneTops: number[] = [];
  let acc = POOL_Y;
  for (const h of laneHeights) {
    laneTops.push(acc);
    acc += h;
  }
  const maxLayer = Math.max(0, ...nodes.map((n) => layer.get(n.id!) ?? 0));
  const poolW = LANE_HEADER + (maxLayer + 1) * COL + 60;
  const poolH = laneHeights.reduce((a, b) => a + b, 0);

  const bounds = (x: number, y: number, w: number, h: number) => moddle.create("dc:Bounds", { x, y, width: w, height: h });
  const shape = (el: ModdleElement, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) =>
    moddle.create("bpmndi:BPMNShape", { id: `${el.id}_di`, bpmnElement: el, bounds: bounds(x, y, w, h), ...extra });

  const planeElements: unknown[] = [];
  planeElements.push(shape(participant, POOL_X, POOL_Y, poolW, poolH, { isHorizontal: true }));
  lanes.forEach((lane, i) => planeElements.push(shape(lane, POOL_X + LANE_HEADER, laneTops[i]!, poolW - LANE_HEADER, laneHeights[i]!, { isHorizontal: true })));

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of nodes) {
    const li = laneOf.get(n.id!) ?? 0;
    const w = NODE_W[n.$type] ?? 100;
    const h = NODE_H[n.$type] ?? 80;
    const cx = POOL_X + LANE_HEADER + 40 + (layer.get(n.id!) ?? 0) * COL + 50;
    const cy = laneTops[li]! + LANE_PAD / 2 + (slots.get(n.id!) ?? 0) * ROW + ROW / 2;
    const p = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
    pos.set(n.id!, p);
    const label = n.$type.endsWith("Event") || n.$type.endsWith("Gateway")
      ? { label: moddle.create("bpmndi:BPMNLabel", { bounds: bounds(p.x - 20, p.y + h + 4, w + 40, 14) }) }
      : {};
    planeElements.push(shape(n, p.x, p.y, w, h, label));
  }
  // 경계 이벤트: 붙은 태스크의 오른쪽 아래 모서리
  for (const b of boundaries) {
    const host = pos.get((b.attachedToRef as ModdleElement).id!);
    if (!host) continue;
    const p = { x: host.x + host.w - 30, y: host.y + host.h - 18, w: 36, h: 36 };
    pos.set(b.id!, p);
    planeElements.push(shape(b, p.x, p.y, p.w, p.h, { label: moddle.create("bpmndi:BPMNLabel", { bounds: bounds(p.x - 10, p.y + 40, 56, 14) }) }));
  }
  for (const f of flows) {
    const s = pos.get((f.sourceRef as ModdleElement).id!)!;
    const t = pos.get((f.targetRef as ModdleElement).id!)!;
    const isBoundary = boundaries.some((b) => b.id === (f.sourceRef as ModdleElement).id);
    const sx = isBoundary ? s.x + s.w / 2 : s.x + s.w, sy = isBoundary ? s.y + s.h : s.y + s.h / 2;
    const tx = t.x, ty = t.y + t.h / 2;
    const midX = Math.round((sx + tx) / 2);
    const pts = isBoundary
      ? [[sx, sy], [sx, ty], [tx, ty]]
      : sy === ty ? [[sx, sy], [tx, ty]] : tx > sx ? [[sx, sy], [midX, sy], [midX, ty], [tx, ty]] : [[sx, sy], [sx + 20, sy], [sx + 20, ty], [tx, ty]];
    planeElements.push(
      moddle.create("bpmndi:BPMNEdge", { id: `${f.id}_di`, bpmnElement: f, waypoint: pts.map(([x, y]) => moddle.create("dc:Point", { x, y })) }),
    );
  }
  const plane = moddle.create("bpmndi:BPMNPlane", { id: `Plane_${process.id}`, bpmnElement: collaboration, planeElement: planeElements });
  const diagram = moddle.create("bpmndi:BPMNDiagram", { id: `Diagram_${process.id}`, plane });
  defs.diagrams = [diagram];
  const { xml: out } = await moddle.toXML(defs, { format: true });
  return { xml: out, nodes: nodes.length + boundaries.length };
}
