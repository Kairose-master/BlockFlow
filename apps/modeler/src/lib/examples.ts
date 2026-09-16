import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** packages/bpmn/examples 를 cwd 에서 위로 올라가며 찾는다 (모노레포 개발 환경). */
export function examplesDir(): string {
  if (process.env.BLOCKFLOW_EXAMPLES_DIR) return process.env.BLOCKFLOW_EXAMPLES_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const c = resolve(dir, "packages", "bpmn", "examples");
    if (existsSync(c)) return c;
    dir = dirname(dir);
  }
  throw new Error("packages/bpmn/examples 를 찾을 수 없습니다");
}
