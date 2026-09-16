/**
 * viem.ts — 실제 JSON-RPC 체인용 어댑터 (가이드 9장 경로 A 의 EOA 버전).
 *
 * 서명자는 viem Account (개인키·스마트 계정·외부 지갑 모두 Account 인터페이스로 들어온다).
 * 가스 스폰서(paymaster / Kaia fee delegation) 는 Account 와 transport 조합으로 뒤에 붙인다 — 이 클래스의
 * simulate → send 흐름과 watch() 는 그대로 쓴다.
 *
 * watch(): WebSocket 이 없으면 폴링(eth_getLogs) 으로 fromBlock 부터 재생한다 (8.3).
 */
import {
  type Abi, type Account, type Chain, type Hex, type PublicClient, type Transport, type WalletClient,
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeEventLog, http,
} from "viem";
import { type Address, type CompiledProcess, type DecodedEvent, type ProcessAdapter, type Signer, type Simulation, SimulationFailed, type TxReceipt } from "./adapter";
import { translateError } from "./errors";

export interface ViemSigner extends Signer {
  account: Account;
}

export interface ViemAdapterOptions {
  rpcUrl: string;
  chain: Chain;
  /** 폴링 간격 (ms). 기본 1000 */
  pollingInterval?: number;
}

export class ViemAdapter implements ProcessAdapter {
  readonly chainId: number;
  private readonly publicClient: PublicClient<Transport, Chain>;
  private readonly wallets = new Map<string, WalletClient<Transport, Chain, Account>>();

  constructor(private readonly opts: ViemAdapterOptions) {
    this.chainId = opts.chain.id;
    this.publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpcUrl), pollingInterval: opts.pollingInterval ?? 1000 });
  }

  private wallet(from: Signer): WalletClient<Transport, Chain, Account> {
    const s = from as ViemSigner;
    if (!s.account) throw new Error("ViemAdapter 에는 viem Account 를 가진 서명자가 필요합니다");
    let w = this.wallets.get(s.address);
    if (!w) {
      w = createWalletClient({ account: s.account, chain: this.opts.chain, transport: http(this.opts.rpcUrl) });
      this.wallets.set(s.address, w);
    }
    return w;
  }

  private decodeLogs(abi: Abi, logs: { topics: readonly Hex[]; data: Hex; blockNumber?: bigint | null }[]): (DecodedEvent & { blockNumber: bigint })[] {
    const out: (DecodedEvent & { blockNumber: bigint })[] = [];
    for (const log of logs) {
      try {
        const d = decodeEventLog({ abi, topics: log.topics as [Hex, ...Hex[]], data: log.data });
        out.push({ name: d.eventName ?? "?", args: (d.args ?? {}) as Record<string, unknown>, blockNumber: log.blockNumber ?? 0n });
      } catch {
        /* 다른 컨트랙트의 이벤트 */
      }
    }
    return out;
  }

  async deploy(compiled: CompiledProcess, owner: Signer) {
    const w = this.wallet(owner);
    const hash = await w.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode, args: [owner.address] });
    const r = await this.publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error(`배포 실패: ${hash}`);
    return { address: r.contractAddress, receipt: { hash, gasUsed: r.gasUsed, events: this.decodeLogs(compiled.abi, r.logs) }, block: r.blockNumber };
  }

  async read(address: Address, abi: Abi, fn: string, args: readonly unknown[] = []): Promise<unknown> {
    return this.publicClient.readContract({ address, abi, functionName: fn, args: args as unknown[] });
  }

  async simulate(address: Address, abi: Abi, fn: string, args: readonly unknown[], from: Signer): Promise<Simulation> {
    try {
      const { request } = await this.publicClient.simulateContract({ address, abi, functionName: fn, args: args as unknown[], account: from.address });
      const gas = request.gas ?? (await this.publicClient.estimateContractGas({ address, abi, functionName: fn, args: args as unknown[], account: from.address }));
      return { ok: true, gas };
    } catch (e) {
      if (e instanceof BaseError) {
        const reverted = e.walk((err) => err instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
        if (reverted?.data) return { ok: false, error: { name: reverted.data.errorName, args: [...(reverted.data.args ?? [])] } };
        return { ok: false, error: { name: e.shortMessage, args: [] } };
      }
      throw e;
    }
  }

  async send(address: Address, abi: Abi, fn: string, args: readonly unknown[], from: Signer): Promise<TxReceipt> {
    const sim = await this.simulate(address, abi, fn, args, from);
    if (!sim.ok) throw new SimulationFailed(sim.error, translateError(sim.error).message);
    const w = this.wallet(from);
    const hash = await w.writeContract({ address, abi, functionName: fn, args: args as unknown[] });
    const r = await this.publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`시뮬레이션은 통과했는데 전송이 실패했습니다: ${hash}`);
    return { hash, gasUsed: r.gasUsed, events: this.decodeLogs(abi, r.logs) };
  }

  watch(address: Address, abi: Abi, onEvent: (e: DecodedEvent & { blockNumber: bigint }) => void, fromBlock = 0n): () => void {
    let stopped = false;
    let next = fromBlock;
    const poll = async () => {
      if (stopped) return;
      try {
        const head = await this.publicClient.getBlockNumber();
        if (head >= next) {
          const logs = await this.publicClient.getLogs({ address, fromBlock: next, toBlock: head });
          for (const e of this.decodeLogs(abi, logs)) onEvent(e);
          next = head + 1n;
        }
      } catch {
        /* 다음 폴링에서 재시도 */
      }
      if (!stopped) setTimeout(() => void poll(), this.opts.pollingInterval ?? 1000);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }

  async blockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }
}
