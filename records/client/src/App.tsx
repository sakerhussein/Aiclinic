import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { I18nProvider } from "./i18n";
import { AppProvider, useApp } from "./session";
import { Layout } from "./ui";
import { Today, PatientList } from "./pages/patients";
import { ChartPage } from "./pages/chart";
import { Settings } from "./pages/settings";

// A page someone may not open sends them home; the server refuses the data either way.
function Allowed({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useApp();
  return can(perm) ? <>{children}</> : <Navigate to="/patients" replace />;
}
// Doctors start on today's patients; everyone else on the patient list.
function Home() {
  const { can } = useApp();
  return can("records.chart.read") ? <Today /> : <Navigate to="/patients" replace />;
}

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/patients" element={<PatientList />} />
              <Route path="/patients/:id" element={<ChartPage />} />
              <Route path="/settings" element={<Allowed perm="records.settings.view"><Settings /></Allowed>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </I18nProvider>
  );
}
