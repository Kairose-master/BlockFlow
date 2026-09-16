/**
 * soundness.ts — V2 Soundness 검사 (가이드 7.2).
 *
 * 1-safe 워크플로우 넷 + 비트맵이므로 상태 = (marking: bigint, ended: boolean).
 * 조건식은 비결정적 선택으로 추상화한다 (XOR 분기는 모든 가지를 탐색).
 *
 * 전이 규칙은 생성 컨트랙트의 _fire/_step 과 같다:
 *   userTask   : in 중 하나라도 있으면 소비, out 생산 (XOR 합류 정규화)
 *   xorSplit   : in 소비, 가지 중 하나 생산
 *   andSplit   : in 중 하나라도 있으면 전부 소비, out 전부 생산
 *   andJoin    : in 전부 있어야 소비, out 생산
 *   endEvent   : in 소비, ended = true
 *
 * 검사:
 *   - 1-safe 위반: 생산하려는 플로우에 이미 토큰이 있음
 *   - 데드락: ended 가 아닌데 활성 전이가 없음 (marking ≠ 0 인데 못 나아감)
 *   - proper completion: ended 인데 marking ≠ 0 ("남은 토큰")
 *   - dead transition: 어떤 도달 marking 에서도 활성화되지 않는 노드
 */
import { type IR, type Node, maskOf, nodesOfKind, outFlows } from "@blockflow/ir";

export interface Problem {
  kind: "unsafe" | "deadlock" | "leftover" | "dead";
  message: string;
  marking?: bigint;
  node?: string;
}

export interface SoundnessResult {
  ok: boolean;
  problems: Problem[];
  /** 도달한 (marking, ended) 상태 수. */
  states: number;
  /** 시작 marking 에서 각 도달 marking 으로 가는 전이 경로 (시나리오 테스트 생성용). */
  paths: Map<string, string[]>;
}

interface Transition {
  node: string;
  /** 소비 마스크 후보들 (userTask/andSplit 은 in 마다 하나, andJoin 은 전체 하나). */
  consume: bigint;
  /** 활성 조건: consume 의 전부가 필요한지(andJoin) 아닌지. */
  needAll: boolean;
  /** 생산 마스크 (xorSplit 은 가지마다 별도 Transition). */
  produce: bigint;
  ends: boolean;
  label: string;
}

function transitions(ir: IR): Transition[] {
  const ts: Transition[] = [];
  const add = (node: Node, consumeIds: string[], needAll: boolean, produceIds: string[], ends: boolean, label: string) =>
    ts.push({ node: node.id, consume: maskOf(ir, consumeIds), needAll, produce: maskOf(ir, produceIds), ends, label });

  for (const n of ir.nodes) {
    switch (n.kind) {
      case "startEvent":
        break;
      case "userTask":
        // 컨트랙트는 in 마스크 전체를 소비하지만 1-safe 에서는 하나만 있으므로 동일.
        for (const f of n.in) add(n, [f], false, n.out, false, `${n.id}(${f})`);
        // 타이머 만료: 같은 토큰을 만료 경로로 (시간은 비결정적 선택으로 추상화)
        if (n.timer) for (const f of n.in) add(n, [f], false, [n.timer.out], false, `${n.id}⏰(${f})`);
        break;
      case "xorSplit":
        for (const f of outFlows(n)) add(n, n.in, false, [f], false, `${n.id}→${f}`);
        break;
      case "andSplit":
        for (const f of n.in) add(n, [f], false, n.out, false, `${n.id}(${f})`);
        break;
      case "andJoin":
        add(n, n.in, true, n.out, false, n.id);
        break;
      case "endEvent":
        for (const f of n.in) add(n, [f], false, [], true, `${n.id}(${f})`);
        break;
    }
  }
  return ts;
}

function enabled(t: Transition, m: bigint): boolean {
  return t.needAll ? (m & t.consume) === t.consume : (m & t.consume) !== 0n;
}

export function checkSoundness(ir: IR): SoundnessResult {
  const problems: Problem[] = [];
  const ts = transitions(ir);
  const start = nodesOfKind(ir, "startEvent")[0];
  if (!start) return { ok: false, problems: [{ kind: "deadlock", message: "시작 이벤트가 없습니다" }], states: 0, paths: new Map() };

  const m0 = maskOf(ir, outFlows(start));
  const key = (m: bigint, ended: boolean) => `${m.toString(2)}${ended ? "E" : ""}`;
  const visited = new Map<string, { m: bigint; ended: boolean; path: string[] }>();
  const queue: { m: bigint; ended: boolean; path: string[] }[] = [{ m: m0, ended: false, path: [] }];
  visited.set(key(m0, false), queue[0]!);
  const fired = new Set<string>();
  const seenProblem = new Set<string>();
  const report = (p: Problem) => {
    const k = `${p.kind}|${p.node ?? ""}|${p.marking ?? ""}`;
    if (!seenProblem.has(k)) {
      seenProblem.add(k);
      problems.push(p);
    }
  };

  while (queue.length) {
    const s = queue.shift()!;
    // 컨트랙트 의미론: ended 이후에는 태스크가 거부되지만 _step 은 남은 토큰을 계속 돌린다.
    // 검사에서는 ended 상태에서 marking ≠ 0 이면 곧바로 "남은 토큰" 으로 본다.
    if (s.ended) {
      if (s.m !== 0n) report({ kind: "leftover", message: `종료 후 토큰이 남음 (marking=${s.m.toString(2)}), 경로: ${s.path.join(" → ")}`, marking: s.m });
      continue;
    }
    let any = false;
    for (const t of ts) {
      if (!enabled(t, s.m)) continue;
      any = true;
      fired.add(t.node);
      const after = s.m & ~t.consume;
      if ((after & t.produce) !== 0n) {
        report({ kind: "unsafe", message: `1-safe 위반: ${t.label} 가 이미 토큰이 있는 플로우에 생산 (marking=${s.m.toString(2)})`, marking: s.m, node: t.node });
      }
      const next = after | t.produce;
      const nextEnded = t.ends;
      const k = key(next, nextEnded);
      if (!visited.has(k)) {
        const st = { m: next, ended: nextEnded, path: [...s.path, t.label] };
        visited.set(k, st);
        queue.push(st);
      }
    }
    if (!any && s.m !== 0n) {
      report({ kind: "deadlock", message: `데드락: marking=${s.m.toString(2)} 에서 활성 전이 없음, 경로: ${s.path.join(" → ")}`, marking: s.m });
    }
  }

  for (const n of ir.nodes) {
    if (n.kind === "startEvent") continue;
    if (!fired.has(n.id)) report({ kind: "dead", message: `도달 불가 노드: ${n.id} (${n.kind})`, node: n.id });
  }

  const paths = new Map<string, string[]>();
  for (const [k, v] of visited) paths.set(k, v.path);
  return { ok: problems.length === 0, problems, states: visited.size, paths };
}
