/**
 * probe.ts — JSON-RPC 호환성 점검. 실제 체인(Base·Kaia·FISCO BCOS Ethereum 호환 레인 등)에 붙이기 전에
 * viem 어댑터가 쓰는 eth_* 메서드가 있는지, 체인 id·EVM 버전·수수료 모델이 어떤지 확인한다.
 *
 * FISCO BCOS 3.x: executor_version ≥ 2 (Ethereum 실행 레인) + feature_l2_ethereum_compat 이어야 eth_* 가 뜬다.
 * 국밀(SM2) 체인은 secp256k1 서명이 아니므로 viem 어댑터를 쓸 수 없다 → 배포 번들(콘솔/WeBASE) 경로를 쓴다.
 */
export interface ProbeResult {
  ok: boolean;
  chainId?: number;
  clientVersion?: string;
  blockNumber?: bigint;
  /** 메서드별 지원 여부 (호출이 "method not found" 류가 아니면 true) */
  methods: Record<string, boolean>;
  /** EIP-1559 (baseFeePerGas 가 블록에 있는지) */
  eip1559: boolean;
  /** 실행 EVM 이 PUSH0(Shanghai) 을 지원하는지 (eth_call 로 확인, 실패 시 undefined) */
  push0?: boolean;
  problems: string[];
}

const REQUIRED = ["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_estimateGas", "eth_call", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getLogs", "eth_gasPrice"] as const;
const OPTIONAL = ["eth_feeHistory", "eth_maxPriorityFeePerGas", "web3_clientVersion"] as const;

async function rpc(url: string, method: string, params: unknown[] = []): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()) as { result?: unknown; error?: { code: number; message: string } };
}

function unsupported(e: { code: number; message: string } | undefined): boolean {
  if (!e) return false;
  return e.code === -32601 || /not (found|supported|implemented)|unknown method|does not exist/i.test(e.message);
}

export async function probeRpc(url: string): Promise<ProbeResult> {
  const result: ProbeResult = { ok: true, methods: {}, eip1559: false, problems: [] };
  const check = async (method: string, params: unknown[] = []) => {
    try {
      const r = await rpc(url, method, params);
      const supported = !unsupported(r.error);
      result.methods[method] = supported;
      return supported ? r : undefined;
    } catch (e) {
      result.methods[method] = false;
      result.problems.push(`${method}: ${(e as Error).message}`);
      return undefined;
    }
  };

  const chainId = await check("eth_chainId");
  if (chainId?.result) result.chainId = Number(chainId.result as string);
  const bn = await check("eth_blockNumber");
  if (bn?.result) result.blockNumber = BigInt(bn.result as string);
  const block = await check("eth_getBlockByNumber", ["latest", false]);
  const header = block?.result as { baseFeePerGas?: string } | null | undefined;
  result.eip1559 = !!header?.baseFeePerGas;
  const zero = "0x0000000000000000000000000000000000000000";
  await check("eth_getTransactionCount", [zero, "latest"]);
  await check("eth_estimateGas", [{ to: zero, data: "0x" }]);
  await check("eth_call", [{ to: zero, data: "0x" }, "latest"]);
  await check("eth_gasPrice");
  await check("eth_getLogs", [{ fromBlock: "0x0", toBlock: "0x0", address: zero }]);
  await check("eth_getTransactionReceipt", [`0x${"0".repeat(64)}`]);
  // eth_sendRawTransaction 은 잘못된 RLP 를 보내 "method not found" 와 "invalid tx" 를 구분한다
  await check("eth_sendRawTransaction", ["0x00"]);
  for (const m of OPTIONAL) await check(m, m === "eth_feeHistory" ? ["0x1", "latest", []] : []);
  const cv = await rpc(url, "web3_clientVersion").catch(() => undefined);
  if (cv?.result) result.clientVersion = String(cv.result);
  // PUSH0: 런타임 코드 0x5f00 (PUSH0, STOP) 을 eth_call 의 stateOverride 없이 검증하긴 어려우므로, 배포 없이 판단 가능한
  // 방법으로 "PUSH0 을 포함한 init code 를 eth_estimateGas" 한다. 지원하지 않으면 invalid opcode 로 실패한다.
  try {
    const r = await rpc(url, "eth_estimateGas", [{ data: "0x5f5f" }]); // PUSH0 PUSH0
    result.push0 = !r.error;
  } catch {
    /* 알 수 없음 */
  }
  for (const m of REQUIRED) if (!result.methods[m]) result.problems.push(`필수 메서드 ${m} 를 지원하지 않습니다`);
  result.ok = result.problems.length === 0;
  return result;
}

/** 사람이 읽는 요약 */
export function describeProbe(p: ProbeResult): string[] {
  const lines = [
    `체인 id ${p.chainId ?? "?"}${p.clientVersion ? ` · ${p.clientVersion}` : ""}${p.blockNumber !== undefined ? ` · 블록 ${p.blockNumber}` : ""}`,
    `수수료: ${p.eip1559 ? "EIP-1559 (baseFee)" : "레거시 gasPrice"}`,
    `EVM: ${p.push0 === undefined ? "PUSH0 확인 불가" : p.push0 ? "Shanghai 이상 (PUSH0 지원)" : "PUSH0 미지원 → BLOCKFLOW_EVM_VERSION=paris 로 컴파일하세요"}`,
  ];
  for (const x of p.problems) lines.push(`⚠ ${x}`);
  return lines;
}
