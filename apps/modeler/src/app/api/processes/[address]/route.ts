import { getEngine, handle, json } from "@/lib/engine";

export const runtime = "nodejs";

/** GET /api/processes/:address → 보드 데이터 (IR, XML, 인스턴스 + 활성 태스크, 타임라인) */
export function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    const e = await getEngine();
    const { address } = await ctx.params;
    const p = e.process(address);
    const rec = e.indexer.processes.get(p.address);
    const now = e.now();
    const instances = rec
      ? await Promise.all([...rec.instances.values()].sort((a, b) => Number(b.id - a.id)).map(async (i) => {
          const enabled = e.indexer.enabledTasks(rec, i);
          // L1 타이머: 활성 태스크에 기한이 있으면 startedAt + 기한 을 읽어 만료 시각을 계산
          const timers: Record<string, { expiresAt: number }> = {};
          for (const t of enabled) {
            const node = p.ir.nodes.find((n) => (n.kind === "userTask" || n.kind === "serviceTask") && n.id === t.id);
            if ((node?.kind !== "userTask" && node?.kind !== "serviceTask") || !node.timer) continue;
            const startedAt = Number((await e.adapter.read(p.address, p.abi, "startedAt", [i.id, t.taskId])) as bigint);
            const d = node.timer.deadline;
            const deadline = "seconds" in d ? d.seconds : Number(((await e.adapter.read(p.address, p.abi, "vars", [i.id])) as unknown[])[p.ir.variables.findIndex((v) => v.name === d.var)] as bigint);
            timers[t.id] = { expiresAt: startedAt + deadline };
          }
          return { ...i, enabled, timers };
        }))
      : [];
    return json({
      address: p.address, xml: p.xml, ir: p.ir, owner: p.owner, paused: rec?.paused ?? false, mode: e.mode,
      version: p.version, supersededBy: p.supersededBy ?? null, now, oracle: e.oracle.address,
      instances, timeline: rec?.timeline.slice().reverse() ?? [],
    });
  });
}
