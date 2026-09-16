import { getEngine, handle, json } from "@/lib/engine";

export const runtime = "nodejs";

/** GET /api/history → 모든 프로세스의 타임라인 (최근순) */
export function GET() {
  return handle(async () => {
    const e = await getEngine();
    const entries: unknown[] = [];
    for (const p of e.processes.values()) {
      const rec = e.indexer.processes.get(p.address);
      if (!rec) continue;
      for (const t of rec.timeline) {
        if (t.kind === "markingChanged" || t.kind === "roleBound") continue;
        const actor = t.actor ? e.users.find((u) => u.address.toLowerCase() === t.actor!.toLowerCase())?.label ?? t.actor : undefined;
        entries.push({ ...t, actorLabel: actor, process: { address: p.address, name: p.ir.process.name } });
      }
    }
    entries.sort((a, b) => {
      const x = a as { block: bigint; seq: number }, y = b as { block: bigint; seq: number };
      return x.block === y.block ? y.seq - x.seq : Number(y.block - x.block);
    });
    return json(entries.slice(0, 500));
  });
}
