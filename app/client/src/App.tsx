import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Legal from "./pages/Legal";
import { useI18n } from "./i18n";

const TITLES: Record<string, { en: string; ar: string }> = {
  "/": {
    en: "Limitsiz Clinic | Orchestrated AI Agents for Private Clinics",
    ar: "Limitsiz Clinic | وكلاء ذكاء اصطناعي منسّقون للعيادات الخاصة",
  },
  "/privacy": { en: "Privacy Policy | Limitsiz Clinic", ar: "سياسة الخصوصية | Limitsiz Clinic" },
  "/terms": { en: "Terms of Use | Limitsiz Clinic", ar: "شروط الاستخدام | Limitsiz Clinic" },
};

export default function App() {
  const { pathname, hash } = useLocation();
  const { lang } = useI18n();

  // Scroll to the section named in the URL hash (for example /#pricing),
  // or to the top when the page changes.
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

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
