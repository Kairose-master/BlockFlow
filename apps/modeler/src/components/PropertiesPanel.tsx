"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { type Modeler, type Shape, getInputs, getProcess, getVariables, isXorSplit, setBoProps, setExtList, setProps } from "@/lib/bpmn-utils";
import { ConditionBuilder } from "./ConditionBuilder";
import { type Locale, useI18n } from "@/lib/i18n";

const VAR_TYPES: { value: string; ko: string; en: string }[] = [
  { value: "uint256", ko: "숫자 (0 이상)", en: "Number (0 or greater)" },
  { value: "int256", ko: "숫자 (음수 가능)", en: "Number (signed)" },
  { value: "bool", ko: "예/아니오", en: "Yes / No" },
  { value: "bytes32", ko: "문서·파일 (해시 저장)", en: "Document / file hash" },
  { value: "address", ko: "지갑 주소", en: "Wallet address" },
];

export function PropertiesPanel({ modeler, element, version }: { modeler: Modeler; element: Shape | null; version: number }) {
  const { locale, tr } = useI18n();
  void version; // 변경 시 재렌더용
  const { process, participant } = getProcess(modeler);
  const type: string | undefined = element?.type;

  if (!element || type === "bpmn:Participant" || type === "bpmn:Collaboration" || type === "bpmn:Process") {
    return <ProcessForm modeler={modeler} process={process} participant={participant ?? element} />;
  }
  if (element.labelTarget) return <PropertiesPanel modeler={modeler} element={element.labelTarget} version={version} />;
  switch (type) {
    case "bpmn:Lane":
      return <LaneForm modeler={modeler} lane={element} />;
    case "bpmn:UserTask":
      return <TaskForm modeler={modeler} task={element} process={process} />;
    case "bpmn:ServiceTask":
      return <TaskForm modeler={modeler} task={element} process={process} service />;
    case "bpmn:SequenceFlow":
      return <FlowForm modeler={modeler} flow={element} process={process} />;
    case "bpmn:EndEvent":
      return <EndForm modeler={modeler} end={element} />;
    case "bpmn:BoundaryEvent":
      return <TimerForm modeler={modeler} timer={element} process={process} />;
    case "bpmn:ExclusiveGateway":
    case "bpmn:ParallelGateway":
    case "bpmn:StartEvent":
      return <NameForm modeler={modeler} shape={element} title={typeTitle(type, locale)} hint={gatewayHint(element, locale)} />;
    default:
      return <div className="text-sm text-gray-500">{tr("이 요소는 설정이 없어요.", "This element has no editable settings.")}</div>;
  }
}

function typeTitle(type: string, locale: Locale): string {
  const ko = { "bpmn:ExclusiveGateway": "조건 분기 (XOR)", "bpmn:ParallelGateway": "동시 진행 (AND)", "bpmn:StartEvent": "시작" }[type];
  const en = { "bpmn:ExclusiveGateway": "Decision gateway (XOR)", "bpmn:ParallelGateway": "Parallel gateway (AND)", "bpmn:StartEvent": "Start" }[type];
  return (locale === "ko" ? ko : en) ?? type;
}

function gatewayHint(shape: Shape, locale: Locale): string | undefined {
  if (shape.type === "bpmn:ExclusiveGateway") {
    if (locale === "ko") return isXorSplit(shape)
      ? "나가는 화살표를 선택해 조건을 정하세요. 화살표 하나는 반드시 '기본 화살표' 여야 해요."
      : "들어오는 화살표가 여러 개면 '모으는' 마름모예요. 조건은 필요 없어요.";
    return isXorSplit(shape)
      ? "Select each outgoing flow and define its condition. Exactly one flow must be the default."
      : "Multiple incoming flows make this a merge gateway; no conditions are needed.";
  }
  if (shape.type === "bpmn:ParallelGateway") return locale === "ko" ? "갈라진 일들이 모두 끝나야 다음으로 진행해요. 화살표에 조건을 붙일 수 없어요." : "All parallel branches must finish before the process continues. Parallel flows cannot have conditions.";
  return undefined;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

const input = "w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200";

function NameForm({ modeler, shape, title, hint }: { modeler: Modeler; shape: Shape; title: string; hint?: string }) {
  const { tr } = useI18n();
  return (
    <div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <Field label={tr("이름", "Label")}>
        <input className={input} value={shape.businessObject.name ?? ""} onChange={(e) => setProps(modeler, shape, { name: e.target.value })} />
      </Field>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function ProcessForm({ modeler, process, participant }: { modeler: Modeler; process: any; participant: Shape | undefined }) {
  const { locale, tr } = useI18n();
  const vars = getVariables(process);
  const update = (next: { name: string; type: string }[]) => setExtList(modeler, participant, process, "bc:Variables", "bc:Variable", next);
  return (
    <div>
      <h3 className="font-semibold mb-2">{tr("프로세스", "Process")}</h3>
      <Field label={tr("이름", "Name")} hint={tr("프로세스 카드에 보이는 이름이에요", "Shown on process cards and boards.")}>
        <input
          className={input}
          value={process?.name ?? ""}
          onChange={(e) => {
            if (participant) {
              setBoProps(modeler, participant, process, { name: e.target.value });
              setProps(modeler, participant, { name: e.target.value });
            }
          }}
          data-testid="process-name"
        />
      </Field>
      <Field label={tr("식별자 (영문)", "Contract identifier")} hint={tr("컨트랙트 이름이 돼요. 영문자로 시작, 영숫자만", "Becomes the Solidity contract name. Start with a letter and use letters or digits.")}>
        <input className={input} value={process?.id ?? ""} onChange={(e) => participant && setBoProps(modeler, participant, process, { id: e.target.value })} data-testid="process-id" />
      </Field>
      <h4 className="text-xs font-semibold text-gray-600 mt-4 mb-1">{tr("이 프로세스에서 다루는 값", "Process data")}</h4>
      <p className="text-[11px] text-gray-400 mb-2">{tr("할 일에서 입력받고, 조건에서 비교해요.", "Collect values in tasks and use them in gateway conditions.")}</p>
      <table className="w-full text-sm">
        <tbody>
          {vars.map((v, i) => (
            <tr key={i}>
              <td className="pr-1 py-0.5">
                <input className={input} value={v.name} placeholder={tr("영문 이름 (amount)", "Solidity name (amount)")} data-testid={`var-name-${i}`}
                  onChange={(e) => update(vars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </td>
              <td className="pr-1 py-0.5">
                <select className={input} value={v.type} onChange={(e) => update(vars.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                  {VAR_TYPES.map((t) => <option key={t.value} value={t.value}>{locale === "ko" ? t.ko : t.en}</option>)}
                </select>
              </td>
              <td><button className="text-gray-400 hover:text-red-600" title={tr("삭제", "Delete")} onClick={() => update(vars.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-2 text-sm text-blue-600 hover:underline" onClick={() => update([...vars, { name: `value${vars.length + 1}`, type: "uint256" }])} data-testid="add-variable">{tr("+ 값 추가", "+ Add data field")}</button>
    </div>
  );
}

function LaneForm({ modeler, lane }: { modeler: Modeler; lane: Shape }) {
  const { tr } = useI18n();
  const bo = lane.businessObject;
  return (
    <div>
      <h3 className="font-semibold mb-2">{tr("역할 (레인)", "Role (lane)")}</h3>
      <Field label={tr("역할 이름", "Role label")} hint={tr("예: 신청자, 팀장, 재무", "For example: Requester, Manager, Finance")}>
        <input className={input} value={bo.name ?? ""} onChange={(e) => setProps(modeler, lane, { name: e.target.value })} data-testid="lane-name" />
      </Field>
      <Field label={tr("역할 식별자 (영문)", "Role identifier")} hint={tr("컨트랙트의 역할 상수 이름. 비우면 이름에서 만들어요", "Used for the Solidity role constant. Leave blank to derive it from the label.")}>
        <input className={input} value={bo.get("bc:roleKey") ?? ""} onChange={(e) => setProps(modeler, lane, { "bc:roleKey": e.target.value })} data-testid="lane-roleKey" />
      </Field>
      <Field label={tr("담당자 지정 방식", "Assignment policy")}>
        <select className={input} value={bo.get("bc:bindingMode") ?? "static"} onChange={(e) => setProps(modeler, lane, { "bc:bindingMode": e.target.value })}>
          <option value="static">{tr("시작할 때 지정 (소유자가 교체 가능)", "Assigned at start; owner may reassign")}</option>
          <option value="ownerRebind">{tr("소유자만 교체", "Only the owner may reassign")}</option>
          <option value="open">{tr("처음 완료하는 사람이 담당자", "Claimed by the first person to complete it")}</option>
        </select>
      </Field>
    </div>
  );
}

function TaskForm({ modeler, task, process, service = false }: { modeler: Modeler; task: Shape; process: any; service?: boolean }) {
  const { tr } = useI18n();
  const bo = task.businessObject;
  const vars = getVariables(process);
  const inputs = getInputs(bo);
  const update = (next: { variable: string; label: string }[]) => setExtList(modeler, task, bo, "bc:Inputs", "bc:Input", next);
  return (
    <div>
      <h3 className="font-semibold mb-2">{service ? tr("외부 서비스 (오라클)", "External service (oracle)") : tr("할 일 (사용자 태스크)", "Human task")}</h3>
      {service && <p className="text-xs text-gray-500 mb-3">{tr("이 단계에 오면 컨트랙트가 요청 이벤트를 내고, 소유자가 지정한 외부 서비스(오라클)가 아래 값을 돌려줘요. 사람이 하는 일이 아니라 역할 칸이 필요 없어요.", "The contract emits a request event at this step. The owner-approved oracle returns the values below, so no human role lane is required.")}</p>}
      <Field label={tr("이름", "Label")} hint={tr("예: 경비 신청", "For example: Submit expense")}>
        <input className={input} value={bo.name ?? ""} onChange={(e) => setProps(modeler, task, { name: e.target.value })} data-testid="task-name" />
      </Field>
      <Field label={tr("영문 이름 (선택)", "Function name (optional)")} hint={tr("컨트랙트 함수 이름. 비우면 자동으로 만들어요", "Solidity function name. Leave blank to generate one.")}>
        <input className={input} value={bo.get("bc:fn") ?? ""} placeholder="submit" onChange={(e) => setProps(modeler, task, { "bc:fn": e.target.value || undefined })} data-testid="task-fn" />
      </Field>
      <h4 className="text-xs font-semibold text-gray-600 mt-4 mb-1">{service ? tr("외부 서비스가 돌려주는 값", "Values returned by the oracle") : tr("완료할 때 입력받는 값", "Values collected on completion")}</h4>
      {vars.length === 0 && <p className="text-[11px] text-gray-400 mb-2">{tr("먼저 프로세스에서 \"값 추가\" 를 해 주세요.", "Add a process data field first.")}</p>}
      <table className="w-full text-sm">
        <tbody>
          {inputs.map((inp, i) => (
            <tr key={i}>
              <td className="pr-1 py-0.5">
                <select className={input} value={inp.variable} data-testid={`input-var-${i}`}
                  onChange={(e) => update(inputs.map((x, j) => (j === i ? { ...x, variable: e.target.value } : x)))}>
                  {vars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </td>
              <td className="pr-1 py-0.5">
                <input className={input} value={inp.label} placeholder={tr("화면에 보일 이름", "Label shown to users")} onChange={(e) => update(inputs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              </td>
              <td><button className="text-gray-400 hover:text-red-600" title={tr("삭제", "Delete")} onClick={() => update(inputs.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-2 text-sm text-blue-600 hover:underline disabled:text-gray-300" disabled={!vars.length}
        onClick={() => update([...inputs, { variable: vars[0]!.name, label: vars[0]!.name }])} data-testid="add-input">{tr("+ 입력 추가", "+ Add input")}</button>
      {!service && <PaymentFields modeler={modeler} task={task} vars={vars} />}
    </div>
  );
}

/** L1 결제 태스크 (bc:payToken / bc:payTo / bc:payAmountVar): 완료할 때 담당자가 토큰을 보낸다. */
function PaymentFields({ modeler, task, vars }: { modeler: Modeler; task: Shape; vars: { name: string; type: string }[] }) {
  const { tr } = useI18n();
  const bo = task.businessObject;
  const token: string = bo.get("bc:payToken") ?? "";
  const to: string = bo.get("bc:payTo") ?? "";
  const amountVar: string = bo.get("bc:payAmountVar") ?? "";
  const enabled = !!(token || to || amountVar);
  const roles = laneKeys(modeler);
  const uintVars = vars.filter((v) => v.type === "uint256");
  const set = (props: Record<string, string | undefined>) => setProps(modeler, task, props);
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <label className="flex items-center gap-2 text-sm mb-2">
        <input type="checkbox" checked={enabled} data-testid="task-payment"
          onChange={(e) => (e.target.checked
            ? set({ "bc:payToken": token || "0x1000000000000000000000000000000000000001", "bc:payTo": to || roles[0] || "", "bc:payAmountVar": amountVar || uintVars[0]?.name || "" })
            : set({ "bc:payToken": undefined, "bc:payTo": undefined, "bc:payAmountVar": undefined }))} />
        {tr("완료할 때 토큰을 보내요 (결제)", "Transfer tokens when this task completes")}
      </label>
      {enabled && (
        <>
          <Field label={tr("토큰 주소 (ERC-20)", "Token address (ERC-20)")} hint={tr("담당자가 이 프로세스에 지출 승인(approve)을 해 두어야 해요", "The task owner must approve the process contract to spend these tokens.")}>
            <input className={input} value={token} onChange={(e) => set({ "bc:payToken": e.target.value })} data-testid="pay-token" />
          </Field>
          <Field label={tr("받는 쪽", "Recipient")}>
            <select className={input} value={roles.includes(to) ? to : "__addr"} onChange={(e) => set({ "bc:payTo": e.target.value === "__addr" ? "0x" : e.target.value })} data-testid="pay-to">
              {roles.map((r) => <option key={r} value={r}>{r} {tr("(역할 담당자)", "(role assignee)")}</option>)}
              <option value="__addr">{tr("지갑 주소 직접 입력", "Enter a wallet address")}</option>
            </select>
            {!roles.includes(to) && <input className={`${input} mt-1`} value={to} placeholder="0x…" onChange={(e) => set({ "bc:payTo": e.target.value })} />}
          </Field>
          <Field label={tr("금액으로 쓸 값", "Amount field")}>
            <select className={input} value={amountVar} onChange={(e) => set({ "bc:payAmountVar": e.target.value })} data-testid="pay-amount">
              {uintVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </Field>
        </>
      )}
    </div>
  );
}

function FlowForm({ modeler, flow, process }: { modeler: Modeler; flow: Shape; process: any }) {
  const { tr } = useI18n();
  const bo = flow.businessObject;
  const source = flow.source;
  const split = isXorSplit(source);
  const gatewayBo = source?.businessObject;
  const isDefault = split && gatewayBo?.default === bo;
  const [raw, setRaw] = useState(false);
  const body: string = bo.conditionExpression?.body ?? "";
  const setCondition = (text: string) => {
    const moddle = modeler.get("moddle");
    setProps(modeler, flow, { conditionExpression: text ? moddle.create("bpmn:FormalExpression", { body: text }) : undefined });
  };
  return (
    <div>
      <h3 className="font-semibold mb-2">{tr("화살표", "Sequence flow")}</h3>
      <Field label={tr("이름 (선택)", "Label (optional)")}>
        <input className={input} value={bo.name ?? ""} placeholder={tr("예, 아니오", "Yes, No")} onChange={(e) => setProps(modeler, flow, { name: e.target.value })} />
      </Field>
      {split ? (
        <>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={!!isDefault} data-testid="flow-default"
              onChange={(e) => {
                setProps(modeler, source, { default: e.target.checked ? bo : undefined });
                if (e.target.checked) setCondition("");
              }} />
            {tr("기본 화살표 (다른 조건이 모두 아닐 때)", "Default flow (when every other condition is false)")}
          </label>
          {!isDefault && (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-600">{tr("조건", "Condition")}</span>
                <button className="text-[11px] text-gray-500 hover:underline" onClick={() => setRaw(!raw)}>{raw ? tr("쉽게 만들기", "Use builder") : tr("직접 입력", "Edit expression")}</button>
              </div>
              {raw ? (
                <input className={input} value={body} onChange={(e) => setCondition(e.target.value)} data-testid="flow-cond-raw" />
              ) : (
                <ConditionBuilder value={body} variables={getVariables(process)} roles={laneKeys(modeler)} onChange={setCondition} />
              )}
            </>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500">{tr("조건은 '조건 분기(XOR)' 마름모에서 나가는 화살표에만 붙일 수 있어요.", "Conditions are only allowed on outgoing flows from an XOR gateway.")}</p>
      )}
    </div>
  );
}

function laneKeys(modeler: Modeler): string[] {
  const registry = modeler.get("elementRegistry");
  return registry.filter((e: any) => e.type === "bpmn:Lane").map((l: any) => l.businessObject.get("bc:roleKey") || l.businessObject.name || "").filter(Boolean);
}

function EndForm({ modeler, end }: { modeler: Modeler; end: Shape }) {
  const { tr } = useI18n();
  const bo = end.businessObject;
  const outcome: string = bo.get("bc:outcome") || "completed";
  return (
    <div>
      <h3 className="font-semibold mb-2">{tr("끝", "End event")}</h3>
      <Field label={tr("이름", "Label")} hint={tr("예: 완료, 반려", "For example: Completed, Rejected")}>
        <input className={input} value={bo.name ?? ""} onChange={(e) => setProps(modeler, end, { name: e.target.value })} data-testid="end-name" />
      </Field>
      <Field label={tr("결과", "Outcome")}>
        <select className={input} value={outcome === "completed" ? "completed" : "other"} data-testid="end-outcome"
          onChange={(e) => setProps(modeler, end, { "bc:outcome": e.target.value === "completed" ? undefined : (bo.name ? toKey(bo.name) : "rejected") })}>
          <option value="completed">{tr("정상 완료", "Completed")}</option>
          <option value="other">{tr("중단 (반려·취소 등)", "Stopped (rejected, cancelled, etc.)")}</option>
        </select>
      </Field>
      {outcome !== "completed" && (
        <Field label={tr("결과 식별자 (영문)", "Outcome identifier")}>
          <input className={input} value={outcome} onChange={(e) => setProps(modeler, end, { "bc:outcome": e.target.value })} />
        </Field>
      )}
    </div>
  );
}

/** L1 타이머 경계 이벤트: 기한(변수 또는 초). 기한이 지나면 누구나 만료 처리할 수 있다. */
function TimerForm({ modeler, timer, process }: { modeler: Modeler; timer: Shape; process: any }) {
  const { tr } = useI18n();
  const bo = timer.businessObject;
  const host = timer.host?.businessObject;
  const uintVars = getVariables(process).filter((v) => v.type === "uint256");
  const dv: string = bo.get("bc:deadlineVar") ?? "";
  const ds: number | undefined = bo.get("bc:deadlineSeconds");
  const mode = dv ? "var" : "seconds";
  return (
    <div>
      <h3 className="font-semibold mb-2">{tr("기한 (타이머)", "Deadline (timer)")}</h3>
      <p className="text-xs text-gray-500 mb-3">{host ? (tr(`[${host.name ?? host.id}] 이 기한 안에 끝나지 않으면 기한 화살표로 진행해요. 기한이 지나면 누구나 "만료 처리" 할 수 있어요.`, `If [${host.name ?? host.id}] misses its deadline, the timer flow is taken and anyone may trigger expiry.`)) : tr("할 일 위에 놓아 주세요.", "Attach this timer to a task.")}</p>
      <Field label={tr("이름", "Label")}>
        <input className={input} value={bo.name ?? ""} onChange={(e) => setProps(modeler, timer, { name: e.target.value })} />
      </Field>
      <Field label={tr("기한 정하는 방법", "Deadline source")}>
        <select className={input} value={mode} data-testid="timer-mode"
          onChange={(e) => (e.target.value === "var"
            ? setProps(modeler, timer, { "bc:deadlineVar": uintVars[0]?.name ?? "", "bc:deadlineSeconds": undefined })
            : setProps(modeler, timer, { "bc:deadlineVar": undefined, "bc:deadlineSeconds": ds ?? 86400 }))}>
          <option value="seconds">{tr("고정 (초)", "Fixed duration (seconds)")}</option>
          <option value="var">{tr("값에서 (앞 단계에서 입력)", "Process data (collected earlier)")}</option>
        </select>
      </Field>
      {mode === "var" ? (
        <Field label={tr("기한으로 쓸 값 (초)", "Deadline field (seconds)")} hint={tr("uint256 값만 고를 수 있어요", "Only uint256 fields can be used.")}>
          <select className={input} value={dv} data-testid="timer-var" onChange={(e) => setProps(modeler, timer, { "bc:deadlineVar": e.target.value })}>
            {uintVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </Field>
      ) : (
        <Field label={tr("기한 (초)", "Deadline (seconds)")} hint={tr("예: 하루 = 86400", "For example: one day = 86400")}>
          <input className={input} type="number" min={1} value={ds ?? ""} data-testid="timer-seconds" onChange={(e) => setProps(modeler, timer, { "bc:deadlineSeconds": e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
      )}
    </div>
  );
}

function toKey(name: string): string {
  const ascii = name.replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
  return ascii || "rejected";
}
