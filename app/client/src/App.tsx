import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Legal from "./pages/Legal";
import { useI18n } from "./i18n";

const TITLES: Record<string, { en: string; ar: string }> = {
  "/": {
    en: "Limitsiz Clinic by Limitsiz | Orchestrated AI Agents for Private Clinics",
    ar: "Limitsiz Clinic من Limitsiz | وكلاء ذكاء اصطناعي منسّقون للعيادات الخاصة",
  },
  "/privacy": { en: "Privacy Policy | Limitsiz", ar: "سياسة الخصوصية | Limitsiz" },
  "/terms": { en: "Terms of Use | Limitsiz", ar: "شروط الاستخدام | Limitsiz" },
};

export default function App() {
  const { pathname, hash, key } = useLocation();
  const { lang } = useI18n();

  // Scroll to the section named in the URL hash (for example /#pricing),
  // or to the top when the page changes. `key` changes on every click, so a
  // link to the hash the address bar already shows (/#contact) still scrolls.
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, key]);

  useEffect(() => {
    const titles = TITLES[pathname] ?? TITLES["/"];
    document.title = titles[lang];
  }, [pathname, lang]);

  return (
    <>
      <a className="skip-link" href="#main">
        {lang === "ar" ? "تخطي إلى المحتوى" : "Skip to content"}
      </a>
      <Header />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/privacy" element={<Legal kind="privacy" />} />
          <Route path="/terms" element={<Legal kind="terms" />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
