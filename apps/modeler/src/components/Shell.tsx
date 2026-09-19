"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { USER_KEY, api, currentUser } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Accounts {
  mode: "local" | "rpc";
  chainId: number;
  owner: string;
  users: { address: string; label: string }[];
}

const NAV = [
  { href: "/", ko: "그리기", en: "Design" },
  { href: "/processes", ko: "내 프로세스", en: "Processes" },
  { href: "/todo", ko: "할 일", en: "My tasks" },
  { href: "/history", ko: "기록", en: "History" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { locale, setLocale, tr } = useI18n();
  const path = usePathname();
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [user, setUser] = useState("");

  useEffect(() => {
    void api<Accounts>("/api/accounts").then((a) => {
      setAccounts(a);
      const saved = currentUser();
      const pick = a.users.some((u) => u.address === saved) ? saved : a.owner;
      localStorage.setItem(USER_KEY, pick);
      setUser(pick);
    });
  }, []);

  const choose = (addr: string) => {
    localStorage.setItem(USER_KEY, addr);
    setUser(addr);
    window.dispatchEvent(new Event("blockflow:user"));
  };

  return (
    <div className="h-screen flex flex-col">
      <nav className="flex items-center gap-1 px-3 h-10 bg-gray-900 text-gray-100 text-sm shrink-0">
        <span className="font-bold mr-3">BlockFlow</span>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`px-2 py-1 rounded ${path === n.href || (n.href !== "/" && path.startsWith(n.href)) ? "bg-gray-700" : "hover:bg-gray-800"}`}>
            {tr(n.ko, n.en)}
          </Link>
        ))}
        <span className="flex-1" />
        {accounts && (
          <>
            <span className="text-xs text-gray-400 mr-2">{accounts.mode === "local" ? tr("로컬 체인 (설치 없음)", "Local chain (no setup)") : `${tr("체인", "Chain")} ${accounts.chainId}`}</span>
            <label className="text-xs text-gray-400 mr-1">{tr("나는", "Acting as")}</label>
            <select className="bg-gray-800 rounded px-2 py-1 text-sm" value={user} onChange={(e) => choose(e.target.value)} data-testid="user-select">
              {accounts.users.map((u) => <option key={u.address} value={u.address}>{u.label}</option>)}
            </select>
          </>
        )}
        <button
          type="button"
          className="ml-2 rounded border border-gray-600 px-2 py-1 text-xs hover:bg-gray-800"
          onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
          aria-label={tr("영어로 전환", "Switch to Korean")}
          data-testid="locale-toggle"
        >
          {locale === "ko" ? "English" : "한국어"}
        </button>
      </nav>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/** 사용자 변경을 구독하는 훅 */
export function useUser(): string {
  const [user, setUser] = useState("");
  useEffect(() => {
    const read = () => setUser(currentUser());
    read();
    window.addEventListener("blockflow:user", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("blockflow:user", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return user;
}
