"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Entry {
  block: string;
  seq: number;
  instance: string;
  kind: string;
  text: string;
  actorLabel?: string;
  process: { address: string; name: string };
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const load = () => api<Entry[]>("/api/history").then(setEntries).catch(() => setEntries([]));
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">기록</h1>
      <p className="text-sm text-gray-500 mb-4">모든 완료 이벤트는 온체인 로그로 남아요. 누가·언제(블록)·무엇을.</p>
      {entries.length === 0 && <p className="text-sm text-gray-500">아직 기록이 없어요.</p>}
      <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
        {entries.map((e, i) => (
          <li key={i} className="px-4 py-2 text-sm flex items-center gap-3" data-testid="history-entry">
            <span className="text-[11px] text-gray-400 font-mono w-14">블록 {e.block}</span>
            <Link href={`/processes/${e.process.address}`} className="text-xs text-gray-500 hover:underline w-24 truncate">{e.process.name}</Link>
            <span className="flex-1">{e.text}</span>
            {e.actorLabel && <span className="text-xs text-gray-500">{e.actorLabel}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
