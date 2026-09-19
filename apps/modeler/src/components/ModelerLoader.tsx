"use client";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";

// bpmn-js 는 브라우저 전용 (document/SVG). 서버 렌더링을 끈다.
const Modeler = dynamic(() => import("./Modeler").then((m) => m.Modeler), {
  ssr: false,
  loading: () => <ModelerLoading />,
});

function ModelerLoading() {
  const { tr } = useI18n();
  return <div className="p-6 text-sm text-gray-500">{tr("모델러를 불러오는 중…", "Loading the modeler…")}</div>;
}

export function ModelerLoader() {
  return <Modeler />;
}
