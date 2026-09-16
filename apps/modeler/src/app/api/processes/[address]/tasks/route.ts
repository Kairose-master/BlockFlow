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
    // L1 결제 태스크: 담당자가 approve 를 몰라도 되게, 필요하면 지출 승인을 먼저 보낸다 (8.4 "가스·함수 어휘 감추기")
    let paid: { amount: string; to: string; token: string; approved: boolean } | undefined;
    const task = p.ir.nodes.find((n) => n.kind === "userTask" && n.name === body.task);
    if (!body.expire && task?.kind === "userTask" && task.payment) {
      const idx = p.ir.variables.findIndex((v) => v.name === task.payment!.amountVar);
      const inputIdx = task.inputs.findIndex((i) => i.variable === task.payment!.amountVar);
      const amount = inputIdx >= 0 ? (args[inputIdx] as bigint) : (((await e.adapter.read(p.address, p.abi, "vars", [BigInt(body.instance)])) as unknown[])[idx] as bigint);
      const approved = await e.ensureAllowance(task.payment.token as `0x${string}`, p.address, user, amount);
      const to = "role" in task.payment.to ? p.ir.roles.find((r) => r.key === (task.payment!.to as { role: string }).role)?.label ?? "" : task.payment.to.address;
      paid = { amount: amount.toString(), to, token: task.payment.token, approved };
    }
    const receipt = await e.send(p, fn, [BigInt(body.instance), ...args], user);
    const ended = receipt.events.find((ev) => ev.name === "InstanceEnded");
    return json({ hash: receipt.hash, gasUsed: receipt.gasUsed, ended: !!ended, completed: ended?.args.completed ?? null, paid: paid ?? null });
  });
}
