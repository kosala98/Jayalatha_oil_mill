import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/endpoints';
import { ApiError } from '../api/http';
import { setSessionExpiredHandler, setSessionToken } from './sessionEvents';

export type Role = 'USER' | 'ADMIN';

export interface Session {
  token: string;
  role: Role;
  /** The account that signed in ("admin", "user"). */
  username?: string;
  expiresAt: string;
  /** When set and in the future, a counter session may open the admin screens. */
  temporaryAdminUntil?: string | null;
}

interface SessionContextValue {
  session: Session | null;
  login(username: string, password: string): Promise<void>;
  logout(): void;
  replace(session: Session): void;
  setTemporaryAdminUntil(until: string | null): void;
  /** True when this session may open the admin screens right now. */
  canSeeAdmin: boolean;
  /** True when that is only because the owner opened a window. */
  isTemporaryAdmin: boolean;
  /** Call from catch blocks: signs out on 401 so the sign-in screen reappears. */
  handleAuthError(err: unknown): boolean;
}

const KEY = 'pos.session';
const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The counter signs in once and stays signed in through the day, so its session is
 * kept on the device. An admin session is never stored: closing the tab, reloading,
 * or half an hour passing all bring back the sign-in screen.
 */
function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (parsed.role !== 'USER' || typeof parsed.token !== 'string') return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    // A stored counter session must be usable before the first render finishes.
    const stored = readStored();
    setSessionToken(stored?.token ?? null);
    return stored;
  });

  const store = useCallback((next: Session | null) => {
    setSession(next);
    // Do this first: a queued transaction may be sent the instant this returns.
    setSessionToken(next?.token ?? null);
    try {
      if (next && next.role === 'USER') localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode: the session simply lasts for this tab */
    }
  }, []);

  // A 401 from a background send means this session is finished — show the PIN pad
  // rather than letting every save fail silently behind a screen that looks fine.
  useEffect(() => {
    setSessionExpiredHandler(() => store(null));
    return () => setSessionExpiredHandler(null);
  }, [store]);

  // Sign out exactly when the token dies, so a stale screen can't linger.
  useEffect(() => {
    if (!session) return;
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => store(null), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [session, store]);

  const login = useCallback(
    async (username: string, password: string) => {
      store(await api.login(username, password));
    },
    [store],
  );

  const setTemporaryAdminUntil = useCallback(
    (until: string | null) => setSession((prev) => (prev ? { ...prev, temporaryAdminUntil: until } : prev)),
    [],
  );

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        store(null);
        return true;
      }
      return false;
    },
    [store],
  );

  const temporaryLive =
    session?.temporaryAdminUntil != null && new Date(session.temporaryAdminUntil).getTime() > Date.now();

  const value = useMemo(
    () => ({
      session,
      login,
      logout: () => store(null),
      replace: store,
      setTemporaryAdminUntil,
      canSeeAdmin: session?.role === 'ADMIN' || (session?.role === 'USER' && temporaryLive),
      isTemporaryAdmin: session?.role === 'USER' && temporaryLive,
      handleAuthError,
    }),
    [session, login, store, setTemporaryAdminUntil, temporaryLive, handleAuthError],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
