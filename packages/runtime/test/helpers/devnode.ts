/** 테스트용 Hardhat 3 노드 스폰. tools/devnode 에서 `hardhat node` 를 띄우고 포트가 열릴 때까지 기다린다. */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface DevNode {
  url: string;
  stop: () => void;
}

export async function startDevNode(port: number): Promise<DevNode> {
  const cwd = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tools", "devnode");
  const child: ChildProcess = spawn("pnpm", ["exec", "hardhat", "node", "--port", String(port)], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) return { url, stop: () => void child.kill("SIGTERM") };
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill("SIGTERM");
  throw new Error("hardhat node 가 시간 안에 뜨지 않았습니다");
}

/** Hardhat 기본 계정 개인키 (공개된 테스트 키) */
export const HARDHAT_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
] as const;
