/** 테스트용 solc-js 래퍼. 가이드 6.6 설정: optimizer 200, evmVersion cancun. */
import { createRequire } from "node:module";
import type { Abi } from "viem";

const require = createRequire(import.meta.url);
// solc 는 CJS 모듈이라 require 로 읽는다.
const solc = require("solc") as { compile: (input: string) => string; version: () => string };

export interface Compiled {
  abi: Abi;
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  /** severity 무관 모든 진단 메시지. 생성 코드는 0개여야 한다 (7.5). */
  diagnostics: string[];
}

const cache = new Map<string, Compiled>();

export function solcVersion(): string {
  return solc.version();
}

/** 배포 대상 체인의 EVM 버전. 가이드 기본은 cancun; FISCO BCOS 3.7 LTS 등 구버전 노드는 paris/shanghai 로 내린다. */
export type EvmVersion = "paris" | "shanghai" | "cancun";

export function compile(source: string, contractName: string, evmVersion: EvmVersion = "cancun"): Compiled {
  const key = `${contractName}\0${evmVersion}\0${source}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const input = {
    language: "Solidity",
    sources: { [`${contractName}.sol`]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts?: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }>>;
  };
  const diagnostics = (out.errors ?? []).map((e) => `${e.severity}: ${e.formattedMessage}`);
  const c = out.contracts?.[`${contractName}.sol`]?.[contractName];
  if (!c) throw new Error(`컴파일 실패:\n${diagnostics.join("\n")}`);
  const result: Compiled = {
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
    diagnostics,
  };
  cache.set(key, result);
  return result;
}
