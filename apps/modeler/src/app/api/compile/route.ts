import { NextResponse } from "next/server";
import { compileBpmn } from "@/lib/compile";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { xml } = (await req.json()) as { xml?: string };
  if (typeof xml !== "string") return NextResponse.json({ ok: false, stage: "input", message: "xml 이 없습니다" }, { status: 400 });
  return NextResponse.json(await compileBpmn(xml));
}
