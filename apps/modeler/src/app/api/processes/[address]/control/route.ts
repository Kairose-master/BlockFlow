import { roleHash } from "@blockflow/runtime";
import { ApiError, getEngine, handle, json, userHeader } from "@/lib/engine";

export const runtime = "nodejs";

/** POST /api/processes/:address/control — C4 담당자 교체 { action:"rebind", instance, role, account } / C5 일시정지 { action:"pause", paused } (소유자) */
export function POST(req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    const e = await getEngine();
    const owner = e.requireOwner(userHeader(req));
    const { address } = await ctx.params;
    const p = e.process(address);
    const body = (await req.json()) as { action: string; instance?: string; role?: string; account?: string; paused?: boolean };
    if (body.action === "pause") {
      const receipt = await e.send(p, "setPaused", [!!body.paused], owner);
      return json({ hash: receipt.hash });
    }
    if (body.action === "rebind") {
      if (!body.instance || !body.role || !body.account) throw new ApiError(400, "instance, role, account 가 필요해요");
      if (!p.ir.roles.some((r) => r.key === body.role)) throw new ApiError(400, "없는 역할이에요");
      const receipt = await e.send(p, "rebindRole", [BigInt(body.instance), roleHash(body.role), body.account], owner);
      return json({ hash: receipt.hash });
    }
    if (body.action === "skipTime") {
      return json({ now: e.skipTime(Number((body as { seconds?: number }).seconds ?? 0)) });
    }
    throw new ApiError(400, "알 수 없는 동작");
  });
}
