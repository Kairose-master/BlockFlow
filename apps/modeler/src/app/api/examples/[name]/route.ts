import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { ensureLayout } from "@blockflow/bpmn";
import { examplesDir } from "@/lib/examples";

export const runtime = "nodejs";

/** GET /api/examples/:name → 자동 배치(DI)된 BPMN XML */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!/^[a-z0-9-]+$/.test(name)) return NextResponse.json({ message: "잘못된 이름" }, { status: 400 });
  const path = join(examplesDir(), `${name}.bpmn`);
  if (!existsSync(path)) return NextResponse.json({ message: "없는 예시" }, { status: 404 });
  const { xml } = await ensureLayout(readFileSync(path, "utf8"));
  return new NextResponse(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
