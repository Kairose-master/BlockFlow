import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBpmn } from "@blockflow/bpmn";
import { generate } from "@blockflow/codegen";
import { compile } from "../../codegen/test/helpers/solc";
import { ROOT } from "../../codegen/test/helpers/examples";
import { Indexer, LocalEvmAdapter, localSigner } from "../src/index";

describe("Indexer: 이벤트 → 인스턴스 상태·타임라인, 스냅샷 재생", () => {
  it("경비 승인 2건을 추적하고 재시작 후 이어서 받는다", async () => {
    const { ir } = await parseBpmn(readFileSync(join(ROOT, "packages", "bpmn", "examples", "expense-approval.bpmn"), "utf8"));
    const c = compile(generate(ir), ir.process.id);
    const owner = localSigner(0x01), req = localSigner(0xa1), mgr = localSigner(0xb2), fin = localSigner(0xc3);
    const chain = await LocalEvmAdapter.create([owner, req, mgr, fin]);
    const { address } = await chain.deploy({ name: ir.process.id, abi: c.abi, bytecode: c.bytecode }, owner);
    const abi = c.abi;

    const ix = new Indexer(chain);
    const changes: string[] = [];
    ix.onChange((a) => changes.push(a));
    const rec = ix.track(address, ir, abi, owner.address, 1n);

    await chain.send(address, abi, "createInstance", [[req.address, mgr.address, fin.address]], owner);
    await chain.send(address, abi, "submit", [1n, 5000n], req);
    const inst1 = rec.instances.get(1n)!;
    expect(inst1.roles).toEqual({ Requester: req.address, Manager: mgr.address, Finance: fin.address });
    expect(inst1.marking).toBe(1n << 2n); // F3: 팀장 승인 대기
    expect(ix.enabledTasks(rec, inst1).map((t) => t.label)).toEqual(["승인"]);
    expect(rec.timeline.map((t) => t.kind)).toEqual(["roleBound", "roleBound", "roleBound", "created", "markingChanged", "taskCompleted", "markingChanged"]);
    expect(changes.length).toBeGreaterThan(0);

    // 재시작: 스냅샷 → 새 인덱서 → 이후 이벤트만 이어서
    const snap = JSON.parse(JSON.stringify(ix.snapshot()));
    ix.stop();
    const ix2 = new Indexer(chain);
    ix2.restore(snap);
    const rec2 = ix2.processes.get(address)!;
    expect(rec2.timeline).toHaveLength(7);
    await chain.send(address, abi, "approve", [1n, false], mgr);
    const i1 = rec2.instances.get(1n)!;
    expect(i1.ended).toBe(true);
    expect(i1.outcome).toBe("rejected");
    expect(rec2.timeline.at(-1)?.kind).toBe("markingChanged");
    expect(rec2.timeline.filter((t) => t.kind === "ended")).toHaveLength(1);

    // 두 번째 인스턴스, 소액 경로
    await chain.send(address, abi, "createInstance", [[req.address, mgr.address, fin.address]], owner);
    await chain.send(address, abi, "submit", [2n, 300n], req);
    const i2 = rec2.instances.get(2n)!;
    expect(ix2.enabledTasks(rec2, i2).map((t) => t.name).sort()).toEqual(["pay", "uploadReceipt"]);

    // refresh 는 read() 로 같은 상태를 확인한다
    await ix2.refresh(address);
    expect(rec2.instances.get(2n)!.marking).toBe(i2.marking);
    await chain.send(address, abi, "setPaused", [true], owner);
    expect(rec2.paused).toBe(true);
    ix2.stop();
  });
});
