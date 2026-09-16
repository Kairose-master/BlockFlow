"use client";
/**
 * 조건 빌더 (가이드 4.4 UI 표현): "만약 [금액] 이 [보다 큼] [1000]" 을 드롭다운으로 조립해 bc:expr 문자열로 저장한다.
 * 여러 줄은 하나의 연결어(그리고/또는)로 잇는다. 빌더가 표현 못 하는 식은 "직접 입력" 으로.
 */
import { useMemo } from "react";

interface Row {
  variable: string;
  op: string;
  value: string;
}

const NUM_OPS = [
  { value: ">", label: "보다 큼" },
  { value: ">=", label: "이상" },
  { value: "<", label: "보다 작음" },
  { value: "<=", label: "이하" },
  { value: "==", label: "같음" },
  { value: "!=", label: "다름" },
];
const BOOL_OPS = [
  { value: "true", label: "예 이면" },
  { value: "false", label: "아니오 이면" },
];
const ADDR_OPS = [
  { value: "==", label: "이 역할의 담당자와 같음" },
  { value: "!=", label: "이 역할의 담당자와 다름" },
];

export function parseRows(expr: string): { rows: Row[]; joiner: "&&" | "||" } | null {
  const text = expr.trim();
  if (!text) return { rows: [], joiner: "&&" };
  const joiner: "&&" | "||" = text.includes("||") && !text.includes("&&") ? "||" : "&&";
  if (text.includes("&&") && text.includes("||")) return null;
  const rows: Row[] = [];
  for (const part of text.split(joiner).map((s) => s.trim())) {
    let m = /^([A-Za-z_]\w*)\s*(==|!=|<=|>=|<|>)\s*(-?\d+|role\([A-Za-z_]\w*\)|0x[0-9a-fA-F]{40})$/.exec(part);
    if (m) {
      rows.push({ variable: m[1]!, op: m[2]!, value: m[3]! });
      continue;
    }
    m = /^(!?)([A-Za-z_]\w*)$/.exec(part);
    if (m) {
      rows.push({ variable: m[2]!, op: m[1] ? "false" : "true", value: "" });
      continue;
    }
    return null;
  }
  return { rows, joiner };
}

export function serializeRows(rows: Row[], joiner: "&&" | "||"): string {
  return rows
    .map((r) => (r.op === "true" ? r.variable : r.op === "false" ? `!${r.variable}` : `${r.variable} ${r.op} ${r.value}`))
    .join(` ${joiner} `);
}

const sel = "rounded border border-gray-300 px-1 py-1 text-sm";

export function ConditionBuilder({ value, variables, roles, onChange }: {
  value: string;
  variables: { name: string; type: string }[];
  roles: string[];
  onChange: (expr: string) => void;
}) {
  const parsed = useMemo(() => parseRows(value), [value]);
  if (!parsed) return <p className="text-xs text-amber-600">이 조건은 빌더로 표현할 수 없어요. "직접 입력" 으로 고치세요: <code>{value}</code></p>;
  const { rows, joiner } = parsed;
  const typeOf = (name: string) => variables.find((v) => v.name === name)?.type ?? "uint256";
  const set = (next: Row[], j = joiner) => onChange(serializeRows(next, j));
  const defaultRow = (): Row => {
    const v = variables[0];
    if (!v) return { variable: "", op: ">", value: "0" };
    return v.type === "bool" ? { variable: v.name, op: "true", value: "" } : v.type === "address" ? { variable: v.name, op: "==", value: `role(${roles[0] ?? "Role1"})` } : { variable: v.name, op: ">", value: "0" };
  };
  return (
    <div data-testid="condition-builder">
      {variables.length === 0 && <p className="text-[11px] text-gray-400 mb-2">먼저 프로세스에 값을 추가하세요.</p>}
      {rows.map((r, i) => {
        const t = typeOf(r.variable);
        return (
          <div key={i} className="flex flex-wrap items-center gap-1 mb-1">
            {i > 0 && (
              <select className={sel} value={joiner} onChange={(e) => set(rows, e.target.value as "&&" | "||")}>
                <option value="&&">그리고</option>
                <option value="||">또는</option>
              </select>
            )}
            {i === 0 && <span className="text-xs text-gray-500">만약</span>}
            <select className={sel} value={r.variable} data-testid={`cond-var-${i}`}
              onChange={(e) => {
                const nt = typeOf(e.target.value);
                const op = nt === "bool" ? "true" : nt === "address" ? "==" : NUM_OPS.some((o) => o.value === r.op) ? r.op : ">";
                const val = nt === "bool" ? "" : nt === "address" ? `role(${roles[0] ?? "Role1"})` : /^-?\d+$/.test(r.value) ? r.value : "0";
                set(rows.map((x, j) => (j === i ? { variable: e.target.value, op, value: val } : x)));
              }}>
              {variables.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
            <span className="text-xs text-gray-500">이</span>
            <select className={sel} value={r.op} data-testid={`cond-op-${i}`} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}>
              {(t === "bool" ? BOOL_OPS : t === "address" ? ADDR_OPS : NUM_OPS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {t === "address" ? (
              <select className={sel} value={r.value} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                {roles.map((k) => <option key={k} value={`role(${k})`}>{k}</option>)}
              </select>
            ) : t !== "bool" ? (
              <input className={`${sel} w-24`} value={r.value} data-testid={`cond-val-${i}`} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            ) : null}
            <button className="text-gray-400 hover:text-red-600" title="삭제" onClick={() => set(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      <button className="text-sm text-blue-600 hover:underline disabled:text-gray-300" disabled={!variables.length} onClick={() => set([...rows, defaultRow()])} data-testid="cond-add">+ 조건 추가</button>
    </div>
  );
}
