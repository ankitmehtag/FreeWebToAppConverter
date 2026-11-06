import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, ApiError, mayBeSignedIn } from './api';

export type Me = { email: string; emailVerified: boolean };

type Session = {
  me: Me | null | undefined;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  // undefined while loading, null when signed out.
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const reload = useCallback(async () => {
    // A visitor who never signed in costs no request, and their console stays free of 401s.
    if (!mayBeSignedIn()) {
      setMe(null);
      return;
    }
    try {
      setMe(await api<Me>('/auth/me'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMe(null);
      else throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <SessionContext.Provider value={{ me, reload, signOut }}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession needs a SessionProvider');
  return session;
};

/** Sends a signed-out visitor to sign in, and back to this page afterwards. */
export const RequireSignIn = ({ children }: { children: ReactNode }) => {
  const { me } = useSession();
  const location = useLocation();
  if (me === undefined) return <p className="loading">Loading…</p>;
  if (me === null) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return children;
};

/** Only same-site paths are followed, so a crafted link can't send someone elsewhere after sign-in. */
export const safeNext = (value: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/my-apps';
