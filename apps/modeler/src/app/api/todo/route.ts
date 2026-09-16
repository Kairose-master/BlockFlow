import { getEngine, handle, json, userHeader } from "@/lib/engine";

export const runtime = "nodejs";

/** GET /api/todo → 현재 사용자가 담당자인 인스턴스의 활성 태스크 카드 */
export function GET(req: Request) {
  return handle(async () => {
    const e = await getEngine();
    const user = e.user(userHeader(req));
    const cards: unknown[] = [];
    for (const p of e.processes.values()) {
      const rec = e.indexer.processes.get(p.address);
      if (!rec || rec.paused) continue;
      for (const inst of rec.instances.values()) {
        if (inst.ended) continue;
        for (const t of e.indexer.enabledTasks(rec, inst)) {
          const assignee = t.service ? e.oracle.address : (inst.roles[t.role] ?? "");
          if (assignee.toLowerCase() !== user.address.toLowerCase()) continue;
          const task = p.ir.nodes.find((n) => (n.kind === "userTask" || n.kind === "serviceTask") && n.id === t.id);
          const inputs = task?.kind === "userTask" || task?.kind === "serviceTask" ? task.inputs.map((i) => ({ ...i, type: p.ir.variables.find((v) => v.name === i.variable)?.type ?? "uint256" })) : [];
          const roleLabel = t.service ? "외부 서비스 (오라클)" : (p.ir.roles.find((r) => r.key === t.role)?.label ?? t.role);
          cards.push({ process: { address: p.address, name: p.ir.process.name, id: p.ir.process.id }, instance: inst.id, task: { ...t, roleLabel, inputs } });
        }
      }
    }
    return json(cards);
  });
}
