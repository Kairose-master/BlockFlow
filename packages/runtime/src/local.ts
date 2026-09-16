/**
 * local.ts — @ethereumjs/vm 위의 인메모리 체인 어댑터. 테스트·"미리보기" 실행용 (V5 와 별개로 실제 EVM 의미론 확인).
 *
 * 개인키로 서명하는 EOA 모델이다. 실제 체인 어댑터(Phase 3)는 스마트 계정/대납으로 서명 경로만 바꾸고
 * ProcessAdapter 인터페이스는 그대로 둔다.
 */
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createLegacyTx } from "@ethereumjs/tx";
import { Address as EjsAddress, bytesToHex, createAccount, createAddressFromPrivateKey, hexToBytes } from "@ethereumjs/util";
import { createVM, runTx, type VM } from "@ethereumjs/vm";
import { createBlock } from "@ethereumjs/block";
import { type Abi, decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeDeployData, encodeFunctionData, getAddress } from "viem";
import {
  type Address, type CompiledProcess, type DecodedEvent, type ProcessAdapter, type Signer, type Simulation,
  SimulationFailed, type TxReceipt,
} from "./adapter";
import { translateError } from "./errors";

export interface LocalSigner extends Signer {
  pk: Uint8Array;
}

/** 결정적 테스트 계정: seed → 개인키 → 주소 (체크섬). */
export function localSigner(seed: number): LocalSigner {
  const pk = hexToBytes(`0x${seed.toString(16).padStart(64, "0")}`);
  return { pk, address: getAddress(createAddressFromPrivateKey(pk).toString()) };
}

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });

interface LogEntry extends DecodedEvent {
  address: Address;
  blockNumber: bigint;
}

export class LocalEvmAdapter implements ProcessAdapter {
  readonly chainId = 31337;
  private nonces = new Map<string, bigint>();
  private logs: LogEntry[] = [];
  private block = 0n;
  /** 시각 오프셋(초): 개발용 "시간 빨리 감기" (타이머 만료 시험). */
  timeOffset = 0;

  /** 현재 체인 시각 (초) */
  now(): number {
    return Math.floor(Date.now() / 1000) + this.timeOffset;
  }

  private nextBlock() {
    return createBlock({ header: { number: this.block + 1n, timestamp: BigInt(this.now()), gasLimit: 30_000_000n, baseFeePerGas: 7n } }, { common });
  }
  private watchers: { address: Address; abi: Abi; cb: (e: DecodedEvent & { blockNumber: bigint }) => void }[] = [];

  private constructor(private readonly vm: VM) {}

  static async create(signers: Signer[]): Promise<LocalEvmAdapter> {
    const vm = await createVM({ common });
    for (const s of signers) await vm.stateManager.putAccount(new EjsAddress(hexToBytes(s.address)), createAccount({ balance: 10n ** 21n }));
    return new LocalEvmAdapter(vm);
  }

  private nonce(addr: string): bigint {
    const n = this.nonces.get(addr) ?? 0n;
    this.nonces.set(addr, n + 1n);
    return n;
  }

  private async run(from: LocalSigner, to: Address | undefined, data: `0x${string}`, commit: boolean) {
    const tx = createLegacyTx(
      { nonce: commit ? this.nonce(from.address) : (this.nonces.get(from.address) ?? 0n), gasLimit: 5_000_000n, gasPrice: 10n, to: to ? new EjsAddress(hexToBytes(to)) : undefined, data: hexToBytes(data), value: 0n },
      { common },
    ).sign(from.pk);
    const hash = bytesToHex(tx.hash()) as `0x${string}`;
    const block = this.nextBlock();
    if (!commit) {
      // 시뮬레이션: 상태를 체크포인트로 감싸고 되돌린다.
      await this.vm.stateManager.checkpoint();
      try {
        return { r: await runTx(this.vm, { tx, block }), hash };
      } finally {
        await this.vm.stateManager.revert();
      }
    }
    const r = await runTx(this.vm, { tx, block });
    this.block += 1n;
    return { r, hash };
  }

  private decodeEvents(abi: Abi, logs: [Uint8Array, Uint8Array[], Uint8Array][] | undefined): LogEntry[] {
    return (logs ?? []).map(([addr, topics, data]) => {
      const d = decodeEventLog({ abi, topics: topics.map((t) => bytesToHex(t)) as [`0x${string}`, ...`0x${string}`[]], data: bytesToHex(data) as `0x${string}` });
      return { name: d.eventName ?? "?", args: (d.args ?? {}) as Record<string, unknown>, address: getAddress(bytesToHex(addr)), blockNumber: this.block };
    });
  }

  /** 주소에 런타임 코드를 심는다 (데모 토큰 등). 실제 체인에는 없는 개발용 기능. */
  async etch(address: Address, runtimeCode: `0x${string}`): Promise<void> {
    const addr = new EjsAddress(hexToBytes(address));
    if (!(await this.vm.stateManager.getAccount(addr))) await this.vm.stateManager.putAccount(addr, createAccount({ balance: 0n }));
    await this.vm.stateManager.putCode(addr, hexToBytes(runtimeCode));
  }

  async deploy(compiled: CompiledProcess, owner: Signer) {
    const from = owner as LocalSigner;
    const data = encodeDeployData({ abi: compiled.abi, bytecode: compiled.bytecode, args: [owner.address] });
    const { r, hash } = await this.run(from, undefined, data, true);
    if (r.execResult.exceptionError || !r.createdAddress) throw new Error(`배포 실패: ${r.execResult.exceptionError?.error}`);
    const address = getAddress(r.createdAddress.toString());
    return { address, receipt: { hash, gasUsed: r.totalGasSpent, events: this.decodeEvents(compiled.abi, r.execResult.logs) } };
  }

  async hasCode(address: Address): Promise<boolean> {
    const code = await this.vm.stateManager.getCode(new EjsAddress(hexToBytes(address)));
    return code.length > 0;
  }

  async read(address: Address, abi: Abi, fn: string, args: readonly unknown[] = []): Promise<unknown> {
    const data = encodeFunctionData({ abi, functionName: fn, args: args as unknown[] });
    const r = await this.vm.evm.runCall({ to: new EjsAddress(hexToBytes(address)), data: hexToBytes(data), gasLimit: 5_000_000n, block: this.nextBlock() });
    if (r.execResult.exceptionError) throw new Error(`읽기 실패: ${r.execResult.exceptionError.error}`);
    return decodeFunctionResult({ abi, functionName: fn, data: bytesToHex(r.execResult.returnValue) as `0x${string}` });
  }

  async simulate(address: Address, abi: Abi, fn: string, args: readonly unknown[], from: Signer): Promise<Simulation> {
    const data = encodeFunctionData({ abi, functionName: fn, args: args as unknown[] });
    const { r } = await this.run(from as LocalSigner, address, data, false);
    const err = r.execResult.exceptionError;
    if (!err) return { ok: true, gas: r.totalGasSpent };
    try {
      const d = decodeErrorResult({ abi, data: bytesToHex(r.execResult.returnValue) as `0x${string}` });
      return { ok: false, error: { name: d.errorName, args: [...(d.args ?? [])] } };
    } catch {
      return { ok: false, error: { name: err.error, args: [] } };
    }
  }

  async send(address: Address, abi: Abi, fn: string, args: readonly unknown[], from: Signer): Promise<TxReceipt> {
    const sim = await this.simulate(address, abi, fn, args, from);
    if (!sim.ok) throw new SimulationFailed(sim.error, translateError(sim.error).message);
    const data = encodeFunctionData({ abi, functionName: fn, args: args as unknown[] });
    const { r, hash } = await this.run(from as LocalSigner, address, data, true);
    if (r.execResult.exceptionError) throw new Error(`시뮬레이션은 통과했는데 전송이 실패했습니다: ${r.execResult.exceptionError.error}`);
    const events = this.decodeEvents(abi, r.execResult.logs);
    this.logs.push(...events);
    for (const w of this.watchers) for (const e of events) if (e.address === w.address) w.cb(e);
    return { hash, gasUsed: r.totalGasSpent, events };
  }

  watch(address: Address, abi: Abi, onEvent: (e: DecodedEvent & { blockNumber: bigint }) => void, fromBlock = 0n): () => void {
    for (const e of this.logs) if (e.address === address && e.blockNumber >= fromBlock) onEvent(e);
    const w = { address, abi, cb: onEvent };
    this.watchers.push(w);
    return () => {
      this.watchers = this.watchers.filter((x) => x !== w);
    };
  }
}
