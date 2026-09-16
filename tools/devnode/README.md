# @blockflow/devnode

Hardhat 3 를 JSON-RPC 노드로만 쓴다 (컴파일은 solc-js/forge). `packages/runtime/test/viem.test.ts` 가 이 디렉터리에서 노드를 스폰한다.

```bash
pnpm --filter @blockflow/devnode node    # http://127.0.0.1:8545, chainId 31337, 잘 알려진 테스트 키 20개
```
