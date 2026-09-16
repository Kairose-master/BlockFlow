"use client";
/** 태스크 완료 폼 (가이드 8.1 "할 일"): bc:inputs 를 타입별 입력으로. 문서는 해시로 변환해 보낸다 (D7). */
import { useState } from "react";
import { keccak256, stringToHex } from "viem";
import type { IR } from "@blockflow/ir";
import { api } from "@/lib/api";

interface Task {
  id: string;
  name: string;
  label: string;
  role: string;
}

export function TaskForm({ address, ir, instance, task, onDone }: { address: string; ir: IR; instance: string; task: Task; onDone: (message: string) => void }) {
  const node = ir.nodes.find((n) => (n.kind === "userTask" || n.kind === "serviceTask") && n.id === task.id);
  const inputs = node?.kind === "userTask" || node?.kind === "serviceTask" ? node.inputs.map((i) => ({ ...i, type: ir.variables.find((v) => v.name === i.variable)?.type ?? "uint256" })) : [];
  // 화면에 보이는 기본값(예/아니오 → 예)이 그대로 전송되도록 초기 상태에 넣는다.
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(inputs.filter((i) => i.type === "bool").map((i) => [i.variable, "true"])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string>("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const args: Record<string, unknown> = {};
      for (const inp of inputs) {
        const raw = values[inp.variable] ?? "";
        if (inp.type === "bytes32") args[inp.variable] = /^0x[0-9a-fA-F]{64}$/.test(raw) ? raw : keccak256(stringToHex(raw));
        else if (inp.type === "bool") args[inp.variable] = raw === "true";
        else args[inp.variable] = raw;
      }
      const r = await api<{ ended: boolean; completed: boolean | null }>(`/api/processes/${address}/tasks`, { method: "POST", body: JSON.stringify({ instance, task: task.name, args }) });
      const msg = r.ended ? (r.completed ? "완료됐어요. 이 건은 정상 종료됐어요." : "완료됐어요. 이 건은 중단(반려)으로 끝났어요.") : "완료됐어요. 다음 담당자 차례예요.";
      setDone(msg);
      onDone(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) return <p className="text-sm text-green-700">{done}</p>;
  return (
    <div className="border border-gray-200 rounded p-3 mb-2 text-sm" data-testid={`task-form-${task.name}`}>
      <div className="font-semibold mb-2">[{task.label}]</div>
      {inputs.map((inp) => (
        <label key={inp.variable} className="block mb-2">
          <span className="block text-xs text-gray-600">{inp.label}</span>
          {inp.type === "bool" ? (
            <select className="w-full rounded border border-gray-300 px-2 py-1" value={values[inp.variable] ?? "true"} data-testid={`field-${inp.variable}`} onChange={(e) => setValues({ ...values, [inp.variable]: e.target.value })}>
              <option value="true">예</option>
              <option value="false">아니오</option>
            </select>
          ) : (
            <input
              className="w-full rounded border border-gray-300 px-2 py-1"
              type={inp.type === "uint256" || inp.type === "int256" ? "number" : "text"}
              placeholder={inp.type === "bytes32" ? "파일 이름이나 내용 (해시로 저장돼요)" : inp.type === "address" ? "0x…" : ""}
              value={values[inp.variable] ?? ""}
              data-testid={`field-${inp.variable}`}
              onChange={(e) => setValues({ ...values, [inp.variable]: e.target.value })}
            />
          )}
        </label>
      ))}
      {error && <p className="text-red-600 mb-2" data-testid="task-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy} onClick={() => void submit()} data-testid={`complete-${task.name}`}>{busy ? "처리 중…" : "완료"}</button>
    </div>
  );
}
