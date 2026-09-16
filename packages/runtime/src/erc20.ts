/**
 * erc20.ts — L1 결제 태스크가 쓰는 최소 ERC-20 ABI 와 데모 토큰 소스.
 * 실제 체인에서는 기존 토큰을 쓰고, 로컬 모드에서는 데모 토큰을 참조 주소에 심는다.
 */
import type { Abi } from "viem";

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "a", type: "uint256" }], outputs: [] },
  { type: "function", name: "transferFrom", stateMutability: "nonpayable", inputs: [{ name: "f", type: "address" }, { name: "t", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

export const DEMO_ERC20_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract DemoERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] < amount || balanceOf[from] < amount) return false;
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}`;

/** IR 에서 결제 태스크가 참조하는 토큰 주소 목록 */
export function paymentTokens(ir: { nodes: { kind: string; payment?: { token: string } }[] }): string[] {
  return [...new Set(ir.nodes.filter((n) => n.kind === "userTask" && n.payment).map((n) => n.payment!.token.toLowerCase()))];
}
