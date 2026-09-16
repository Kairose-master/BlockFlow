"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 프로세스 보드 (가이드 8.1): 다이어그램 위에 인스턴스의 현재 marking 을 색칠하고 활성 태스크를 강조한다.
 * 오른쪽에 인스턴스 리스트, "새 건 시작"(C2), 담당자 교체(C4). 태스크 완료는 "할 일" 화면(C3).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import bc from "@blockflow/bpmn/moddle/bc.json";
import type { IR } from "@blockflow/ir";
import { api, short } from "@/lib/api";
import { useUser } from "./Shell";
import { TaskForm } from "./TaskForm";

interface Instance {
  id: string;
  marking: string;
  ended: boolean;
  outcome?: string;
  roles: Record<string, string>;
  enabled: { taskId: number; id: string; name: string; label: string; role: string }[];
}

interface BoardData {
  address: string;
  xml: string;
  ir: IR;
  owner: string;
  paused: boolean;
  version: number;
  supersededBy: string | null;
  instances: Instance[];
  timeline: { block: string; seq: number; instance: string; kind: string; text: string; actor?: string }[];
}

interface Accounts {
  users: { address: string; label: string }[];
}

export function Board({ address }: { address: string }) {
  const user = useUser();
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [data, setData] = useState<BoardData | null>(null);
  const [users, setUsers] = useState<Accounts["users"]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const importedXml = useRef<string>("");

  const load = useCallback(async () => {
    const d = await api<BoardData>(`/api/processes/${address}`);
    setData(d);
    setSelected((s) => s ?? d.instances[0]?.id ?? null);
  }, [address]);

  useEffect(() => {
    void load();
    void api<Accounts>("/api/accounts").then((a) => setUsers(a.users));
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [load]);

  // 뷰어 생성 + XML 임포트 (한 번)
  useEffect(() => {
    if (!ref.current || !data || importedXml.current === data.xml) return;
    viewerRef.current?.destroy();
    const viewer = new (NavigatedViewer as any)({ container: ref.current, moddleExtensions: { bc } });
    viewerRef.current = viewer;
    importedXml.current = data.xml;
    void viewer.importXML(data.xml).then(() => viewer.get("canvas").zoom("fit-viewport", "auto"));
    return () => {
      viewer.destroy();
      viewerRef.current = null;
      importedXml.current = "";
    };
  }, [data?.xml]); // eslint-disable-line react-hooks/exhaustive-deps

  // marking 색칠
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !data) return;
    const canvas = viewer.get("canvas");
    const registry = viewer.get("elementRegistry");
    for (const el of registry.getAll()) {
      for (const m of ["bf-token", "bf-enabled", "bf-done"]) if (canvas.hasMarker(el.id, m)) canvas.removeMarker(el.id, m);
    }
    const inst = data.instances.find((i) => i.id === selected);
    if (!inst) return;
    const marking = BigInt(inst.marking);
    for (const f of data.ir.flows) {
      if (f.bpmnId && (marking & (1n << BigInt(f.bit))) !== 0n && registry.get(f.bpmnId)) canvas.addMarker(f.bpmnId, "bf-token");
    }
    for (const t of inst.enabled) {
      const node = data.ir.nodes.find((n) => n.id === t.id);
      if (node?.bpmnId && registry.get(node.bpmnId)) canvas.addMarker(node.bpmnId, "bf-enabled");
    }
    if (inst.ended) {
      for (const n of data.ir.nodes) if (n.kind === "endEvent" && n.bpmnId && registry.get(n.bpmnId)) canvas.addMarker(n.bpmnId, "bf-done");
    }
  }, [data, selected]);

  const createInstance = async () => {
    if (!data) return;
    setError("");
    try {
      const r = await api<{ instance: string }>(`/api/processes/${address}/instances`, { method: "POST", body: JSON.stringify({ roles: roleChoice }) });
      setCreating(false);
      await load();
      setSelected(String(r.instance));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rebind = async (instance: string, role: string, account: string) => {
    setError("");
    try {
      await api(`/api/processes/${address}/control`, { method: "POST", body: JSON.stringify({ action: "rebind", instance, role, account }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!data) return <div className="p-6 text-sm text-gray-500">불러오는 중…</div>;
  const inst = data.instances.find((i) => i.id === selected);
  const label = (addr: string) => users.find((u) => u.address.toLowerCase() === addr.toLowerCase())?.label ?? short(addr);
  const myTasks = inst && !data.paused ? inst.enabled.filter((t) => (inst.roles[t.role] ?? "").toLowerCase() === user.toLowerCase()) : [];

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-3 text-sm">
          <span className="font-semibold text-base">{data.ir.process.name}</span>
          <span className="text-xs text-gray-500" data-testid="board-version">v{data.version}</span>
          <span className="text-xs text-gray-500 font-mono">{short(data.address)}</span>
          {data.supersededBy && <a className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 underline" href={`/processes/${data.supersededBy}`}>이전 버전 — 새 버전으로 이동</a>}
          {data.paused && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">일시정지</span>}
          <span className="flex-1" />
          <button className="btn btn-primary" onClick={() => { setRoleChoice(Object.fromEntries(data.ir.roles.map((r, i) => [r.key, users[(i + 1) % Math.max(users.length, 1)]?.address ?? ""]))); setCreating(true); }} disabled={data.paused || !!data.supersededBy} data-testid="new-instance">
            새 건 시작
          </button>
        </div>
        <div ref={ref} className="flex-1 min-h-0" data-testid="board-canvas" />
        {inst && (
          <div className="border-t border-gray-200 bg-white px-4 py-2 text-sm flex items-center gap-4" data-testid="instance-status">
            <span className="font-semibold">#{inst.id}</span>
            {inst.ended ? (
              <span className={inst.outcome === "completed" ? "text-green-700" : "text-amber-700"}>{inst.outcome === "completed" ? "정상 완료" : "중단(반려)"}</span>
            ) : (
              <span>
                지금 할 수 있는 일: {inst.enabled.length ? inst.enabled.map((t) => `[${t.label}] ← ${label(inst.roles[t.role] ?? "")}`).join(", ") : "없음"}
              </span>
            )}
          </div>
        )}
      </div>
      <aside className="w-[380px] shrink-0 border-l border-gray-200 bg-white flex flex-col min-h-0">
        {error && <p className="text-sm text-red-600 p-3 border-b border-gray-100" data-testid="board-error">{error}</p>}
        {notice && <p className="text-sm text-green-700 p-3 border-b border-gray-100" data-testid="task-done">{notice}</p>}
        {creating && (
          <div className="p-3 border-b border-gray-200" data-testid="create-dialog">
            <h3 className="font-semibold mb-2">새 건 시작 — 담당자 지정</h3>
            {data.ir.roles.map((r) => (
              <label key={r.key} className="block mb-2 text-sm">
                <span className="block text-xs text-gray-600">{r.label}</span>
                <select className="w-full rounded border border-gray-300 px-2 py-1" value={roleChoice[r.key] ?? ""} data-testid={`role-${r.key}`} onChange={(e) => setRoleChoice({ ...roleChoice, [r.key]: e.target.value })}>
                  {users.map((u) => <option key={u.address} value={u.address}>{u.label}</option>)}
                </select>
              </label>
            ))}
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => void createInstance()} data-testid="create-confirm">시작</button>
              <button className="btn" onClick={() => setCreating(false)}>취소</button>
            </div>
          </div>
        )}
        <div className="p-3 border-b border-gray-200">
          <h3 className="font-semibold text-sm mb-2">진행 건 ({data.instances.length})</h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto text-sm">
            {data.instances.map((i) => (
              <li key={i.id}>
                <button className={`w-full text-left px-2 py-1 rounded ${i.id === selected ? "bg-blue-50" : "hover:bg-gray-50"}`} onClick={() => setSelected(i.id)} data-testid={`instance-${i.id}`}>
                  #{i.id} {i.ended ? (i.outcome === "completed" ? "✓ 완료" : "✕ 중단") : `· ${i.enabled.map((t) => t.label).join(", ") || "대기"}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {inst && (
          <div className="p-3 border-b border-gray-200 text-sm">
            <h3 className="font-semibold mb-2">담당자</h3>
            {data.ir.roles.map((r) => (
              <div key={r.key} className="flex items-center gap-2 mb-1">
                <span className="w-16 text-xs text-gray-600">{r.label}</span>
                {user === data.owner && !inst.ended ? (
                  <select className="flex-1 rounded border border-gray-300 px-1 py-0.5" value={inst.roles[r.key] ?? ""} onChange={(e) => void rebind(inst.id, r.key, e.target.value)} data-testid={`rebind-${r.key}`}>
                    {users.map((u) => <option key={u.address} value={u.address}>{u.label}</option>)}
                  </select>
                ) : (
                  <span>{label(inst.roles[r.key] ?? "")}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {inst && myTasks.length > 0 && (
          <div className="p-3 border-b border-gray-200">
            <h3 className="font-semibold text-sm mb-2">내 차례</h3>
            {myTasks.map((t) => (
              <TaskForm key={t.id} address={address} ir={data.ir} instance={inst.id} task={t} onDone={(m) => { setNotice(m); void load(); }} />
            ))}
          </div>
        )}
        <div className="p-3 overflow-y-auto flex-1 min-h-0 text-sm">
          <h3 className="font-semibold mb-2">기록</h3>
          <ul className="space-y-1">
            {data.timeline.filter((t) => t.kind !== "markingChanged" && t.kind !== "roleBound" && (!selected || t.instance === selected || t.instance === "0")).slice(0, 50).map((t, i) => (
              <li key={i} className="text-gray-700">
                <span className="text-[11px] text-gray-400 font-mono mr-1">#{t.block}</span>
                {t.text}{t.actor ? ` — ${label(t.actor)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
