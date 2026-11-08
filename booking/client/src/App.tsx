import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider } from "./i18n";
import { AppProvider } from "./session";
import { Layout } from "./ui";
import { useApp } from "./session";
import type { ReactNode } from "react";
import { Calendar } from "./pages/calendar";
import { BookingForm } from "./pages/form";
import { BookingDetail, BookingList } from "./pages/bookings";
import { PatientList, PatientPage } from "./pages/patients";
import { Settings } from "./pages/settings";
import { AuditLog } from "./pages/audit";
import { PrintPage } from "./pages/print";

// A page someone may not open sends them home; the server refuses the data either way.
function Allowed({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useApp();
  return can(perm) ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            {/* Brochures print without the app's header, at their real size. */}
            <Route path="/print/:design" element={<Allowed perm="booking.settings.view"><PrintPage /></Allowed>} />
            <Route element={<Layout />}>
              <Route path="/" element={<Calendar />} />
              <Route path="/new" element={<BookingForm />} />
              <Route path="/bookings" element={<BookingList />} />
              <Route path="/bookings/:id" element={<BookingDetail />} />
              <Route path="/bookings/:id/edit" element={<BookingForm />} />
              <Route path="/patients" element={<PatientList />} />
              <Route path="/patients/:id" element={<PatientPage />} />
              <Route path="/settings" element={<Allowed perm="booking.settings.view"><Settings /></Allowed>} />
              <Route path="/audit" element={<Allowed perm="booking.audit.view"><AuditLog /></Allowed>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </I18nProvider>
  );
}
