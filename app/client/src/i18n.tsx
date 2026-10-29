import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AR, EN } from "./translations";

export type Lang = "en" | "ar";

const DICT: Record<Lang, Record<string, string>> = { en: EN, ar: AR };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lc_lang");
    if (saved === "en" || saved === "ar") return saved;
  } catch {
    // Storage can be blocked (private mode). Fall through to browser language.
  }
  return navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem("lc_lang", next);
    } catch {
      // Ignore storage errors. The choice still applies for this visit.
    }
    setLangState(next);
  }, []);

  const t = useCallback((key: string) => DICT[lang][key] ?? EN[key] ?? key, [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, toggle: () => setLang(lang === "en" ? "ar" : "en"), t }),
    [lang, setLang, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used inside LanguageProvider");
  return ctx;
}
