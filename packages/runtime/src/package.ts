/**
 * package.ts — 서명 없는 트랜잭션 패키지.
 *
 * 소유자 제어(C2 인스턴스 생성·C4 담당자 교체·C5 일시정지)나 태스크 완료(C3)를 도구 밖에서 실행해야 할 때
 * (Safe 같은 다중서명 지갑, 인덱서·백엔드 다운 시의 폴백 — 3.3 신뢰 경계) 쓸 수 있도록
 * "무엇을 어디에 보내는지" 를 사람이 읽을 수 있는 JSON 으로 내보낸다. 도구는 서명·전송하지 않는다.
 *
 * Safe Transaction Builder 의 배치 JSON 형식(txbuilder)과 호환되게 만든다.
 */
import { type Abi, type AbiFunction, encodeFunctionData, getAbiItem } from "viem";
import type { IR } from "@blockflow/ir";
import type { Address } from "./adapter.js";

export interface UnsignedTx {
  to: Address;
  value: "0";
  data: `0x${string}`;
  /** Safe Transaction Builder 가 보여주는 함수 설명 */
  contractMethod: { name: string; payable: false; inputs: { name: string; type: string; internalType?: string }[] };
  contractInputsValues: Record<string, string>;
}

export interface TxPackage {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: { name: string; description: string; txBuilderVersion: string; createdFromSafeAddress: string; createdFromOwnerAddress: string; checksum: string };
  transactions: UnsignedTx[];
}

export interface PackageOptions {
  chainId: number;
  /** 사람이 읽는 설명 (없으면 IR 에서 만든다) */
  description?: string;
  createdAt?: number;
}

function stringify(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => (typeof x === "bigint" ? x.toString() : x)));
  return String(v);
}

/** 한 건의 함수 호출을 서명 없는 트랜잭션으로. */
export function buildUnsignedTx(abi: Abi, to: Address, fn: string, args: readonly unknown[]): UnsignedTx {
  const item = getAbiItem({ abi, name: fn }) as AbiFunction | undefined;
  if (!item || item.type !== "function") throw new Error(`ABI 에 함수 '${fn}' 가 없습니다`);
  const inputsValues: Record<string, string> = {};
  item.inputs.forEach((inp, i) => {
    inputsValues[inp.name ?? `arg${i}`] = stringify(args[i]);
  });
  return {
    to,
    value: "0",
    data: encodeFunctionData({ abi, functionName: fn, args: args as unknown[] }),
    contractMethod: {
      name: item.name,
      payable: false,
      inputs: item.inputs.map((inp) => ({ name: inp.name ?? "", type: inp.type, ...(inp.internalType ? { internalType: inp.internalType } : {}) })),
    },
    contractInputsValues: inputsValues,
  };
}

/** 여러 호출을 Safe Transaction Builder 배치 JSON 으로. */
export function buildTxPackage(ir: IR, txs: UnsignedTx[], opts: PackageOptions): TxPackage {
  const description = opts.description ?? txs.map((t) => describe(ir, t.contractMethod.name, t.contractInputsValues)).join("; ");
  return {
    version: "1.0",
    chainId: String(opts.chainId),
    createdAt: opts.createdAt ?? Date.now(),
    meta: {
      name: `${ir.process.name} (${ir.process.id})`,
      description,
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: "",
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: txs,
  };
}

/** 함수 호출을 비전문가 문장으로. */
export function describe(ir: IR, fn: string, inputs: Record<string, string>): string {
  const id = inputs.id ? `#${inputs.id}` : "";
  switch (fn) {
    case "createInstance":
      return `${ir.process.name} 새 건 시작 (담당자 ${ir.roles.map((r) => r.label).join(", ")})`;
    case "rebindRole": {
      const role = ir.roles.find((r) => r.key === inputs.role || roleHashOf(r.key) === inputs.role?.toLowerCase());
      return `${id} [${role?.label ?? inputs.role}] 담당자를 ${inputs.account} 로 교체`;
    }
    case "setPaused":
      return inputs.p === "true" ? `${ir.process.name} 일시정지` : `${ir.process.name} 재개`;
    default: {
      const task = ir.nodes.find((n) => n.kind === "userTask" && n.name === fn);
      if (task?.kind === "userTask") {
        const vals = task.inputs.map((i) => `${i.label}=${inputs[i.variable] ?? "?"}`).join(", ");
        return `${id} [${task.label}] 완료${vals ? ` (${vals})` : ""}`;
      }
      return `${id} ${fn}`;
    }
  }
}

import { keccak256, stringToHex } from "viem";
function roleHashOf(key: string): string {
  return keccak256(stringToHex(key)).toLowerCase();
}
