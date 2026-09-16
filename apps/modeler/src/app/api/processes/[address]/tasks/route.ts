import { coerceArgs, getEngine, handle, json, userHeader } from "@/lib/engine";

export const runtime = "nodejs";

/** POST /api/processes/:address/tasks { instance, task, args } — C3 태스크 완료 (해당 역할 담당자) */
export function POST(req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    const e = await getEngine();
    const user = e.user(userHeader(req));
    const { address } = await ctx.params;
    const p = e.process(address);
    const body = (await req.json()) as { instance: string; task: string; args?: Record<string, unknown>; expire?: boolean };
    // L1 타이머: 기한이 지난 태스크는 누구나 만료 처리할 수 있다 (expire{Fn})
    const fn = body.expire ? `expire${body.task.charAt(0).toUpperCase()}${body.task.slice(1)}` : body.task;
    const args = body.expire ? [] : coerceArgs(p.ir, body.task, body.args ?? {});
    const receipt = await e.send(p, fn, [BigInt(body.instance), ...args], user);
    const ended = receipt.events.find((ev) => ev.name === "InstanceEnded");
    return json({ hash: receipt.hash, gasUsed: receipt.gasUsed, ended: !!ended, completed: ended?.args.completed ?? null });
  });
}
