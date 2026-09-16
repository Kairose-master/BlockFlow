import { compileBpmn } from "@/lib/compile";
import { ApiError, getEngine, handle, json, userHeader } from "@/lib/engine";

export const runtime = "nodejs";

/** GET /api/processes → 프로세스 카드 목록 */
export function GET() {
  return handle(async () => {
    const e = await getEngine();
    const list = [...e.processes.values()].map((p) => {
      const rec = e.indexer.processes.get(p.address);
      const instances = rec ? [...rec.instances.values()] : [];
      return {
        address: p.address, id: p.ir.process.id, name: p.ir.process.name, roles: p.ir.roles, owner: p.owner, deployedAt: p.deployedAt,
        paused: rec?.paused ?? false, instanceCount: instances.length, active: instances.filter((i) => !i.ended).length,
        version: p.version, supersededBy: p.supersededBy ?? null,
      };
    });
    return json(list.sort((a, b) => b.deployedAt - a.deployedAt));
  });
}

/** POST /api/processes { xml } — C1 배포 (소유자) */
export function POST(req: Request) {
  return handle(async () => {
    const e = await getEngine();
    const owner = e.requireOwner(userHeader(req));
    const { xml } = (await req.json()) as { xml?: string };
    if (typeof xml !== "string") throw new ApiError(400, "xml 이 없습니다");
    const c = await compileBpmn(xml);
    if (!c.ok) return json(c, { status: 400 });
    const rec = await e.deploy(xml, { name: c.ir.process.id, abi: c.abi, bytecode: c.bytecode }, c.ir, owner);
    return json({ address: rec.address, id: rec.ir.process.id, name: rec.ir.process.name, version: rec.version });
  });
}
