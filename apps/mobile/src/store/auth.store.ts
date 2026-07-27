import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { AuthenticatedUser } from '@engineeringos/types';

const ACCESS_KEY = 'eos_access_token';
const REFRESH_KEY = 'eos_refresh_token';
const USER_KEY = 'eos_user';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthenticatedUser | null;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setSession: (tokens: { accessToken: string; refreshToken: string }, user: AuthenticatedUser) => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  isHydrated: false,

  hydrate: async () => {
    const [accessToken, refreshToken, userRaw] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    set({
      accessToken,
      refreshToken,
      user: userRaw ? (JSON.parse(userRaw) as AuthenticatedUser) : null,
      isHydrated: true,
    });
  },

  setSession: async (tokens, user) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ]);
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user });
  },

  setTokens: async (accessToken, refreshToken) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
    ]);
    set({ accessToken, refreshToken });
  },

  clear: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));
