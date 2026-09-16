import { getEngine, handle, json } from "@/lib/engine";

export const runtime = "nodejs";

/** GET /api/accounts → 데모 사용자 목록 + 모드 */
export function GET() {
  return handle(async () => {
    const e = await getEngine();
    return json({ mode: e.mode, chainId: e.adapter.chainId, owner: e.owner.address, probe: e.probe, users: e.users.map((u) => ({ address: u.address, label: u.label })) });
  });
}
