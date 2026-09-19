import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@blockflow/bpmn", "@blockflow/codegen", "@blockflow/ir", "@blockflow/validator"],
  // solc 는 8MB wasm + fs 접근이 필요하므로 번들하지 않고 런타임에 require 한다.
  serverExternalPackages: ["solc"],
  // Vercel 같은 서버리스 배포에서 API 가 fs 로 읽는 파일(codegen Mustache 템플릿, BPMN 예시)을 함수 번들에 포함한다.
  // 런타임은 cwd 에서 위로 올라가며 packages/… 를 찾으므로 모노레포 루트 기준 상대 경로가 그대로 유지돼야 한다.
  outputFileTracingIncludes: {
    "/api/**": ["../../packages/codegen/templates/**/*", "../../packages/bpmn/examples/**/*"],
  },
  typescript: { ignoreBuildErrors: false },
  // next dev 가 앱 폴더에 AGENTS.md/CLAUDE.md 를 만들지 않게 한다 (저장소 루트의 CLAUDE.md 가 기준).
  agentRules: false,
};

export default nextConfig;
