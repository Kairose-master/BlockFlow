"use client";
import dynamic from "next/dynamic";

// bpmn-js 는 브라우저 전용 (document/SVG). 서버 렌더링을 끈다.
const Modeler = dynamic(() => import("./Modeler").then((m) => m.Modeler), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-gray-500">모델러를 불러오는 중…</div>,
});

export function ModelerLoader() {
  return <Modeler />;
}
