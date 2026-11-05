import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { I18nProvider } from "./i18n";
import { SessionProvider, useSession } from "./session";
import { Accept, ChooseClinic, Forgot, Mfa, MfaSetup, Reset, SignIn, SignOut, Unlock } from "./pages/auth";
import { Account, Launcher, NoAccess, Users } from "./pages/inside";

// Signed-in pages: the server decides the state (locked, second step, choose a clinic); the page follows it.
function Gate({ children, need = "ok" }: { children: ReactNode; need?: string }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return null;
  if (!me) return <Navigate to={`/signin${loc.pathname === "/" ? "" : `?next=${encodeURIComponent(loc.pathname)}`}`} replace />;
  const where: Record<string, string> = { locked: "/unlock", mfa_required: "/mfa", mfa_setup_required: "/mfa/setup", choose_clinic: "/choose-clinic" };
  if (me.state !== need) {
    if (need === "ok" && where[me.state]) return <Navigate to={where[me.state] + loc.search} replace />;
    if (need !== "ok" && me.state === "ok") return <Navigate to="/" replace />;
    if (need !== "ok" && where[me.state] && where[me.state] !== loc.pathname) return <Navigate to={where[me.state] + loc.search} replace />;
  }
  return <>{children}</>;
}

// Signed-in pages that need a particular state (the lock screen needs "locked", and so on).
const State = ({ s, children }: { s: string; children: ReactNode }) => <Gate need={s}>{children}</Gate>;

export default function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signout" element={<SignOut />} />
            <Route path="/forgot" element={<Forgot />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/accept" element={<Accept />} />
            <Route path="/no-access" element={<NoAccess />} />
            <Route path="/mfa" element={<State s="mfa_required"><Mfa /></State>} />
            <Route path="/mfa/setup" element={<MfaSetupGate />} />
            <Route path="/unlock" element={<State s="locked"><Unlock /></State>} />
            <Route path="/choose-clinic" element={<State s="choose_clinic"><ChooseClinic /></State>} />
            <Route path="/" element={<Gate><Launcher /></Gate>} />
            <Route path="/account" element={<Gate><Account /></Gate>} />
            <Route path="/users" element={<Gate><Users /></Gate>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  );
}

// Two-step set-up is open to a signed-in person who has not finished it (required for administrators, optional for others).
function MfaSetupGate() {
  const { me, loading } = useSession();
  if (loading) return null;
  if (!me) return <Navigate to="/signin" replace />;
  if (me.state !== "ok" && me.state !== "mfa_setup_required") return <Navigate to="/" replace />;
  return <MfaSetup />;
}
