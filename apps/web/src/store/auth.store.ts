import { create } from 'zustand';
import type { AuthenticatedUser } from '@engineeringos/types';

const USER_KEY = 'eos.user';

interface AuthState {
  // In memory only -- never persisted. The refresh token lives entirely in
  // an httpOnly cookie the API sets (see apps/api's auth.controller.ts),
  // unreadable by any page-context JavaScript, so a future XSS bug can't
  // exfiltrate it the way it previously could from localStorage. A page
  // reload loses this and re-establishes it via a silent refresh against
  // that cookie (see api.ts's bootstrapSession()).
  accessToken: string | null;
  user: AuthenticatedUser | null;
  // False until bootstrapSession() resolves (or fails) once on app start.
  // ProtectedRoute waits on this instead of redirecting to /login the
  // instant a fresh page load has no in-memory access token yet.
  isHydrated: boolean;
  setSession: (tokens: { accessToken: string }, user: AuthenticatedUser) => void;
  setAccessToken: (accessToken: string) => void;
  setUser: (user: AuthenticatedUser) => void;
  setHydrated: () => void;
  clear: () => void;
}

function readUser(): AuthenticatedUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthenticatedUser) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: readUser(),
  isHydrated: false,

  setSession: (tokens, user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ accessToken: tokens.accessToken, user });
  },

  setAccessToken: (accessToken) => {
    set({ accessToken });
  },

  setUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },

  setHydrated: () => set({ isHydrated: true }),

  clear: () => {
    localStorage.removeItem(USER_KEY);
    set({ accessToken: null, user: null });
  },
}));
