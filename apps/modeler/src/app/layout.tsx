import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockFlow 모델러",
  description: "BPMN 다이어그램을 그리면 스마트 컨트랙트가 됩니다",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
