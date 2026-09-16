/**
 * ViemAdapter 를 실제 JSON-RPC(Hardhat 3 node) 위에서 검증한다: 배포 → simulate 거부 → send → watch 재생.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseBpmn } from "@blockflow/bpmn";
import { generate } from "@blockflow/codegen";
import { compile } from "../../codegen/test/helpers/solc";
import { ROOT } from "../../codegen/test/helpers/examples";
import { Indexer, SimulationFailed, ViemAdapter, type ViemSigner } from "../src/index";
import { HARDHAT_KEYS, startDevNode, type DevNode } from "./helpers/devnode";

const PORT = 8546;
const chain = defineChain({ id: 31337, name: "devnode", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [`http://127.0.0.1:${PORT}`] } } });

function signer(pk: `0x${string}`): ViemSigner {
  const account = privateKeyToAccount(pk);
  return { address: account.address, account };
}

describe("ViemAdapter on Hardhat node", () => {
  let node: DevNode;
  beforeAll(async () => {
    node = await startDevNode(PORT);
  }, 120_000);
  afterAll(() => node?.stop());

  it("경비 승인 한 건을 JSON-RPC 로 완주하고 인덱서가 폴링으로 따라온다", async () => {
    const { ir } = await parseBpmn(readFileSync(join(ROOT, "packages", "bpmn", "examples", "expense-approval.bpmn"), "utf8"));
    const c = compile(generate(ir), ir.process.id);
    const [owner, req, mgr, fin] = HARDHAT_KEYS.slice(0, 4).map((k) => signer(k)) as [ViemSigner, ViemSigner, ViemSigner, ViemSigner];
    const chainAdapter = new ViemAdapter({ rpcUrl: node.url, chain, pollingInterval: 200 });
    const { address, receipt, block } = await chainAdapter.deploy({ name: ir.process.id, abi: c.abi, bytecode: c.bytecode }, owner);
    expect(receipt.gasUsed).toBeGreaterThan(800_000n);
    expect(await chainAdapter.hasCode(address)).toBe(true);
    expect(await chainAdapter.hasCode("0x1000000000000000000000000000000000000001")).toBe(false);
    const abi = c.abi;

    const ix = new Indexer(chainAdapter);
    const rec = ix.track(address, ir, abi, owner.address, block);

    const created = await chainAdapter.send(address, abi, "createInstance", [[req.address, mgr.address, fin.address]], owner);
    expect(created.events.map((e) => e.name)).toContain("InstanceCreated");
    expect(await chainAdapter.read(address, abi, "enabledTasks", [1n])).toBe(2n);

    const sim = await chainAdapter.simulate(address, abi, "approve", [1n, true], mgr);
    expect(sim).toEqual({ ok: false, error: { name: "TaskNotEnabled", args: [1n, 2] } });
    await expect(chainAdapter.send(address, abi, "approve", [1n, true], mgr)).rejects.toBeInstanceOf(SimulationFailed);

    await chainAdapter.send(address, abi, "submit", [1n, 5000n], req);
    await chainAdapter.send(address, abi, "approve", [1n, true], mgr);
    await chainAdapter.send(address, abi, "pay", [1n], fin);
    const last = await chainAdapter.send(address, abi, "uploadReceipt", [1n, `0x${"22".repeat(32)}`], req);
    expect(last.events.map((e) => e.name)).toEqual(["TaskCompleted", "InstanceEnded", "MarkingChanged"]);

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !rec.instances.get(1n)?.ended) await new Promise((r) => setTimeout(r, 200));
    const inst = rec.instances.get(1n)!;
    expect(inst.ended).toBe(true);
    expect(inst.outcome).toBe("completed");
    expect(rec.timeline.filter((t) => t.kind === "taskCompleted")).toHaveLength(4);
    ix.stop();
  }, 60_000);
});
