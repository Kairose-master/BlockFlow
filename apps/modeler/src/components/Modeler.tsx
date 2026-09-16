"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import BpmnModeler from "bpmn-js/lib/Modeler";
import TokenSimulationModule from "bpmn-js-token-simulation";
import { lintBpmn, type Diagnostic } from "@blockflow/bpmn";
import bc from "@blockflow/bpmn/moddle/bc.json";
import paletteModule from "@/lib/palette";
import contextPadModule, { addLane } from "@/lib/context-pad";
import { INITIAL_XML } from "@/lib/initial";
import { type Modeler as ModelerType, type Shape, download, getProcess } from "@/lib/bpmn-utils";
import { PropertiesPanel } from "./PropertiesPanel";

interface Example {
  name: string;
  title: string;
}

type CompileResult =
  | { ok: true; sol: string; bytecodeBytes: number; solcVersion: string; states: number; paths: { description: string; outcome: string }[]; ir: { process: { id: string; name: string }; roles: { label: string }[]; flows: unknown[]; nodes: { kind: string }[] } }
  | { ok: false; stage: string; diagnostics?: Diagnostic[]; problems?: (string | { message: string })[]; message?: string; sol?: string };

const OVERLAY_TYPE = "bf-diag";

export function Modeler() {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<ModelerType | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Shape | null>(null);
  const [version, setVersion] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [tab, setTab] = useState<"summary" | "sol">("summary");
  const lintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyOverlays = useCallback((diags: Diagnostic[]) => {
    const m = modelerRef.current;
    if (!m) return;
    const overlays = m.get("overlays");
    const registry = m.get("elementRegistry");
    overlays.remove({ type: OVERLAY_TYPE });
    const byElement = new Map<string, string[]>();
    for (const d of diags) if (d.elementId && registry.get(d.elementId)) byElement.set(d.elementId, [...(byElement.get(d.elementId) ?? []), d.message]);
    for (const [id, msgs] of byElement) {
      const el = document.createElement("div");
      el.className = "bf-badge";
      el.textContent = "!";
      el.title = msgs.join("\n");
      overlays.add(id, OVERLAY_TYPE, { position: { top: -9, right: 9 }, html: el });
    }
  }, []);

  const runLint = useCallback(async () => {
    const m = modelerRef.current;
    if (!m) return;
    const { xml } = await m.saveXML({ format: false });
    const diags = await lintBpmn(xml);
    setDiagnostics(diags);
    applyOverlays(diags);
  }, [applyOverlays]);

  const scheduleLint = useCallback(() => {
    if (lintTimer.current) clearTimeout(lintTimer.current);
    lintTimer.current = setTimeout(() => void runLint(), 250);
  }, [runLint]);

  useEffect(() => {
    if (!containerRef.current) return;
    const modeler = new BpmnModeler({
      container: containerRef.current,
      keyboard: { bindTo: document },
      additionalModules: [paletteModule, contextPadModule, TokenSimulationModule],
      moddleExtensions: { bc },
    }) as unknown as ModelerType;
    modelerRef.current = modeler;
    modeler.on("selection.changed", (e: any) => setSelected(e.newSelection?.[0] ?? null));
    modeler.on("commandStack.changed", () => {
      setVersion((v) => v + 1);
      scheduleLint();
    });
    modeler.on("import.done", () => {
      setVersion((v) => v + 1);
      void runLint();
    });
    void modeler.importXML(INITIAL_XML).then(() => setReady(true));
    void fetch("/api/examples").then((r) => r.json()).then(setExamples).catch(() => setExamples([]));
    return () => {
      modeler.destroy();
      modelerRef.current = null;
    };
  }, [runLint, scheduleLint]);

  const loadXml = async (xml: string) => {
    const m = modelerRef.current;
    if (!m) return;
    setResult(null);
    await m.importXML(xml);
    m.get("canvas").zoom("fit-viewport", "auto");
    setSelected(null);
  };

  const openExample = async (name: string) => {
    if (!name) return;
    const xml = await (await fetch(`/api/examples/${name}`)).text();
    await loadXml(xml);
  };

  const onAddLane = () => {
    const m = modelerRef.current;
    if (!m) return;
    const { participant } = getProcess(m);
    if (!participant) return;
    const lane = addLane(m.get("modeling"), participant);
    if (lane) {
      const n = participant.children.filter((c: any) => c.type === "bpmn:Lane").length;
      m.get("modeling").updateProperties(lane, { name: `역할 ${n}`, "bc:roleKey": `Role${n}` });
      m.get("selection").select(lane);
    }
  };

  const toggleSimulation = () => {
    const m = modelerRef.current;
    if (!m) return;
    m.get("toggleMode").toggleMode();
    setSimulating((s) => !s);
  };

  const compile = async () => {
    const m = modelerRef.current;
    if (!m) return;
    setCompiling(true);
    try {
      const { xml } = await m.saveXML({ format: true });
      const r = (await (await fetch("/api/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ xml }) })).json()) as CompileResult;
      setResult(r);
      setTab(r.ok ? "summary" : "summary");
      if (!r.ok && r.diagnostics) {
        setDiagnostics(r.diagnostics);
        applyOverlays(r.diagnostics);
      }
    } finally {
      setCompiling(false);
    }
  };

  const focusDiagnostic = (d: Diagnostic) => {
    const m = modelerRef.current;
    if (!m || !d.elementId) return;
    const el = m.get("elementRegistry").get(d.elementId);
    if (el) m.get("selection").select(el);
  };

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    void file.text().then(loadXml);
  };

  const onDownload = async () => {
    const m = modelerRef.current;
    if (!m) return;
    const { xml } = await m.saveXML({ format: true });
    const { process } = getProcess(m);
    download(`${process?.id ?? "process"}.bpmn`, xml);
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 text-sm">
        <span className="font-bold text-base mr-2">BlockFlow</span>
        <button className="btn" data-testid="new-diagram" onClick={() => void loadXml(INITIAL_XML)}>새로 만들기</button>
        <select className="btn" data-testid="example-select" defaultValue="" onChange={(e) => void openExample(e.target.value)}>
          <option value="">예시 열기…</option>
          {examples.map((ex) => <option key={ex.name} value={ex.name}>{ex.title}</option>)}
        </select>
        <button className="btn" data-testid="add-lane" onClick={onAddLane} disabled={!ready}>+ 역할 추가</button>
        <button className={`btn ${simulating ? "bg-blue-50 border-blue-300" : ""}`} data-testid="simulate" onClick={toggleSimulation} disabled={!ready}>
          {simulating ? "미리보기 끄기" : "미리보기 (토큰 시뮬레이션)"}
        </button>
        <span className="flex-1" />
        <label className="btn cursor-pointer">
          파일 열기<input type="file" accept=".bpmn,.xml" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
        </label>
        <button className="btn" onClick={() => void onDownload()}>내려받기</button>
        <button className="btn btn-primary" data-testid="compile" onClick={() => void compile()} disabled={compiling || !ready}>
          {compiling ? "컴파일 중…" : "컴파일"}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <div ref={containerRef} className="flex-1 min-w-0" data-testid="canvas" />
        <aside className="w-[360px] shrink-0 border-l border-gray-200 bg-white flex flex-col min-h-0">
          <section className="p-3 overflow-y-auto flex-1 min-h-0">
            {ready && modelerRef.current && <PropertiesPanel modeler={modelerRef.current} element={selected} version={version} />}
          </section>
          <section className="border-t border-gray-200 p-3 max-h-[40%] overflow-y-auto" data-testid="diagnostics">
            <h3 className="font-semibold text-sm mb-1">검사 결과</h3>
            {diagnostics.length === 0 ? (
              <p className="text-sm text-green-700">문제 없음 — 컴파일할 수 있어요.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {diagnostics.map((d, i) => (
                  <li key={i}>
                    <button className="text-left hover:underline" onClick={() => focusDiagnostic(d)}>
                      <span className="inline-block w-8 text-[11px] text-red-600 font-mono">{d.rule}</span>
                      {d.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {result && (
        <footer className="border-t border-gray-200 bg-white max-h-[45vh] flex flex-col">
          <div className="flex items-center gap-3 px-3 py-2 text-sm border-b border-gray-100">
            <span data-testid="compile-status" className={result.ok ? "text-green-700" : "text-red-700"}>
              {result.ok
                ? `컴파일 성공 — ${result.ir.process.name} (${result.ir.process.id}), solc ${result.solcVersion.split("+")[0]}, 바이트코드 ${result.bytecodeBytes.toLocaleString()} B, 경고 0`
                : result.stage === "rules"
                  ? "다이어그램을 먼저 고쳐 주세요 (검사 결과 참고)"
                  : result.stage === "soundness"
                    ? "흐름에 문제가 있어요 (막히거나 끝나지 않는 경로)"
                    : `컴파일 실패 (${result.stage})`}
            </span>
            <span className="flex-1" />
            {result.ok && (
              <>
                <button className={`btn ${tab === "summary" ? "bg-gray-100" : ""}`} onClick={() => setTab("summary")}>요약</button>
                <button className={`btn ${tab === "sol" ? "bg-gray-100" : ""}`} onClick={() => setTab("sol")} data-testid="tab-sol">Solidity</button>
                <button className="btn" onClick={() => download(`${result.ir.process.id}.sol`, result.sol, "text/plain")}>.sol 내려받기</button>
              </>
            )}
            <button className="btn" onClick={() => setResult(null)}>닫기</button>
          </div>
          <div className="overflow-auto p-3 text-sm">
            {result.ok ? (
              <>
                <div className={tab === "summary" ? "" : "hidden"} data-testid="summary">
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <li>역할: {result.ir.roles.map((r) => r.label).join(", ")}</li>
                    <li>할 일: {result.ir.nodes.filter((n) => n.kind === "userTask").length}개, 화살표: {result.ir.flows.length}개</li>
                    <li>도달 가능한 상태: {result.states}개</li>
                    <li>실행 경로: {result.paths.length}개</li>
                  </ul>
                  <ol className="mt-2 list-decimal list-inside text-gray-600">
                    {result.paths.map((p, i) => <li key={i}>{p.description} → {p.outcome === "completed" ? "완료" : p.outcome}</li>)}
                  </ol>
                </div>
                <pre className={`font-mono text-xs whitespace-pre ${tab === "sol" ? "" : "hidden"}`} data-testid="solidity">{result.sol}</pre>
              </>
            ) : (
              <ul className="list-disc list-inside text-red-700">
                {(result.problems ?? []).map((p, i) => <li key={i}>{typeof p === "string" ? p : p.message}</li>)}
                {result.message && <li>{result.message}</li>}
              </ul>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
