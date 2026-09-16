import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { parseBpmn } from "@blockflow/bpmn";
import { generate } from "@blockflow/codegen";
import { compile } from "../../codegen/test/helpers/solc.js";
import { ROOT } from "../../codegen/test/helpers/examples.js";
import { LocalEvmAdapter, SimulationFailed, buildTxPackage, buildUnsignedTx, describe as describeTx, localSigner, roleHash, translateError } from "../src/index.js";

async function expense() {
  const { ir } = await parseBpmn(readFileSync(join(ROOT, "packages", "bpmn", "examples", "expense-approval.bpmn"), "utf8"));
  const c = compile(generate(ir), ir.process.id);
  return { ir, compiled: { name: ir.process.id, abi: c.abi, bytecode: c.bytecode } };
}

describe("커스텀 에러 번역 (8.4)", () => {
  it("IR 이 있으면 태스크·역할 라벨을 넣는다", async () => {
    const { ir } = await expense();
    expect(translateError({ name: "TaskNotEnabled", args: [1n, 2] }, ir)).toEqual({ message: "[승인]은(는) 아직 차례가 아니에요", hint: { kind: "task", id: "T2" } });
    expect(translateError({ name: "NotAuthorized", args: [1n, roleHash("Finance")] }, ir)).toEqual({ message: "이 일은 [재무] 담당자만 할 수 있어요", hint: { kind: "lane", id: "Finance" } });
    expect(translateError({ name: "AlreadyEnded", args: [3n] }).message).toBe("이 건(#3)은 이미 끝났어요");
    expect(translateError({ name: "IsPaused", args: [] }).message).toMatch(/멈춰/);
    expect(translateError({ name: "NotOwner", args: [] }).message).toMatch(/소유자/);
    expect(translateError({ name: "RoleCount", args: [] }).message).toMatch(/담당자/);
  });
  it("IR 이 없으면 일반 문장", () => {
    expect(translateError({ name: "TaskNotEnabled", args: [1n, 2] }).message).toBe("이 일은 아직 차례가 아니에요");
  });
});

describe("서명 없는 트랜잭션 패키지 (Safe Transaction Builder 호환)", () => {
  it("createInstance / rebindRole / 태스크 호출을 인코딩하고 되돌릴 수 있다", async () => {
    const { ir, compiled } = await expense();
    const to = "0x000000000000000000000000000000000000dEaD" as const;
    const a = localSigner(0xa1).address, b = localSigner(0xb2).address, c = localSigner(0xc3).address;
    const txs = [
      buildUnsignedTx(compiled.abi, to, "createInstance", [[a, b, c]]),
      buildUnsignedTx(compiled.abi, to, "rebindRole", [1n, roleHash("Manager"), c]),
      buildUnsignedTx(compiled.abi, to, "submit", [1n, 5000n]),
      buildUnsignedTx(compiled.abi, to, "setPaused", [true]),
    ];
    for (const tx of txs) {
      const d = decodeFunctionData({ abi: compiled.abi, data: tx.data });
      expect(d.functionName).toBe(tx.contractMethod.name);
    }
    expect(txs[2]!.contractInputsValues).toEqual({ id: "1", amount: "5000" });
    const pkg = buildTxPackage(ir, txs, { chainId: 84532, createdAt: 0 });
    expect(pkg.chainId).toBe("84532");
    expect(pkg.meta.description).toBe(
      `경비 승인 새 건 시작 (담당자 신청자, 팀장, 재무); #1 [팀장] 담당자를 ${c} 로 교체; #1 [경비 신청] 완료 (금액=5000); 경비 승인 일시정지`,
    );
    expect(describeTx(ir, "setPaused", { p: "false" })).toBe("경비 승인 재개");
  });
  it("없는 함수는 거부", async () => {
    const { compiled } = await expense();
    expect(() => buildUnsignedTx(compiled.abi, "0x000000000000000000000000000000000000dEaD", "nope", [])).toThrow(/nope/);
  });
});

describe("LocalEvmAdapter: simulate → send, watch, read", () => {
  it("경비 승인 한 건을 어댑터로 완주한다", async () => {
    const { ir, compiled } = await expense();
    const owner = localSigner(0x01), req = localSigner(0xa1), mgr = localSigner(0xb2), fin = localSigner(0xc3);
    const chain = await LocalEvmAdapter.create([owner, req, mgr, fin]);
    const { address, receipt } = await chain.deploy(compiled, owner);
    expect(receipt.gasUsed).toBe(905046n);
    const abi = compiled.abi;

    const seen: string[] = [];
    const stop = chain.watch(address, abi, (e) => seen.push(e.name));

    const created = await chain.send(address, abi, "createInstance", [[req.address, mgr.address, fin.address]], owner);
    expect(created.events.map((e) => e.name)).toEqual(["RoleBound", "RoleBound", "RoleBound", "InstanceCreated", "MarkingChanged"]);
    expect(await chain.read(address, abi, "enabledTasks", [1n])).toBe(1n << 1n);

    // 시뮬레이션이 막는다: 가스 안 씀, 트랜잭션 안 보냄
    const sim = await chain.simulate(address, abi, "approve", [1n, true], mgr);
    expect(sim).toEqual({ ok: false, error: { name: "TaskNotEnabled", args: [1n, 2] } });
    await expect(chain.send(address, abi, "approve", [1n, true], mgr)).rejects.toMatchObject({ name: "SimulationFailed", message: "이 일은 아직 차례가 아니에요" });
    await expect(chain.send(address, abi, "submit", [1n, 1n], fin)).rejects.toBeInstanceOf(SimulationFailed);

    await chain.send(address, abi, "submit", [1n, 5000n], req);
    await chain.send(address, abi, "approve", [1n, true], mgr);
    await chain.send(address, abi, "uploadReceipt", [1n, `0x${"11".repeat(32)}`], req);
    const pay = await chain.send(address, abi, "pay", [1n], fin);
    expect(pay.events.map((e) => e.name)).toEqual(["TaskCompleted", "InstanceEnded", "MarkingChanged"]);
    const inst = (await chain.read(address, abi, "instances", [1n])) as [bigint, boolean, string];
    expect(inst[0]).toBe(0n);
    expect(inst[1]).toBe(true);

    stop();
    expect(seen.filter((n) => n === "TaskCompleted")).toHaveLength(4);
    // 재생: fromBlock 0 부터 다시 받는다
    const replay: string[] = [];
    chain.watch(address, abi, (e) => replay.push(e.name))();
    expect(replay.length).toBe(seen.length);

    // 시뮬레이션은 nonce 를 소모하지 않아야 한다 (다음 send 가 정상)
    const inst2 = await chain.send(address, abi, "createInstance", [[req.address, mgr.address, fin.address]], owner);
    expect(inst2.events.some((e) => e.name === "InstanceCreated" && String(e.args.id) === "2")).toBe(true);
  });
});
