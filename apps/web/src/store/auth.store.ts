import { create } from 'zustand';
import type { AuthenticatedUser } from '@engineeringos/types';

const ACCESS_KEY = 'eos.accessToken';
const REFRESH_KEY = 'eos.refreshToken';
const USER_KEY = 'eos.user';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthenticatedUser | null;
  isHydrated: boolean;
  setSession: (tokens: { accessToken: string; refreshToken: string }, user: AuthenticatedUser) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: AuthenticatedUser) => void;
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
  accessToken: localStorage.getItem(ACCESS_KEY),
  refreshToken: localStorage.getItem(REFRESH_KEY),
  user: readUser(),
  isHydrated: true,

  setSession: (tokens, user) => {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user });
  },

  setTokens: (accessToken, refreshToken) => {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    set({ accessToken, refreshToken });
  },

  setUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },

  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));
