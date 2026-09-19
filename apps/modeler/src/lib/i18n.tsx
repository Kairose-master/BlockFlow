"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "ko" | "en";

const STORAGE_KEY = "blockflow.locale.v1";

export function browserLocale(): Locale {
  if (typeof window === "undefined") return "ko";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "ko" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  tr: (ko: string, en: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ko");

  useEffect(() => {
    const next = browserLocale();
    setLocaleState(next);
    document.documentElement.lang = next;
  }, []);

  const setLocale = (next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    setLocaleState(next);
  };

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    tr: (ko, en) => locale === "ko" ? ko : en,
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider");
  return value;
}

export const EXAMPLE_TITLES: Record<string, string> = {
  "credit-review": "Credit review (template)",
  "expense-approval": "Expense approval",
  "fx-transfer": "International transfer",
  "invoice-payment": "Invoice payment",
  "leave-request": "Leave request",
  "paper-review": "Paper review",
  "purchase-order": "Purchase approval",
  "supply-chain": "Supply-chain delivery",
  "travel-booking": "Travel booking",
};

const DIAGNOSTICS_EN: Record<string, string> = {
  R1: "The process needs exactly one start event with one outgoing flow.",
  R2: "Add a reachable end event with no outgoing flow.",
  R3: "Use a gateway when a task needs to split or merge flows.",
  R4: "A gateway must either split or merge the flow, not both.",
  R5: "Fix the XOR conditions and choose exactly one default flow.",
  R6: "Parallel gateway flows cannot have conditions.",
  R7: "Put every user task inside a role lane.",
  R8: "Every element must be reachable from start and able to reach an end.",
  R9: "A variable, input, type, or condition is invalid.",
  R10: "A value is used before it is collected on every possible path.",
  R11: "This process is too large for the current 256-flow encoding.",
  R12: "Add valid names and Solidity-safe identifiers.",
  L0: "This BPMN element is outside the currently supported core subset.",
  L1: "This advanced BPMN feature is not configured correctly.",
  XML: "The BPMN XML is invalid or contains a broken reference.",
};

export function diagnosticText(rule: string, original: string, locale: Locale): string {
  if (locale === "ko") return original;
  return DIAGNOSTICS_EN[rule] ?? original;
}
