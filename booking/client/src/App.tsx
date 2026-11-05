import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider } from "./i18n";
import { AppProvider } from "./session";
import { Layout } from "./ui";
import { Calendar } from "./pages/calendar";
import { BookingForm } from "./pages/form";
import { BookingDetail, BookingList } from "./pages/bookings";
import { PatientList, PatientPage } from "./pages/patients";
import { Settings } from "./pages/settings";

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Calendar />} />
              <Route path="/new" element={<BookingForm />} />
              <Route path="/bookings" element={<BookingList />} />
              <Route path="/bookings/:id" element={<BookingDetail />} />
              <Route path="/bookings/:id/edit" element={<BookingForm />} />
              <Route path="/patients" element={<PatientList />} />
              <Route path="/patients/:id" element={<PatientPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </I18nProvider>
  );
}
