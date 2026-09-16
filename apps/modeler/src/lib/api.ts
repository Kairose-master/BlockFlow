"use client";
/** 클라이언트 fetch 헬퍼: 선택한 사용자를 헤더로 보낸다. */
export const USER_KEY = "blockflow.user";

export function currentUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? "";
  } catch {
    return "";
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-blockflow-user": currentUser(), ...(init.headers ?? {}) },
  });
  const body = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(body.message ?? `${r.status}`);
  return body;
}

export function short(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
