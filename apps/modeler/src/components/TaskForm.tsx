"use client";
/** 태스크 완료 폼 (가이드 8.1 "할 일"): bc:inputs 를 타입별 입력으로. 문서는 해시로 변환해 보낸다 (D7). */
import { useState } from "react";
import { keccak256, stringToHex } from "viem";
import type { IR } from "@blockflow/ir";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Task {
  id: string;
  name: string;
  label: string;
  role: string;
}

export function TaskForm({ address, ir, instance, task, onDone }: { address: string; ir: IR; instance: string; task: Task; onDone: (message: string) => void }) {
  const { tr } = useI18n();
  const node = ir.nodes.find((n) => (n.kind === "userTask" || n.kind === "serviceTask") && n.id === task.id);
  const inputs = node?.kind === "userTask" || node?.kind === "serviceTask" ? node.inputs.map((i) => ({ ...i, type: ir.variables.find((v) => v.name === i.variable)?.type ?? "uint256" })) : [];
  const payment = node?.kind === "userTask" ? node.payment : undefined;
  const payTo = payment ? ("role" in payment.to ? ir.roles.find((r) => r.key === (payment.to as { role: string }).role)?.label ?? "" : payment.to.address) : "";
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
      const r = await api<{ ended: boolean; completed: boolean | null; paid: { amount: string; to: string } | null }>(`/api/processes/${address}/tasks`, { method: "POST", body: JSON.stringify({ instance, task: task.name, args }) });
      const paidMsg = r.paid ? tr(` ${r.paid.to}에게 ${r.paid.amount} 토큰을 보냈어요.`, ` Sent ${r.paid.amount} tokens to ${r.paid.to}.`) : "";
      const msg = (r.ended ? (r.completed ? tr("완료됐어요. 이 건은 정상 종료됐어요.", "Task completed. This instance finished successfully.") : tr("완료됐어요. 이 건은 중단(반려)으로 끝났어요.", "Task completed. This instance ended as rejected or cancelled.")) : tr("완료됐어요. 다음 담당자 차례예요.", "Task completed. The process is ready for the next assignee.")) + paidMsg;
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
              <option value="true">{tr("예", "Yes")}</option>
              <option value="false">{tr("아니오", "No")}</option>
            </select>
          ) : (
            <input
              className="w-full rounded border border-gray-300 px-2 py-1"
              type={inp.type === "uint256" || inp.type === "int256" ? "number" : "text"}
              placeholder={inp.type === "bytes32" ? tr("파일 이름이나 내용 (해시로 저장돼요)", "File name or content (stored as a hash)") : inp.type === "address" ? "0x…" : ""}
              value={values[inp.variable] ?? ""}
              data-testid={`field-${inp.variable}`}
              onChange={(e) => setValues({ ...values, [inp.variable]: e.target.value })}
            />
          )}
        </label>
      ))}
      {payment && (
        <p className="text-xs text-amber-700 mb-2" data-testid="payment-notice">
          {tr(`완료하면 [${payment.amountVar}] 만큼의 토큰이 ${payTo}에게 지급돼요. 지출 승인은 자동으로 처리해요.`, `Completing this task transfers [${payment.amountVar}] tokens to ${payTo}. The demo handles token approval automatically.`)}
        </p>
      )}
      {error && <p className="text-red-600 mb-2" data-testid="task-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy} onClick={() => void submit()} data-testid={`complete-${task.name}`}>{busy ? tr("처리 중…", "Processing…") : tr("완료", "Complete")}</button>
    </div>
  );
}
