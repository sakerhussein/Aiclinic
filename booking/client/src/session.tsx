import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { get, post, type Lookups, type Me } from "./api";

type S = { me: Me; look: Lookups; can: (p: string) => boolean };
const Ctx = createContext<S>(null as never);
export const useApp = () => useContext(Ctx);

// Loads who is signed in and the clinic's doctors and services. While the page is open it tells Accounts the person is active
// (keyboard and mouse, at most every 30 s) and checks every 20 s that the session was not locked or ended meanwhile.
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ me: Me; look: Lookups } | null>(null);
  const last = useRef(0);
  useEffect(() => {
    Promise.all([get<Me>("/api/me"), get<Lookups>("/api/lookups")]).then(([me, look]) => setState({ me, look })).catch(() => {});
  }, []);
  useEffect(() => {
    if (!state) return;
    const ping = () => { const n = Date.now(); if (n - last.current > 30_000) { last.current = n; post("/api/activity").catch(() => {}); } };
    const ev = ["keydown", "pointerdown", "pointermove", "touchstart"] as const;
    ev.forEach((e) => window.addEventListener(e, ping, { passive: true }));
    const poll = window.setInterval(() => { if (!document.hidden) get("/api/me").catch(() => {}); }, 20_000);
    return () => { ev.forEach((e) => window.removeEventListener(e, ping)); window.clearInterval(poll); };
  }, [state]);
  if (!state) return null;
  return <Ctx.Provider value={{ ...state, can: (p) => state.me.permissions.includes(p) }}>{children}</Ctx.Provider>;
}
