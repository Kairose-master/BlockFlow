import { coerceArgs, getEngine, handle, json, userHeader } from "@/lib/engine";

export const runtime = "nodejs";

/** POST /api/processes/:address/tasks { instance, task, args } — C3 태스크 완료 (해당 역할 담당자) */
export function POST(req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    const e = await getEngine();
    const user = e.user(userHeader(req));
    const { address } = await ctx.params;
    const p = e.process(address);
    const body = (await req.json()) as { instance: string; task: string; args?: Record<string, unknown> };
    const args = coerceArgs(p.ir, body.task, body.args ?? {});
    const receipt = await e.send(p, body.task, [BigInt(body.instance), ...args], user);
    const ended = receipt.events.find((ev) => ev.name === "InstanceEnded");
    return json({ hash: receipt.hash, gasUsed: receipt.gasUsed, ended: !!ended, completed: ended?.args.completed ?? null });
  });
}
