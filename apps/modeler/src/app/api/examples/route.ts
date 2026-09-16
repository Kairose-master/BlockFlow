import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { examplesDir } from "@/lib/examples";

export const runtime = "nodejs";

/** GET /api/examples → [{ name, file, title }] */
export function GET() {
  const dir = examplesDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".bpmn")).sort();
  const list = files.map((file) => {
    const xml = readFileSync(join(dir, file), "utf8");
    const m = /<bpmn:process[^>]*\sname="([^"]*)"/.exec(xml);
    return { name: file.replace(/\.bpmn$/, ""), file, title: m?.[1] ?? file };
  });
  return NextResponse.json(list);
}
