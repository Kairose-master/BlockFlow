/**
 * 가이드 7.6 "예시 컨트랙트 실행 로그" 재현: JS EVM 에서 17개 트랜잭션 시나리오.
 *   - 활성화 전 실행 / 권한 없는 실행 / 종료 후 실행이 커스텀 에러로 거부된다
 *   - 인스턴스 1 (승인 경로), 2 (소액 우회), 3 (반려) 가 기대대로 종료된다
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate } from "../src/index";
import { compile } from "./helpers/solc";
import { Harness, account, type TxResult } from "./helpers/evm";
import { loadExample } from "./helpers/examples";

const owner = account("owner", 0x01);
const requester = account("requester", 0xa1);
const manager = account("manager", 0xb2);
const finance = account("finance", 0xc3);
const stranger = account("stranger", 0xd4);

const F1 = 1n << 0n, F3 = 1n << 2n, F6 = 1n << 5n, F7 = 1n << 6n, F9 = 1n << 8n;
const gasLog: string[] = [];

function log(label: string, r: TxResult) {
  gasLog.push(`${label.padEnd(30)} ok=${String(r.ok).padEnd(5)} gas=${String(r.gas).padStart(7)}  ${r.error ?? r.events.join(" | ")}`);
}

describe("ExpenseApproval on @ethereumjs/vm (가이드 7.6)", () => {
  let h: Harness;
  let addr: Awaited<ReturnType<Harness["deploy"]>>["address"];
  const roles = [requester.hex, manager.hex, finance.hex] as const;

  beforeAll(async () => {
    const ir = loadExample("expense-approval.json");
    const c = compile(generate(ir), ir.process.id);
    h = await Harness.create(c.abi, [owner, requester, manager, finance, stranger]);
    const d = await h.deploy(owner, c.bytecode, [owner.hex]);
    addr = d.address;
    log("deploy", d.result);
  });

  afterAll(() => {
    console.log(["", "── ExpenseApproval 가스 측정 (JS EVM, Cancun) ──", ...gasLog].join("\n"));
  });

  it("인스턴스 1: 승인 경로 (17개 트랜잭션 중 1~10)", async () => {
    const created = await h.call(owner, addr, "createInstance", [roles]);
    log("createInstance", created);
    expect(created.ok).toBe(true);
    expect(created.events).toEqual([
      "RoleBound(1," + kec("Requester") + "," + requester.hex + ")",
      "RoleBound(1," + kec("Manager") + "," + manager.hex + ")",
      "RoleBound(1," + kec("Finance") + "," + finance.hex + ")",
      `InstanceCreated(1,${owner.hex})`,
      `MarkingChanged(1,${F1})`,
    ]);

    const early = await h.call(manager, addr, "approve", [1n, true]);
    log("approve before submit (X)", early);
    expect(early.ok).toBe(false);
    expect(early.error).toBe("TaskNotEnabled(1,2)");

    const strangerTx = await h.call(stranger, addr, "submit", [1n, 5000n]);
    log("submit by stranger (X)", strangerTx);
    expect(strangerTx.error).toBe(`NotAuthorized(1,${kec("Requester")})`);

    const submit = await h.call(requester, addr, "submit", [1n, 5000n]);
    log("submit amount=5000", submit);
    expect(submit.ok).toBe(true);
    expect(submit.events).toEqual([`TaskCompleted(1,1,${requester.hex})`, `MarkingChanged(1,${F3})`]);

    const payEarly = await h.call(finance, addr, "pay", [1n]);
    log("pay before approve (X)", payEarly);
    expect(payEarly.error).toBe("TaskNotEnabled(1,3)");

    const approve = await h.call(manager, addr, "approve", [1n, true]);
    log("approve=true", approve);
    expect(approve.events).toEqual([`TaskCompleted(1,2,${manager.hex})`, `MarkingChanged(1,${F6 | F7})`]);

    const receipt = await h.call(requester, addr, "uploadReceipt", [1n, `0x${"ab".repeat(32)}`]);
    log("uploadReceipt", receipt);
    expect(receipt.events).toEqual([`TaskCompleted(1,4,${requester.hex})`, `MarkingChanged(1,${F6 | F9})`]);

    const pay = await h.call(finance, addr, "pay", [1n]);
    log("pay", pay);
    expect(pay.events).toEqual([`TaskCompleted(1,3,${finance.hex})`, "InstanceEnded(1,true)", "MarkingChanged(1,0)"]);

    const again = await h.call(finance, addr, "pay", [1n]);
    log("pay again (X, ended)", again);
    expect(again.error).toBe("AlreadyEnded(1)");
  });

  it("인스턴스 2: 소액, 승인 생략 (11~13)", async () => {
    await h.call(owner, addr, "createInstance", [roles]);
    const submit = await h.call(requester, addr, "submit", [2n, 300n]);
    log("submit amount=300", submit);
    expect(submit.events).toContain(`MarkingChanged(2,${F6 | F7})`);

    const pay = await h.call(finance, addr, "pay", [2n]);
    log("pay (inst 2)", pay);
    expect(pay.events).toEqual([`TaskCompleted(2,3,${finance.hex})`, `MarkingChanged(2,${F7 | (1n << 7n)})`]);

    const receipt = await h.call(requester, addr, "uploadReceipt", [2n, `0x${"cd".repeat(32)}`]);
    log("uploadReceipt (inst 2)", receipt);
    expect(receipt.events).toEqual([`TaskCompleted(2,4,${requester.hex})`, "InstanceEnded(2,true)", "MarkingChanged(2,0)"]);
  });

  it("인스턴스 3: 반려 (14~17)", async () => {
    await h.call(owner, addr, "createInstance", [roles]);
    const submit = await h.call(requester, addr, "submit", [3n, 9000n]);
    log("submit amount=9000", submit);
    expect(submit.events).toContain(`MarkingChanged(3,${F3})`);

    const reject = await h.call(manager, addr, "approve", [3n, false]);
    log("approve=false", reject);
    expect(reject.events).toEqual([`TaskCompleted(3,2,${manager.hex})`, "InstanceEnded(3,false)", "MarkingChanged(3,0)"]);

    const pay = await h.call(finance, addr, "pay", [3n]);
    log("pay after reject (X)", pay);
    expect(pay.error).toBe("AlreadyEnded(3)");
  });

  it("소유자 제어: 일시정지·역할 교체", async () => {
    const notOwner = await h.call(stranger, addr, "setPaused", [true]);
    expect(notOwner.error).toBe("NotOwner()");

    const paused = await h.call(owner, addr, "setPaused", [true]);
    expect(paused.events).toEqual(["Paused(true)"]);
    const blocked = await h.call(owner, addr, "createInstance", [roles]);
    expect(blocked.error).toBe("IsPaused()");
    await h.call(owner, addr, "setPaused", [false]);

    const created = await h.call(owner, addr, "createInstance", [roles]);
    expect(created.ok).toBe(true);
    const rebind = await h.call(owner, addr, "rebindRole", [4n, kec("Requester"), stranger.hex]);
    expect(rebind.events).toEqual([`RoleBound(4,${kec("Requester")},${stranger.hex})`]);
    const byNew = await h.call(stranger, addr, "submit", [4n, 10n]);
    expect(byNew.ok).toBe(true);
    const byOld = await h.call(requester, addr, "uploadReceipt", [4n, `0x${"00".repeat(32)}`]);
    expect(byOld.error).toBe(`NotAuthorized(4,${kec("Requester")})`);
  });
});

import { keccak256, stringToHex } from "viem";
function kec(s: string): string {
  return keccak256(stringToHex(s));
}
