import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IR } from "@blockflow/ir";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const EXAMPLES_DIR = join(ROOT, "packages", "ir", "examples");
export const CONTRACTS_DIR = join(ROOT, "contracts", "src");

export function loadExample(file: string): IR {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, file), "utf8")) as IR;
}

export function exampleFiles(): string[] {
  return readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();
}

export function readContract(name: string): string {
  return readFileSync(join(CONTRACTS_DIR, `${name}.sol`), "utf8");
}
