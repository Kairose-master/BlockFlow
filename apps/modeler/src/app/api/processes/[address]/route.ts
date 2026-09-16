import { getEngine, handle, json } from "@/lib/engine";

export const runtime = "nodejs";

/** GET /api/processes/:address → 보드 데이터 (IR, XML, 인스턴스 + 활성 태스크, 타임라인) */
export function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    const e = await getEngine();
    const { address } = await ctx.params;
    const p = e.process(address);
    const rec = e.indexer.processes.get(p.address);
    const instances = rec
      ? [...rec.instances.values()].sort((a, b) => Number(b.id - a.id)).map((i) => ({ ...i, enabled: e.indexer.enabledTasks(rec, i) }))
      : [];
    return json({
      address: p.address, xml: p.xml, ir: p.ir, owner: p.owner, paused: rec?.paused ?? false, mode: e.mode,
      instances, timeline: rec?.timeline.slice().reverse() ?? [],
    });
  });
}
