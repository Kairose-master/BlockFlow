/**
 * V4 시나리오 (가이드 7.4): planScenarios() 가 만든 도달 경로를 JS EVM 에서 실제로 실행한다.
 * BPMN 예시 5개 전부 배포·실행되는지가 Phase 1 완료 기준이다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IR } from "@blockflow/ir";
import { keccak256, stringToHex } from "viem";
import { generate, generateFoundryTest, planScenarios, type Plan } from "@blockflow/codegen";
import { parseBpmn } from "../src/index";
import { compile } from "../../codegen/test/helpers/solc";
import { Harness, account, type Account } from "../../codegen/test/helpers/evm";
import { ROOT } from "../../codegen/test/helpers/examples";

const BPMN_DIR = join(ROOT, "packages", "bpmn", "examples");
const files = readdirSync(BPMN_DIR).filter((f) => f.endsWith(".bpmn")).sort();

function toArg(v: bigint | boolean | string): unknown {
  return v;
}

async function runPlans(ir: IR): Promise<{ plans: Plan[]; gas: Record<string, bigint[]> }> {
  const owner = account("owner", 0x01);
  const stranger = account("stranger", 0xbad);
  const oracle = account("oracle", 0xacc0);
  const roleAccounts: Account[] = ir.roles.map((r, i) => account(r.key, 0xa1 + i));
  const roleAddresses = new Map(ir.roles.map((r, i) => [r.key, roleAccounts[i]!.hex.toLowerCase()]));
  const plans = planScenarios(ir, { roleAddresses });
  expect(plans.length).toBeGreaterThan(0);

  const c = compile(generate(ir), ir.process.id);
  expect(c.diagnostics).toEqual([]);
  const h = await Harness.create(c.abi, [owner, stranger, oracle, ...roleAccounts]);
  const acc = (roleKey: string) => roleAccounts[ir.roles.findIndex((r) => r.key === roleKey)]!;
  const { address } = await h.deploy(owner, c.bytecode, [owner.hex]);
  const hasService = ir.nodes.some((n) => n.kind === "serviceTask");
  if (hasService) expect((await h.call(owner, address, "setOracle", [oracle.hex])).ok).toBe(true);
  /** 태스크의 실행 계정: 사용자 태스크는 역할 담당자, 서비스 태스크는 오라클 */
  const actorOf = (t: { kind: string; role?: string }) => (t.kind === "serviceTask" ? oracle : acc(t.role!));

  // L1 결제 태스크: 토큰 목을 참조 주소에 심고, 역할 계정마다 잔액과 approve 를 준다
  const tokens = [...new Set(ir.nodes.filter((n) => n.kind === "userTask" && n.payment).map((n) => (n.kind === "userTask" ? n.payment!.token : "")))];
  const tokenAbi = tokens.length ? compile(Harness.MOCK_ERC20_SOURCE, "MockERC20") : undefined;
  const tokenAddrs = new Map<string, Awaited<ReturnType<Harness["etch"]>>>();
  for (const t of tokens) {
    const tokenAddr = await h.etch(t as `0x${string}`, tokenAbi!.deployedBytecode);
    tokenAddrs.set(t.toLowerCase(), tokenAddr);
    for (const a of roleAccounts) {
      expect((await h.callWith(tokenAbi!.abi, owner, tokenAddr, "mint", [a.hex, 10n ** 30n])).ok).toBe(true);
      expect((await h.callWith(tokenAbi!.abi, a, tokenAddr, "approve", [address.toString(), 2n ** 256n - 1n])).ok).toBe(true);
    }
  }
  const balanceOf = async (token: string, who: string): Promise<bigint> => {
    const r = await h.callWith(tokenAbi!.abi, owner, tokenAddrs.get(token.toLowerCase())!, "balanceOf", [who]);
    return BigInt(r.returnData);
  };
  const gas: Record<string, bigint[]> = {};

  for (const plan of plans) {
    h.warp(1_700_000_000);
    const created = await h.call(owner, address, "createInstance", [roleAccounts.map((a) => a.hex)]);
    expect(created.ok, created.error).toBe(true);
    const id = BigInt(plan.index);
    const vars: Record<string, unknown> = {};
    for (const s of plan.steps) {
      Object.assign(vars, s.args);
      if (s.kind === "expire") {
        const fn = `expire${s.task.name.charAt(0).toUpperCase()}${s.task.name.slice(1)}`;
        if ((s.deadlineSeconds ?? 0) > 0) {
          h.warp(s.time - 1);
          const early = await h.call(stranger, address, fn, [id]);
          expect(early.error).toBe(`NotExpired(${id},${s.task.taskId})`);
        }
        h.warp(s.time);
        const r = await h.call(stranger, address, fn, [id]);
        expect(r.ok, `${plan.description}: ${fn} → ${r.error}`).toBe(true);
        expect(r.events).toContain(`TaskExpired(${id},${s.task.taskId})`);
        expect(r.events).toContain(`MarkingChanged(${id},${s.markingAfter})`);
        if (s.endedAfter) expect(r.events).toContain(`InstanceEnded(${id},${s.outcomeAfter === "completed"})`);
        continue;
      }
      h.warp(s.time);
      const args = s.task.inputs.map((i) => toArg(s.args[i.variable]!));
      // 권한 없는 실행
      const bad = await h.call(stranger, address, s.task.name, [id, ...args]);
      expect(bad.error).toBe(s.task.kind === "serviceTask" ? "NotOracle()" : `NotAuthorized(${id},${keccak256(stringToHex(s.task.role))})`);
      // 활성화되지 않은 태스크
      if (s.disabledTask) {
        const d = s.disabledTask;
        const zeros = d.inputs.map((i) => {
          const t = ir.variables.find((v) => v.name === i.variable)!.type;
          return t === "bool" ? false : t === "bytes32" ? `0x${"0".repeat(64)}` : t === "address" ? `0x${"0".repeat(40)}` : 0n;
        });
        const r = await h.call(actorOf(d), address, d.name, [id, ...zeros]);
        expect(r.error).toBe(`TaskNotEnabled(${id},${d.taskId})`);
      }
      // 결제 태스크: 받는 쪽 잔액이 금액만큼 늘어야 한다
      const pay = s.task.kind === "userTask" ? s.task.payment : undefined;
      const payee = pay && "role" in pay.to ? acc(pay.to.role).hex : pay && "address" in pay.to ? pay.to.address : undefined;
      const before = pay && payee ? await balanceOf(pay.token, payee) : 0n;
      // 정상 실행
      const r = await h.call(actorOf(s.task), address, s.task.name, [id, ...args]);
      expect(r.ok, `${plan.description}: ${s.task.name} → ${r.error}`).toBe(true);
      (gas[s.task.name] ??= []).push(r.gas);
      expect(r.events).toContain(`MarkingChanged(${id},${s.markingAfter})`);
      if (pay && payee) {
        const amount = BigInt(String(vars[pay.amountVar] ?? 0n));
        expect(await balanceOf(pay.token, payee)).toBe(before + amount);
      }
      if (s.endedAfter) expect(r.events).toContain(`InstanceEnded(${id},${s.outcomeAfter === "completed"})`);
      else expect(r.events.some((e) => e.startsWith("InstanceEnded"))).toBe(false);
    }
    // 종료 후 실행
    const first = plan.steps[0]!.task;
    const zeros = first.inputs.map((i) => {
      const t = ir.variables.find((v) => v.name === i.variable)!.type;
      return t === "bool" ? false : t === "bytes32" ? `0x${"0".repeat(64)}` : t === "address" ? `0x${"0".repeat(40)}` : 0n;
    });
    const after = await h.call(actorOf(first), address, first.name, [id, ...zeros]);
    expect(after.error).toBe(`AlreadyEnded(${id})`);
  }
  return { plans, gas };
}

describe("BPMN 예시 전부: 배포 + 모든 도달 경로 실행 (JS EVM)", () => {
  for (const f of files) {
    it(f, async () => {
      const { ir } = await parseBpmn(readFileSync(join(BPMN_DIR, f), "utf8"));
      const { plans, gas } = await runPlans(ir);
      const outcomes = new Set(plans.map((p) => p.outcome));
      // 모든 종료 이벤트의 outcome 이 적어도 한 경로에서 도달된다
      for (const n of ir.nodes) if (n.kind === "endEvent") expect(outcomes).toContain(n.outcome);
      // 설계 목표 1.3: 태스크 1건 ≤ 60k gas — 입력 1개(저장 슬롯 1개) 기준 (측정치 37k~60k).
      // 입력이 n개면 슬롯 쓰기가 n번이므로 22.5k × n 을 더하고, 종료 이벤트까지 발화하는 태스크(ended 쓰기 + 이벤트)
      // 를 위해 기본값에 여유를 둔 상한을 건다. 회귀 감지용이지 목표치 자체는 아니다.
      const lines: string[] = [];
      for (const t of ir.nodes) {
        if (t.kind !== "userTask" || !gas[t.name]) continue;
        const max = gas[t.name]!.reduce((a, b) => (a > b ? a : b), 0n);
        // 결제 태스크는 ERC-20 transferFrom(잔액 2개 + allowance 갱신) 만큼 더 든다
        const limit = 45_000n + 22_500n * BigInt(t.inputs.length) + (t.payment ? 30_000n : 0n);
        lines.push(`  ${t.name.padEnd(16)} inputs=${t.inputs.length} max gas=${max}`);
        expect(max, `${t.name} gas ${max} > ${limit}`).toBeLessThanOrEqual(limit);
      }
      console.log([`${ir.process.id}: 경로 ${plans.length}개`, ...lines].join("\n"));
    });
  }

  it("경비 승인: 경로 5개 (승인 2 인터리빙 + 소액 2 인터리빙 + 반려)", async () => {
    const { ir } = await parseBpmn(readFileSync(join(BPMN_DIR, "expense-approval.bpmn"), "utf8"));
    const plans = planScenarios(ir);
    expect(plans.map((p) => p.description)).toEqual([
      "submit → pay → uploadReceipt | X1→F4",
      "submit → uploadReceipt → pay | X1→F4",
      "submit → approve | X1→F3, X2→F12",
      "submit → approve → pay → uploadReceipt | X1→F3, X2→F11",
      "submit → approve → uploadReceipt → pay | X1→F3, X2→F11",
    ]);
    expect(plans[2]!.outcome).toBe("rejected");
    expect(plans[3]!.steps[0]!.args).toEqual({ amount: 1001n });
    expect(plans[3]!.steps[1]!.args).toEqual({ approved: true });
  });

  it("생성된 Foundry 테스트가 커밋본과 같다 (diff 0)", async () => {
    for (const f of files) {
      const { ir } = await parseBpmn(readFileSync(join(BPMN_DIR, f), "utf8"));
      const committed = readFileSync(join(ROOT, "contracts", "test", "generated", `${ir.process.id}.t.sol`), "utf8");
      expect(generateFoundryTest(ir)).toBe(committed);
    }
  });
});
