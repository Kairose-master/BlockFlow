import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@blockflow/bpmn", "@blockflow/codegen", "@blockflow/ir", "@blockflow/validator"],
  // solc 는 8MB wasm + fs 접근이 필요하므로 번들하지 않고 런타임에 require 한다.
  serverExternalPackages: ["solc"],
  typescript: { ignoreBuildErrors: false },
  // next dev 가 앱 폴더에 AGENTS.md/CLAUDE.md 를 만들지 않게 한다 (저장소 루트의 CLAUDE.md 가 기준).
  agentRules: false,
};

export default nextConfig;
