import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AR, EN } from "./translations";

export type Lang = "en" | "ar";

const DICT: Record<Lang, Record<string, string>> = { en: EN, ar: AR };

// The language comes from the address: /ar… is Arabic, everything else is English.
// That gives each language its own page for Google and for shared links.
export function langFromPath(pathname: string): Lang {
  return pathname === "/ar" || pathname.startsWith("/ar/") ? "ar" : "en";
}

// "/ar/privacy" -> "/privacy"
function basePath(pathname: string): string {
  if (langFromPath(pathname) === "ar") return pathname.slice(3) || "/";
  return pathname;
}

// "/privacy" -> "/ar/privacy", "/#contact" -> "/ar#contact", "/?interest=consulting#contact" -> "/ar?interest=…"
function localize(to: string, lang: Lang): string {
  if (lang === "en") return to;
  const m = /^([^?#]*)(.*)$/.exec(to);
  const p = m ? m[1] : to;
  const rest = m ? m[2] : "";
  return (p === "/" || p === "" ? "/ar" : `/ar${p}`) + rest;
}

function savedLang(): Lang | null {
  try {
    const saved = localStorage.getItem("lc_lang");
    if (saved === "en" || saved === "ar") return saved;
  } catch {
    // Storage can be blocked (private mode).
  }
  return null;
}

function saveLang(lang: Lang) {
  try {
    localStorage.setItem("lc_lang", lang);
  } catch {
    // Ignore storage errors. The choice still applies for this visit.
  }
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
  t: (key: string) => string;
  /** A link path in the current language, e.g. path("/privacy") is "/ar/privacy" on the Arabic site. */
  path: (to: string) => string;
}

const LanguageContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const lang = langFromPath(location.pathname);

  // First visit to an English address by someone who chose Arabic before (or whose browser is Arabic):
  // move them to the Arabic page once. Search engines are not redirected.
  useEffect(() => {
    if (lang === "ar") return;
    const saved = savedLang();
    const prefersAr = saved === "ar" || (!saved && navigator.language?.toLowerCase().startsWith("ar"));
    if (prefersAr) navigate(localize(location.pathname, "ar") + location.search + location.hash, { replace: true });
    // Only on the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback(
    (next: Lang) => {
      saveLang(next);
      if (next === lang) return;
      const base = basePath(location.pathname);
      navigate(localize(base, next) + location.search + location.hash);
    },
    [lang, location.pathname, location.search, location.hash, navigate]
  );

  const t = useCallback((key: string) => DICT[lang][key] ?? EN[key] ?? key, [lang]);
  const path = useCallback((to: string) => localize(to, lang), [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, toggle: () => setLang(lang === "en" ? "ar" : "en"), t, path }),
    [lang, setLang, t, path]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used inside LanguageProvider");
  return ctx;
}
