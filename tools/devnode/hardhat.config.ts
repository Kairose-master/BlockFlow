import type { HardhatUserConfig } from "hardhat/config";

// 컴파일은 solc-js/forge 가 하므로 여기서는 JSON-RPC 노드 역할만 한다.
const config: HardhatUserConfig = {
  solidity: "0.8.28",
  paths: { sources: "./contracts-empty" },
};

export default config;
