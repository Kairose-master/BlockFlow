/**
 * @ethereumjs/vm 10 위에서 컨트랙트를 배포하고 서명된 트랜잭션을 실행하는 최소 하네스 (가이드 7.6).
 */
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createLegacyTx } from "@ethereumjs/tx";
import { Address, createAccount, createAddressFromPrivateKey, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { createVM, runTx, type VM } from "@ethereumjs/vm";
import { type Abi, decodeErrorResult, decodeEventLog, encodeDeployData, encodeFunctionData, getAddress } from "viem";

export interface Account {
  name: string;
  pk: Uint8Array;
  address: Address;
  hex: `0x${string}`;
  nonce: bigint;
}

export interface TxResult {
  ok: boolean;
  gas: bigint;
  /** revert 시 디코딩한 커스텀 에러 (예: "TaskNotEnabled(1,2)"). */
  error?: string;
  /** 이벤트 (예: "MarkingChanged(1,4)"). */
  events: string[];
  returnData: `0x${string}`;
}

const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });

export function account(name: string, seed: number): Account {
  const pk = hexToBytes(`0x${seed.toString(16).padStart(64, "0")}`);
  const address = createAddressFromPrivateKey(pk);
  // viem 은 주소를 체크섬 형식으로 디코딩하므로 hex 도 체크섬으로 맞춘다.
  return { name, pk, address, hex: getAddress(address.toString()), nonce: 0n };
}

export class Harness {
  private constructor(
    readonly vm: VM,
    readonly abi: Abi,
  ) {}

  static readonly MOCK_ERC20_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] < amount || balanceOf[from] < amount) return false;
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}`;

  static async create(abi: Abi, accounts: Account[]): Promise<Harness> {
    const vm = await createVM({ common });
    for (const a of accounts) {
      await vm.stateManager.putAccount(a.address, createAccount({ balance: 10n ** 21n }));
    }
    return new Harness(vm, abi);
  }

  private async send(from: Account, to: Address | undefined, data: `0x${string}`): Promise<TxResult & { created?: Address }> {
    const tx = createLegacyTx(
      { nonce: from.nonce, gasLimit: 5_000_000n, gasPrice: 10n, to, data: hexToBytes(data), value: 0n },
      { common },
    ).sign(from.pk);
    from.nonce += 1n;
    const r = await runTx(this.vm, { tx });
    const err = r.execResult.exceptionError;
    const returnData = bytesToHex(r.execResult.returnValue) as `0x${string}`;
    const events = r.execResult.logs?.map((log) => this.formatEvent(log)) ?? [];
    let error: string | undefined;
    if (err) {
      try {
        const d = decodeErrorResult({ abi: this.abi, data: returnData });
        error = `${d.errorName}(${(d.args ?? []).map(String).join(",")})`;
      } catch {
        error = err.error;
      }
    }
    return { ok: !err, gas: r.totalGasSpent, error, events, returnData, created: r.createdAddress };
  }

  private formatEvent(log: [Uint8Array, Uint8Array[], Uint8Array]): string {
    const [, topics, data] = log;
    const d = decodeEventLog({
      abi: this.abi,
      topics: topics.map((t) => bytesToHex(t)) as [`0x${string}`, ...`0x${string}`[]],
      data: bytesToHex(data) as `0x${string}`,
    });
    const args = d.args as Record<string, unknown> | undefined;
    const vals = args ? Object.values(args).map((v) => (typeof v === "bigint" ? v.toString() : String(v))) : [];
    return `${d.eventName}(${vals.join(",")})`;
  }

  /** 주소에 런타임 코드를 심는다 (vm.etch 와 같다). L1 결제 테스트의 토큰 목 배치용. */
  async etch(address: `0x${string}`, runtimeCode: `0x${string}`): Promise<Address> {
    const addr = new Address(hexToBytes(address));
    await this.vm.stateManager.putAccount(addr, createAccount({ balance: 0n }));
    await this.vm.stateManager.putCode(addr, hexToBytes(runtimeCode));
    return addr;
  }

  /** 다른 ABI 의 컨트랙트 호출 (토큰 목 등) */
  async callWith(abi: Abi, from: Account, to: Address, fn: string, args: unknown[] = []): Promise<TxResult> {
    const saved = this.abi;
    (this as { abi: Abi }).abi = abi;
    try {
      return await this.send(from, to, encodeFunctionData({ abi, functionName: fn, args }));
    } finally {
      (this as { abi: Abi }).abi = saved;
    }
  }

  async deploy(from: Account, bytecode: `0x${string}`, args: unknown[]): Promise<{ address: Address; result: TxResult }> {
    const data = encodeDeployData({ abi: this.abi, bytecode, args });
    const r = await this.send(from, undefined, data);
    if (!r.ok || !r.created) throw new Error(`배포 실패: ${r.error}`);
    return { address: r.created, result: r };
  }

  async call(from: Account, to: Address, fn: string, args: unknown[] = []): Promise<TxResult> {
    return this.send(from, to, encodeFunctionData({ abi: this.abi, functionName: fn, args }));
  }
}
