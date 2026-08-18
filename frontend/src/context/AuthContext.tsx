import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '@tradeit/shared';
import { authApi, tokens } from '../api/client';

interface AuthContextValue {
  user: AuthUser | null;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = 'tradeit.user';

function storedUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (tokens.access() ? storedUser() : null));

  const signInWithGoogle = useCallback(async (idToken: string) => {
    const result = await authApi.google(idToken);
    tokens.set(result);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setUser(result.user);
  }, []);

  const signOut = useCallback(() => {
    tokens.clear();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, signInWithGoogle, signOut }),
    [user, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
