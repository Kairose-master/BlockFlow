import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeProbe, probeRpc } from "../src/probe";
import { startDevNode, type DevNode } from "./helpers/devnode";

describe("RPC 호환성 프로브", () => {
  let node: DevNode;
  beforeAll(async () => {
    node = await startDevNode(8547);
  }, 120_000);
  afterAll(() => node?.stop());

  it("Hardhat 노드는 필수 eth_* 를 모두 지원하고 PUSH0 을 실행한다", async () => {
    const p = await probeRpc(node.url);
    expect(p.problems).toEqual([]);
    expect(p.ok).toBe(true);
    expect(p.chainId).toBe(31337);
    expect(p.eip1559).toBe(true);
    expect(p.push0).toBe(true);
    expect(describeProbe(p)[0]).toContain("31337");
  }, 60_000);

  it("없는 엔드포인트는 문제 목록을 돌려준다", async () => {
    const p = await probeRpc("http://127.0.0.1:1");
    expect(p.ok).toBe(false);
    expect(p.problems.length).toBeGreaterThan(0);
  });
});
