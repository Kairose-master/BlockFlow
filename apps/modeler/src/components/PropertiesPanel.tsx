"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { type Modeler, type Shape, getInputs, getProcess, getVariables, isXorSplit, setBoProps, setExtList, setProps } from "@/lib/bpmn-utils";
import { ConditionBuilder } from "./ConditionBuilder";

const VAR_TYPES: { value: string; label: string }[] = [
  { value: "uint256", label: "숫자 (0 이상)" },
  { value: "int256", label: "숫자 (음수 가능)" },
  { value: "bool", label: "예/아니오" },
  { value: "bytes32", label: "문서·파일 (해시 저장)" },
  { value: "address", label: "지갑 주소" },
];

export function PropertiesPanel({ modeler, element, version }: { modeler: Modeler; element: Shape | null; version: number }) {
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
    case "bpmn:SequenceFlow":
      return <FlowForm modeler={modeler} flow={element} process={process} />;
    case "bpmn:EndEvent":
      return <EndForm modeler={modeler} end={element} />;
    case "bpmn:ExclusiveGateway":
    case "bpmn:ParallelGateway":
    case "bpmn:StartEvent":
      return <NameForm modeler={modeler} shape={element} title={typeTitle(type)} hint={gatewayHint(element)} />;
    default:
      return <div className="text-sm text-gray-500">이 요소는 설정이 없어요.</div>;
  }
}

function typeTitle(type: string): string {
  return { "bpmn:ExclusiveGateway": "조건 분기 (XOR)", "bpmn:ParallelGateway": "동시 진행 (AND)", "bpmn:StartEvent": "시작" }[type] ?? type;
}

function gatewayHint(shape: Shape): string | undefined {
  if (shape.type === "bpmn:ExclusiveGateway") {
    return isXorSplit(shape)
      ? "나가는 화살표를 선택해 조건을 정하세요. 화살표 하나는 반드시 '기본 화살표' 여야 해요."
      : "들어오는 화살표가 여러 개면 '모으는' 마름모예요. 조건은 필요 없어요.";
  }
  if (shape.type === "bpmn:ParallelGateway") return "갈라진 일들이 모두 끝나야 다음으로 진행해요. 화살표에 조건을 붙일 수 없어요.";
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
  return (
    <div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <Field label="이름">
        <input className={input} value={shape.businessObject.name ?? ""} onChange={(e) => setProps(modeler, shape, { name: e.target.value })} />
      </Field>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function ProcessForm({ modeler, process, participant }: { modeler: Modeler; process: any; participant: Shape | undefined }) {
  const vars = getVariables(process);
  const update = (next: { name: string; type: string }[]) => setExtList(modeler, participant, process, "bc:Variables", "bc:Variable", next);
  return (
    <div>
      <h3 className="font-semibold mb-2">프로세스</h3>
      <Field label="이름" hint="프로세스 카드에 보이는 이름이에요">
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
      <Field label="식별자 (영문)" hint="컨트랙트 이름이 돼요. 영문자로 시작, 영숫자만">
        <input className={input} value={process?.id ?? ""} onChange={(e) => participant && setBoProps(modeler, participant, process, { id: e.target.value })} data-testid="process-id" />
      </Field>
      <h4 className="text-xs font-semibold text-gray-600 mt-4 mb-1">이 프로세스에서 다루는 값</h4>
      <p className="text-[11px] text-gray-400 mb-2">할 일에서 입력받고, 조건에서 비교해요.</p>
      <table className="w-full text-sm">
        <tbody>
          {vars.map((v, i) => (
            <tr key={i}>
              <td className="pr-1 py-0.5">
                <input className={input} value={v.name} placeholder="영문 이름 (amount)" data-testid={`var-name-${i}`}
                  onChange={(e) => update(vars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </td>
              <td className="pr-1 py-0.5">
                <select className={input} value={v.type} onChange={(e) => update(vars.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                  {VAR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </td>
              <td><button className="text-gray-400 hover:text-red-600" title="삭제" onClick={() => update(vars.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-2 text-sm text-blue-600 hover:underline" onClick={() => update([...vars, { name: `value${vars.length + 1}`, type: "uint256" }])} data-testid="add-variable">+ 값 추가</button>
    </div>
  );
}

function LaneForm({ modeler, lane }: { modeler: Modeler; lane: Shape }) {
  const bo = lane.businessObject;
  return (
    <div>
      <h3 className="font-semibold mb-2">역할 (레인)</h3>
      <Field label="역할 이름" hint="예: 신청자, 팀장, 재무">
        <input className={input} value={bo.name ?? ""} onChange={(e) => setProps(modeler, lane, { name: e.target.value })} data-testid="lane-name" />
      </Field>
      <Field label="역할 식별자 (영문)" hint="컨트랙트의 역할 상수 이름. 비우면 이름에서 만들어요">
        <input className={input} value={bo.get("bc:roleKey") ?? ""} onChange={(e) => setProps(modeler, lane, { "bc:roleKey": e.target.value })} data-testid="lane-roleKey" />
      </Field>
      <Field label="담당자 지정 방식">
        <select className={input} value={bo.get("bc:bindingMode") ?? "static"} onChange={(e) => setProps(modeler, lane, { "bc:bindingMode": e.target.value })}>
          <option value="static">시작할 때 지정 (소유자가 교체 가능)</option>
          <option value="ownerRebind">소유자만 교체</option>
          <option value="open">처음 완료하는 사람이 담당자</option>
        </select>
      </Field>
    </div>
  );
}

function TaskForm({ modeler, task, process }: { modeler: Modeler; task: Shape; process: any }) {
  const bo = task.businessObject;
  const vars = getVariables(process);
  const inputs = getInputs(bo);
  const update = (next: { variable: string; label: string }[]) => setExtList(modeler, task, bo, "bc:Inputs", "bc:Input", next);
  return (
    <div>
      <h3 className="font-semibold mb-2">할 일 (사용자 태스크)</h3>
      <Field label="이름" hint="예: 경비 신청">
        <input className={input} value={bo.name ?? ""} onChange={(e) => setProps(modeler, task, { name: e.target.value })} data-testid="task-name" />
      </Field>
      <Field label="영문 이름 (선택)" hint="컨트랙트 함수 이름. 비우면 자동으로 만들어요">
        <input className={input} value={bo.get("bc:fn") ?? ""} placeholder="submit" onChange={(e) => setProps(modeler, task, { "bc:fn": e.target.value || undefined })} data-testid="task-fn" />
      </Field>
      <h4 className="text-xs font-semibold text-gray-600 mt-4 mb-1">완료할 때 입력받는 값</h4>
      {vars.length === 0 && <p className="text-[11px] text-gray-400 mb-2">먼저 프로세스에서 "값 추가" 를 해 주세요.</p>}
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
                <input className={input} value={inp.label} placeholder="화면에 보일 이름" onChange={(e) => update(inputs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              </td>
              <td><button className="text-gray-400 hover:text-red-600" title="삭제" onClick={() => update(inputs.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-2 text-sm text-blue-600 hover:underline disabled:text-gray-300" disabled={!vars.length}
        onClick={() => update([...inputs, { variable: vars[0]!.name, label: vars[0]!.name }])} data-testid="add-input">+ 입력 추가</button>
      <PaymentFields modeler={modeler} task={task} vars={vars} />
    </div>
  );
}

/** L1 결제 태스크 (bc:payToken / bc:payTo / bc:payAmountVar): 완료할 때 담당자가 토큰을 보낸다. */
function PaymentFields({ modeler, task, vars }: { modeler: Modeler; task: Shape; vars: { name: string; type: string }[] }) {
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
        완료할 때 토큰을 보내요 (결제)
      </label>
      {enabled && (
        <>
          <Field label="토큰 주소 (ERC-20)" hint="담당자가 이 프로세스에 지출 승인(approve)을 해 두어야 해요">
            <input className={input} value={token} onChange={(e) => set({ "bc:payToken": e.target.value })} data-testid="pay-token" />
          </Field>
          <Field label="받는 쪽">
            <select className={input} value={roles.includes(to) ? to : "__addr"} onChange={(e) => set({ "bc:payTo": e.target.value === "__addr" ? "0x" : e.target.value })} data-testid="pay-to">
              {roles.map((r) => <option key={r} value={r}>{r} (역할 담당자)</option>)}
              <option value="__addr">지갑 주소 직접 입력</option>
            </select>
            {!roles.includes(to) && <input className={`${input} mt-1`} value={to} placeholder="0x…" onChange={(e) => set({ "bc:payTo": e.target.value })} />}
          </Field>
          <Field label="금액으로 쓸 값">
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
      <h3 className="font-semibold mb-2">화살표</h3>
      <Field label="이름 (선택)">
        <input className={input} value={bo.name ?? ""} placeholder="예, 아니오" onChange={(e) => setProps(modeler, flow, { name: e.target.value })} />
      </Field>
      {split ? (
        <>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={!!isDefault} data-testid="flow-default"
              onChange={(e) => {
                setProps(modeler, source, { default: e.target.checked ? bo : undefined });
                if (e.target.checked) setCondition("");
              }} />
            기본 화살표 (다른 조건이 모두 아닐 때)
          </label>
          {!isDefault && (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-600">조건</span>
                <button className="text-[11px] text-gray-500 hover:underline" onClick={() => setRaw(!raw)}>{raw ? "쉽게 만들기" : "직접 입력"}</button>
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
        <p className="text-xs text-gray-500">조건은 '조건 분기(XOR)' 마름모에서 나가는 화살표에만 붙일 수 있어요.</p>
      )}
    </div>
  );
}

function laneKeys(modeler: Modeler): string[] {
  const registry = modeler.get("elementRegistry");
  return registry.filter((e: any) => e.type === "bpmn:Lane").map((l: any) => l.businessObject.get("bc:roleKey") || l.businessObject.name || "").filter(Boolean);
}

function EndForm({ modeler, end }: { modeler: Modeler; end: Shape }) {
  const bo = end.businessObject;
  const outcome: string = bo.get("bc:outcome") || "completed";
  return (
    <div>
      <h3 className="font-semibold mb-2">끝</h3>
      <Field label="이름" hint="예: 완료, 반려">
        <input className={input} value={bo.name ?? ""} onChange={(e) => setProps(modeler, end, { name: e.target.value })} data-testid="end-name" />
      </Field>
      <Field label="결과">
        <select className={input} value={outcome === "completed" ? "completed" : "other"} data-testid="end-outcome"
          onChange={(e) => setProps(modeler, end, { "bc:outcome": e.target.value === "completed" ? undefined : (bo.name ? toKey(bo.name) : "rejected") })}>
          <option value="completed">정상 완료</option>
          <option value="other">중단 (반려·취소 등)</option>
        </select>
      </Field>
      {outcome !== "completed" && (
        <Field label="결과 식별자 (영문)">
          <input className={input} value={outcome} onChange={(e) => setProps(modeler, end, { "bc:outcome": e.target.value })} />
        </Field>
      )}
    </div>
  );
}

function toKey(name: string): string {
  const ascii = name.replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
  return ascii || "rejected";
}
