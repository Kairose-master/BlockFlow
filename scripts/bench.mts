#!/usr/bin/env tsx
/**
 * pnpm bench — 논문화 가능한 측정 (가이드 11장): 예시마다 파싱·soundness·생성·컴파일 시간, 바이트코드 크기,
 * 배포·인스턴스 생성·태스크 완료 가스(6.8 형식)를 JS EVM(Cancun) 에서 재고 docs/measurements.md 로 쓴다.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Abi } from "viem";
import { parseBpmn } from "../packages/bpmn/src/index";
import { generate, planScenarios, type Plan } from "../packages/codegen/src/index";
import type { IR } from "../packages/ir/src/index";
import { checkSoundness, checkStructure } from "../packages/validator/src/index";
import { DEMO_ERC20_SOURCE, ERC20_ABI, LocalEvmAdapter, localSigner, paymentTokens, type LocalSigner } from "../packages/runtime/src/index";

const require = createRequire(import.meta.url);
const solc = require("solc") as { compile: (input: string) => string; version: () => string };
const ROOT = join(import.meta.dirname, "..");
const EXAMPLES = join(ROOT, "packages", "bpmn", "examples");

function compile(name: string, source: string) {
  const input = { language: "Solidity", sources: { [`${name}.sol`]: { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input))) as { errors?: { severity: string; formattedMessage: string }[]; contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }>> };
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts[`${name}.sol`]![name]!;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` as `0x${string}`, deployed: `0x${c.evm.deployedBytecode.object}` as `0x${string}`, warnings: (out.errors ?? []).length };
}

interface Row {
  id: string; name: string; tasks: number; flows: number; roles: number; l1: string;
  parseMs: number; soundMs: number; states: number; genMs: number; solcMs: number; bytes: number;
  deployGas: bigint; createGas: [bigint, bigint]; taskGas: Map<string, { min: bigint; max: bigint; inputs: number; kind: string }>; paths: number;
}

const ms = (t0: number) => Math.round((performance.now() - t0) * 100) / 100;

async function measure(file: string): Promise<Row> {
  const xml = readFileSync(join(EXAMPLES, file), "utf8");
  let t0 = performance.now();
  const { ir } = await parseBpmn(xml);
  const parseMs = ms(t0);
  t0 = performance.now();
  if (checkStructure(ir).length) throw new Error(`${file}: 구조 검사 실패`);
  const sound = checkSoundness(ir);
  const soundMs = ms(t0);
  t0 = performance.now();
  const sol = generate(ir);
  const genMs = ms(t0);
  t0 = performance.now();
  const c = compile(ir.process.id, sol);
  const solcMs = ms(t0);

  // 실행
  const owner = localSigner(0x01), oracle = localSigner(0xacc0), stranger = localSigner(0xbad);
  const roleSigners: LocalSigner[] = ir.roles.map((_, i) => localSigner(0xa1 + i));
  const chain = await LocalEvmAdapter.create([owner, oracle, stranger, ...roleSigners]);
  const { address, receipt } = await chain.deploy({ name: ir.process.id, abi: c.abi, bytecode: c.bytecode }, owner);
  if (ir.nodes.some((n) => n.kind === "serviceTask")) await chain.send(address, c.abi, "setOracle", [oracle.address], owner);
  const tokens = paymentTokens(ir);
  if (tokens.length) {
    const tk = compile("DemoERC20", DEMO_ERC20_SOURCE);
    for (const t of tokens) {
      await chain.etch(t as `0x${string}`, tk.deployed);
      for (const s of roleSigners) {
        await chain.send(t as `0x${string}`, ERC20_ABI, "mint", [s.address, 10n ** 30n], owner);
        await chain.send(t as `0x${string}`, ERC20_ABI, "approve", [address, 2n ** 255n], s);
      }
    }
  }
  const signerOf = (t: { kind: string; role?: string }) => (t.kind === "serviceTask" ? oracle : roleSigners[ir.roles.findIndex((r) => r.key === t.role)]!);
  const plans: Plan[] = planScenarios(ir, { roleAddresses: new Map(ir.roles.map((r, i) => [r.key, roleSigners[i]!.address.toLowerCase()])) });
  const createGas: bigint[] = [];
  const taskGas = new Map<string, { min: bigint; max: bigint; inputs: number; kind: string }>();
  const base = Math.floor(Date.now() / 1000);
  for (const plan of plans) {
    chain.timeOffset = 0;
    const cr = await chain.send(address, c.abi, "createInstance", [roleSigners.map((s) => s.address)], owner);
    createGas.push(cr.gasUsed);
    const id = BigInt(createGas.length);
    for (const s of plan.steps) {
      // 계획의 시각을 체인 시각으로: T0(1.7e9) 기준 오프셋을 현재 시각 기준으로 옮긴다
      chain.timeOffset = s.time - 1_700_000_000 + (1_700_000_000 - base);
      const args = s.task.inputs.map((i) => s.args[i.variable]!);
      const fn = s.kind === "expire" ? `expire${s.task.name.charAt(0).toUpperCase()}${s.task.name.slice(1)}` : s.task.name;
      const r = await chain.send(address, c.abi, fn, s.kind === "expire" ? [id] : [id, ...args], s.kind === "expire" ? stranger : signerOf(s.task));
      const key = s.kind === "expire" ? `${s.task.name} (만료)` : s.task.name;
      const cur = taskGas.get(key) ?? { min: r.gasUsed, max: r.gasUsed, inputs: s.kind === "expire" ? 0 : s.task.inputs.length, kind: s.kind === "expire" ? "expire" : s.task.kind === "serviceTask" ? "oracle" : (s.task as { payment?: unknown }).payment ? "payment" : "user" };
      cur.min = r.gasUsed < cur.min ? r.gasUsed : cur.min;
      cur.max = r.gasUsed > cur.max ? r.gasUsed : cur.max;
      taskGas.set(key, cur);
    }
  }
  const l1 = [ir.nodes.some((n) => n.kind === "userTask" && n.payment) ? "결제" : "", ir.nodes.some((n) => (n.kind === "userTask" || n.kind === "serviceTask") && n.timer) ? "타이머" : "", ir.nodes.some((n) => n.kind === "serviceTask") ? "오라클" : ""].filter(Boolean).join("·") || "L0";
  return {
    id: ir.process.id, name: ir.process.name, tasks: ir.nodes.filter((n) => n.kind === "userTask" || n.kind === "serviceTask").length, flows: ir.flows.length, roles: ir.roles.length, l1,
    parseMs, soundMs, states: sound.states, genMs, solcMs, bytes: (c.bytecode.length - 2) / 2,
    deployGas: receipt.gasUsed, createGas: [createGas[0]!, createGas[1] ?? createGas[0]!], taskGas, paths: plans.length,
  };
}

const files = readdirSync(EXAMPLES).filter((f) => f.endsWith(".bpmn")).sort();
const rows: Row[] = [];
for (const f of files) {
  process.stderr.write(`${f} … `);
  rows.push(await measure(f));
  process.stderr.write("done\n");
}
const fmt = (n: bigint | number) => n.toLocaleString("en-US");
const lines: string[] = [];
lines.push("# 측정 (자동 생성: `pnpm bench`)", "");
lines.push(`solc ${solc.version().split("+")[0]}, optimizer 200, evmVersion cancun · JS EVM (@ethereumjs/vm, Cancun) · ${new Date().toISOString().slice(0, 10)}`, "");
lines.push("가이드 6.8 형식. 태스크 가스는 시나리오 생성기가 만든 모든 도달 경로를 실행해 얻은 최소~최대다. 시간은 이 머신의 단일 실행값이라 참고용이다.", "");
lines.push("## 프로세스별", "");
lines.push("| 프로세스 | 요소 | 파싱 | soundness (상태 수) | 생성 | solc | 바이트코드 | 배포 gas | createInstance gas (1번째 / 2번째) | 경로 |");
lines.push("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) lines.push(`| ${r.name} (${r.id}) | 태스크 ${r.tasks}, 플로우 ${r.flows}, 역할 ${r.roles}, ${r.l1} | ${r.parseMs} ms | ${r.soundMs} ms (${r.states}) | ${r.genMs} ms | ${r.solcMs} ms | ${fmt(r.bytes)} B | ${fmt(r.deployGas)} | ${fmt(r.createGas[0])} / ${fmt(r.createGas[1])} | ${r.paths} |`);
lines.push("", "## 태스크 완료 gas", "");
lines.push("| 프로세스 | 태스크 | 종류 | 입력 수 | gas (최소 ~ 최대) |");
lines.push("|---|---|---|---|---|");
for (const r of rows) for (const [name, g] of r.taskGas) lines.push(`| ${r.id} | ${name} | ${{ user: "사용자", payment: "결제(ERC-20)", oracle: "오라클", expire: "타이머 만료" }[g.kind]} | ${g.inputs} | ${fmt(g.min)}${g.min === g.max ? "" : ` ~ ${fmt(g.max)}`} |`);
const all = rows.flatMap((r) => [...r.taskGas.values()].filter((g) => g.kind === "user").map((g) => g.max));
lines.push("", "## 요약", "");
lines.push(`- 사용자 태스크 완료 gas: ${fmt(all.reduce((a, b) => (a < b ? a : b)))} ~ ${fmt(all.reduce((a, b) => (a > b ? a : b)))} (입력 0개 ≈ 37k, 1개 ≈ 60k, 2개 ≈ 82k — 슬롯 쓰기 1개당 약 22k)`);
lines.push(`- 배포 gas: ${fmt(rows.reduce((a, r) => (a < r.deployGas ? a : r.deployGas), rows[0]!.deployGas))} ~ ${fmt(rows.reduce((a, r) => (a > r.deployGas ? a : r.deployGas), 0n))}, 인스턴스 생성: 역할 수에 비례 (역할당 RoleBound 저장·이벤트)`);
lines.push(`- soundness 검사: 모든 예시 ${Math.max(...rows.map((r) => r.soundMs))} ms 이하 (L0 상태 수 수십 개 규모, 7.2)`);
lines.push("- 문헌 대비 (6.8): Caterpillar 컴파일형 인스턴스 생성 1.1~2.8M, ChorChain 인스턴스=배포 4.5M, 俞东进 2021 0.21M → 다중 인스턴스 단일 컨트랙트(D3)가 인스턴스 생성을 한 자릿수 줄인다.");
writeFileSync(join(ROOT, "docs", "measurements.md"), lines.join("\n") + "\n");
console.log(`docs/measurements.md 작성 (${rows.length}개 프로세스)`);
