import { ApiError, getEngine, handle, json, userHeader } from "@/lib/engine";

export const runtime = "nodejs";

/** POST /api/processes/:address/instances { roles: { [roleKey]: address } } — C2 인스턴스 생성 + 역할 배정 */
export function POST(req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    const e = await getEngine();
    const user = e.user(userHeader(req));
    const { address } = await ctx.params;
    const p = e.process(address);
    const { roles } = (await req.json()) as { roles?: Record<string, string> };
    const accounts = p.ir.roles.map((r) => {
      const a = roles?.[r.key];
      if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new ApiError(400, `[${r.label}] 담당자를 지정하세요`);
      return a;
    });
    const receipt = await e.send(p, "createInstance", [accounts], user);
    const created = receipt.events.find((ev) => ev.name === "InstanceCreated");
    return json({ instance: created?.args.id, hash: receipt.hash, gasUsed: receipt.gasUsed });
  });
}
