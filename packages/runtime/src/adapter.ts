/**
 * adapter.ts — 배포·서명 어댑터 인터페이스 (가이드 9.5).
 *
 * IR·생성기는 체인 경로(Base + paymaster / Kaia fee delegation)와 무관하고, 배포·서명·구독만 어댑터가 다르다.
 * 그래서 인터페이스를 먼저 고정한다. 모든 쓰기는 "시뮬레이션 → 성공한 호출만 전송" 을 따른다 (8.4, 9.4).
 *
 * 구현:
 *   - LocalEvmAdapter (local.ts)  : @ethereumjs/vm 위의 인메모리 체인. 테스트·미리보기용.
 *   - (Phase 3) ViemAdapter       : viem + 스마트 계정/paymaster (Base) 또는 @kaiachain/viem-ext (Kaia).
 */
import type { Abi, Hex } from "viem";

export type Address = `0x${string}`;

export interface CompiledProcess {
  /** 컨트랙트 이름 (= IR process.id) */
  name: string;
  abi: Abi;
  bytecode: Hex;
}

/** 어댑터가 호출자를 식별하는 방법. 로컬은 개인키, 실제 체인은 스마트 계정/세션. */
export interface Signer {
  address: Address;
}

export interface TxReceipt {
  hash: Hex;
  gasUsed: bigint;
  /** 디코딩된 이벤트: { name, args } */
  events: DecodedEvent[];
}

export interface DecodedEvent {
  name: string;
  args: Record<string, unknown>;
}

/** 시뮬레이션 결과. ok=false 면 error 에 커스텀 에러 이름과 인자가 들어 있다 (translate 로 번역). */
export type Simulation =
  | { ok: true; gas: bigint }
  | { ok: false; error: ContractError };

export interface ContractError {
  name: string;
  args: unknown[];
}

export class SimulationFailed extends Error {
  constructor(public readonly contractError: ContractError, message: string) {
    super(message);
    this.name = "SimulationFailed";
  }
}

export interface ProcessAdapter {
  readonly chainId: number;

  /** C1: 프로세스 배포. owner 가 소유자가 된다. */
  deploy(compiled: CompiledProcess, owner: Signer): Promise<{ address: Address; receipt: TxReceipt }>;

  /** 읽기 전용 호출 (instances(id), enabledTasks(id), roleOf(...)). */
  read(address: Address, abi: Abi, fn: string, args?: readonly unknown[]): Promise<unknown>;

  /** 쓰기 호출을 시뮬레이션만 한다. 가스를 쓰지 않는다. */
  simulate(address: Address, abi: Abi, fn: string, args: readonly unknown[], from: Signer): Promise<Simulation>;

  /**
   * 쓰기 호출. 항상 simulate 를 먼저 실행하고, 실패하면 SimulationFailed 를 던지며 트랜잭션을 보내지 않는다.
   * C2 createInstance / C3 태스크 함수 / C4 rebindRole / C5 setPaused 가 전부 이 경로를 탄다.
   */
  send(address: Address, abi: Abi, fn: string, args: readonly unknown[], from: Signer): Promise<TxReceipt>;

  /** 이벤트 구독. 반환 함수를 호출하면 구독을 끊는다. 재시작 시 fromBlock 부터 재생 (8.3). */
  watch(address: Address, abi: Abi, onEvent: (e: DecodedEvent & { blockNumber: bigint }) => void, fromBlock?: bigint): () => void;
}
