"use client";
import dynamic from "next/dynamic";

const Board = dynamic(() => import("./Board").then((m) => m.Board), { ssr: false, loading: () => <div className="p-6 text-sm text-gray-500">보드를 불러오는 중…</div> });

export function BoardLoader({ address }: { address: string }) {
  return <Board address={address} />;
}
