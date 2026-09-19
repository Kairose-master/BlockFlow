"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, short } from "@/lib/api";
import { useUser } from "@/components/Shell";
import { useI18n } from "@/lib/i18n";

interface Card {
  address: string;
  id: string;
  name: string;
  roles: { key: string; label: string }[];
  owner: string;
  paused: boolean;
  instanceCount: number;
  active: number;
  version: number;
  supersededBy: string | null;
}

export default function ProcessesPage() {
  const { tr } = useI18n();
  const user = useUser();
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState("");
  const load = () => api<Card[]>("/api/processes").then(setCards).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, []);

  const togglePause = async (c: Card) => {
    setError("");
    try {
      await api(`/api/processes/${c.address}/control`, { method: "POST", body: JSON.stringify({ action: "pause", paused: !c.paused }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{tr("내 프로세스", "Processes")}</h1>
      <p className="text-sm text-gray-500 mb-4">{tr("\"그리기\" 에서 컴파일한 다이어그램을 배포하면 여기에 카드로 나타나요.", "Deploy a compiled diagram from Design to manage it here.")}</p>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {cards.length === 0 && <p className="text-sm text-gray-500" data-testid="no-processes">{tr("아직 배포한 프로세스가 없어요.", "No processes have been deployed yet.")} <Link className="text-blue-600 underline" href="/">{tr("그리러 가기", "Design one")}</Link></p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => (
          <div key={c.address} className="border border-gray-200 rounded-lg bg-white p-4" data-testid="process-card">
            <div className="flex items-start justify-between">
              <div>
                <Link href={`/processes/${c.address}`} className="text-lg font-semibold hover:underline">{c.name}</Link>
                <span className="ml-2 text-xs text-gray-500" data-testid="version">v{c.version}</span>
                <div className="text-xs text-gray-500 font-mono">{c.id} · {short(c.address)}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${c.supersededBy ? "bg-gray-100 text-gray-600" : c.paused ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                {c.supersededBy ? tr("이전 버전", "Previous version") : c.paused ? tr("일시정지", "Paused") : tr("운영 중", "Running")}
              </span>
            </div>
            <div className="mt-2 text-sm">{tr("역할", "Roles")}: {c.roles.map((r) => r.label).join(", ")}</div>
            <div className="mt-1 text-sm">{tr(`진행 중 ${c.active}건 / 전체 ${c.instanceCount}건`, `${c.active} active / ${c.instanceCount} total`)}</div>
            {c.supersededBy && (
              <div className="mt-1 text-xs text-gray-500" data-testid="superseded">
                {tr("새 건은", "Start new instances in the")} <Link href={`/processes/${c.supersededBy}`} className="text-blue-600 underline">{tr("새 버전", "new version")}</Link>{tr("에서 시작해요. 진행 중인 건은 여기서 끝낼 수 있어요.", ". Existing instances may finish here.")}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Link href={`/processes/${c.address}`} className="btn">{tr("보드 열기", "Open board")}</Link>
              {user === c.owner && <button className="btn" onClick={() => void togglePause(c)}>{c.paused ? tr("재개", "Resume") : tr("일시정지", "Pause")}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
