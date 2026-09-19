"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { IR } from "@blockflow/ir";
import { api } from "@/lib/api";
import { useUser } from "@/components/Shell";
import { TaskForm } from "@/components/TaskForm";
import { useI18n } from "@/lib/i18n";

interface Card {
  process: { address: string; name: string; id: string };
  instance: string;
  task: { taskId: number; id: string; name: string; label: string; role: string; roleLabel: string };
}

export default function TodoPage() {
  const { tr } = useI18n();
  const user = useUser();
  const [cards, setCards] = useState<Card[]>([]);
  const [irs, setIrs] = useState<Record<string, IR>>({});
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!user) return;
    const list = await api<Card[]>("/api/todo");
    setCards(list);
    const missing = [...new Set(list.map((c) => c.process.address))].filter((a) => !irs[a]);
    for (const a of missing) {
      const d = await api<{ ir: IR }>(`/api/processes/${a}`);
      setIrs((prev) => ({ ...prev, [a]: d.ir }));
    }
  }, [user, irs]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => setNotice(""), [user]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{tr("할 일", "My tasks")}</h1>
      <p className="text-sm text-gray-500 mb-4">{tr("내가 담당자인 건 중에서 지금 내 차례인 일이에요. 값을 넣고 \"완료\" 를 누르면 끝.", "Tasks that are currently enabled and assigned to you. Enter the requested values, then complete the task.")}</p>
      {notice && <p className="text-sm text-green-700 mb-3" data-testid="task-done">{notice}</p>}
      {cards.length === 0 && <p className="text-sm text-gray-500" data-testid="no-todo">{tr("지금은 할 일이 없어요.", "You have no enabled tasks right now.")}</p>}
      {cards.map((c) => (
        <div key={`${c.process.address}-${c.instance}-${c.task.id}`} className="border border-gray-200 rounded-lg bg-white p-4 mb-3" data-testid="todo-card">
          <div className="text-xs text-gray-500 mb-1">
            <Link href={`/processes/${c.process.address}`} className="hover:underline">{c.process.name}</Link> · #{c.instance} · {c.task.roleLabel}
          </div>
          {irs[c.process.address] ? (
            <TaskForm address={c.process.address} ir={irs[c.process.address]!} instance={c.instance} task={c.task} onDone={(m) => { setNotice(m); void load(); }} />
          ) : (
            <p className="text-sm text-gray-400">{tr("불러오는 중…", "Loading…")}</p>
          )}
        </div>
      ))}
    </div>
  );
}
