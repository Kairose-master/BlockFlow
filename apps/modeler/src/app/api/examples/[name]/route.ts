import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { ensureLayout, localizeExampleBpmn } from "@blockflow/bpmn";
import { examplesDir } from "@/lib/examples";

export const runtime = "nodejs";

/** GET /api/examples/:name?locale=ko|en → localized, auto-laid-out BPMN XML */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!/^[a-z0-9-]+$/.test(name)) return NextResponse.json({ message: "잘못된 이름" }, { status: 400 });
  const path = join(examplesDir(), `${name}.bpmn`);
  if (!existsSync(path)) return NextResponse.json({ message: "없는 예시" }, { status: 404 });
  const locale = new URL(req.url).searchParams.get("locale") === "en" ? "en" : "ko";
  const localized = localizeExampleBpmn(readFileSync(path, "utf8"), locale);
  const { xml } = await ensureLayout(localized);
  return new NextResponse(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
