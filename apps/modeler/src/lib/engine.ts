/**
 * engine.ts — 서버 싱글턴: 체인 어댑터 + 인덱서 + 배포된 프로세스 등록부 + 데모 사용자.
 *
 * 모드
 *   - local (기본): @ethereumjs/vm 인메모리 체인. 설치 없이 바로 써 본다. 서버가 재시작되면 사라진다.
 *   - rpc:  BLOCKFLOW_RPC_URL 이 있으면 viem 어댑터. chainId 31337 이면 Hardhat 기본 키, 아니면 BLOCKFLOW_KEYS(쉼표 구분).
 *           등록부와 인덱서 스냅샷을 .blockflow/state.json 에 저장해 재시작 시 lastBlock 부터 재생한다.
 *
 * "로그인" 은 데모 사용자 선택(헤더 x-blockflow-user) 으로 대신한다. 임베디드 지갑·가스 스폰서(9장)는 Signer 교체로 붙는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineChain, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { IR } from "@blockflow/ir";
import {
  type Address, type CompiledProcess, Indexer, type IndexerSnapshot, LocalEvmAdapter, localSigner, type ProcessAdapter, type Signer,
  SimulationFailed, translateError, ViemAdapter, type ViemSigner,
} from "@blockflow/runtime";

export interface DemoUser {
  address: Address;
  label: string;
  signer: Signer;
}

export interface DeployedProcess {
  address: Address;
  xml: string;
  ir: IR;
  abi: Abi;
  owner: Address;
  deployedBlock: bigint;
  deployedAt: number;
}

const DEMO_LABELS = ["운영자 (소유자)", "김신청", "이팀장", "박재무", "최구매", "정공급", "한심사"];
const HARDHAT_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
] as const;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly detail?: unknown) {
    super(message);
  }
}

export class Engine {
  readonly mode: "local" | "rpc";
  readonly users: DemoUser[];
  readonly processes = new Map<Address, DeployedProcess>();
  readonly indexer: Indexer;
  private constructor(readonly adapter: ProcessAdapter, mode: "local" | "rpc", users: DemoUser[], private readonly statePath?: string) {
    this.mode = mode;
    this.users = users;
    this.indexer = new Indexer(adapter);
  }

  static async create(): Promise<Engine> {
    const rpcUrl = process.env.BLOCKFLOW_RPC_URL;
    if (!rpcUrl) {
      const users = DEMO_LABELS.map((label, i) => {
        const s = localSigner(0x100 + i);
        return { address: s.address, label, signer: s };
      });
      const adapter = await LocalEvmAdapter.create(users.map((u) => u.signer));
      return new Engine(adapter, "local", users);
    }
    const chainId = Number(process.env.BLOCKFLOW_CHAIN_ID ?? 31337);
    const keys = (process.env.BLOCKFLOW_KEYS?.split(",").map((k) => k.trim()).filter(Boolean) ?? (chainId === 31337 ? [...HARDHAT_KEYS] : [])) as `0x${string}`[];
    if (!keys.length) throw new Error("BLOCKFLOW_KEYS 가 필요합니다 (chainId 31337 이 아닐 때)");
    const users: DemoUser[] = keys.map((pk, i) => {
      const account = privateKeyToAccount(pk);
      const signer: ViemSigner = { address: account.address, account };
      return { address: account.address, label: DEMO_LABELS[i] ?? `사용자 ${i + 1}`, signer };
    });
    const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
    const adapter = new ViemAdapter({ rpcUrl, chain, pollingInterval: Number(process.env.BLOCKFLOW_POLL_MS ?? 1000) });
    const statePath = process.env.BLOCKFLOW_STATE ?? join(process.cwd(), ".blockflow", "state.json");
    const engine = new Engine(adapter, "rpc", users, statePath);
    engine.load();
    return engine;
  }

  get owner(): DemoUser {
    return this.users[0]!;
  }

  user(address: string | null | undefined): DemoUser {
    const u = this.users.find((x) => x.address.toLowerCase() === (address ?? "").toLowerCase());
    if (!u) throw new ApiError(401, "사용자를 먼저 선택하세요");
    return u;
  }

  requireOwner(address: string | null | undefined): DemoUser {
    const u = this.user(address);
    if (u.address !== this.owner.address) throw new ApiError(403, "프로세스 소유자만 할 수 있는 작업이에요");
    return u;
  }

  async deploy(xml: string, compiled: CompiledProcess, ir: IR, owner: DemoUser): Promise<DeployedProcess> {
    const r = await this.adapter.deploy(compiled, owner.signer);
    const deployedBlock = (r as { block?: bigint }).block ?? 0n;
    const rec: DeployedProcess = { address: r.address, xml, ir, abi: compiled.abi, owner: owner.address, deployedBlock, deployedAt: Date.now() };
    this.processes.set(r.address, rec);
    this.indexer.track(r.address, ir, compiled.abi, owner.address, deployedBlock);
    this.save();
    return rec;
  }

  process(address: string): DeployedProcess {
    const p = [...this.processes.values()].find((x) => x.address.toLowerCase() === address.toLowerCase());
    if (!p) throw new ApiError(404, "없는 프로세스예요");
    return p;
  }

  /** 쓰기: 시뮬레이션 실패는 번역된 메시지로 400. */
  async send(p: DeployedProcess, fn: string, args: unknown[], from: DemoUser) {
    try {
      const receipt = await this.adapter.send(p.address, p.abi, fn, args, from.signer);
      this.save();
      return receipt;
    } catch (e) {
      if (e instanceof SimulationFailed) throw new ApiError(400, translateError(e.contractError, p.ir).message, e.contractError);
      throw e;
    }
  }

  private save(): void {
    if (!this.statePath) return;
    const data = {
      processes: [...this.processes.values()].map((p) => ({ ...p, deployedBlock: p.deployedBlock.toString() })),
      indexer: this.indexer.snapshot(),
    };
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(data));
  }

  private load(): void {
    if (!this.statePath || !existsSync(this.statePath)) return;
    const data = JSON.parse(readFileSync(this.statePath, "utf8")) as { processes: (Omit<DeployedProcess, "deployedBlock"> & { deployedBlock: string })[]; indexer: IndexerSnapshot };
    for (const p of data.processes) this.processes.set(p.address, { ...p, deployedBlock: BigInt(p.deployedBlock) });
    this.indexer.restore(data.indexer);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __blockflowEngine: Promise<Engine> | undefined;
}

/** Next.js 개발 서버의 핫 리로드에도 하나만 유지한다. */
export function getEngine(): Promise<Engine> {
  globalThis.__blockflowEngine ??= Engine.create();
  return globalThis.__blockflowEngine;
}

export function userHeader(req: Request): string | null {
  return req.headers.get("x-blockflow-user");
}

/** JSON 에 bigint 를 문자열로 */
export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
}

export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e: unknown) => {
    if (e instanceof ApiError) return json({ message: e.message, detail: e.detail }, { status: e.status });
    console.error(e);
    return json({ message: (e as Error).message }, { status: 500 });
  });
}

/** IR 입력 타입에 맞춰 문자열 인자를 변환한다 (폼 → 컨트랙트). */
export function coerceArgs(ir: IR, taskName: string, raw: Record<string, unknown>): unknown[] {
  const task = ir.nodes.find((n) => n.kind === "userTask" && n.name === taskName);
  if (task?.kind !== "userTask") throw new ApiError(400, "없는 할 일이에요");
  return task.inputs.map((inp) => {
    const type = ir.variables.find((v) => v.name === inp.variable)?.type;
    const v = raw[inp.variable];
    switch (type) {
      case "uint256":
      case "int256": {
        if (v === undefined || v === "" || !/^-?\d+$/.test(String(v))) throw new ApiError(400, `[${inp.label}] 에는 정수를 입력하세요`);
        return BigInt(String(v));
      }
      case "bool":
        return v === true || v === "true" || v === "on" || v === "1";
      case "bytes32": {
        const s = String(v ?? "");
        if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s;
        throw new ApiError(400, `[${inp.label}] 은 32바이트 해시(0x…)여야 해요`);
      }
      case "address": {
        const s = String(v ?? "");
        if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s;
        throw new ApiError(400, `[${inp.label}] 은 지갑 주소여야 해요`);
      }
      default:
        throw new ApiError(400, `알 수 없는 타입 ${type}`);
    }
  });
}
