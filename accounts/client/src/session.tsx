import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, get, post, type Me } from "./api";

type S = { me: Me | null; loading: boolean; refresh: () => Promise<Me | null>; setMe: (m: Me | null) => void; signOut: () => Promise<void> };
const Ctx = createContext<S>(null as never);
export const useSession = () => useContext(Ctx);

// Loads who is signed in, and keeps two promises while the page is open:
//  - "idle" is measured from real keyboard and mouse use: the page tells the server (at most every 30 s);
//  - every 20 s it asks the server whether the session was locked or ended meanwhile, so the screen follows the server.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const lastPing = useRef(0);

  const refresh = useCallback(async () => {
    try { const m = await get<Me>("/api/me"); setMe(m); return m; }
    catch (e) { if (!(e instanceof ApiError) || e.status !== 401) console.error(e); setMe(null); return null; }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (me?.state !== "ok") return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastPing.current < 30_000) return;
      lastPing.current = now;
      post("/api/activity").catch(() => {});
    };
    const events = ["keydown", "pointerdown", "pointermove", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20_000);
    return () => { events.forEach((e) => window.removeEventListener(e, onActivity)); window.clearInterval(poll); };
  }, [me?.state, refresh]);

  const signOut = useCallback(async () => { await post("/api/logout").catch(() => {}); setMe(null); }, []);
  return <Ctx.Provider value={{ me, loading, refresh, setMe, signOut }}>{children}</Ctx.Provider>;
}
