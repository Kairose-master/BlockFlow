import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "BlockFlow",
  description: "Design an executable smart-contract policy as a BPMN diagram",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <LanguageProvider><Shell>{children}</Shell></LanguageProvider>
      </body>
    </html>
  );
}
