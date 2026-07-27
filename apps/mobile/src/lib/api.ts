import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiResponse, ApiError } from '@engineeringos/types';
import { API_BASE_URL } from './config';
import { useAuthStore } from '../store/auth.store';

export const http = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = axios
      .post<ApiResponse<{ accessToken: string; refreshToken: string; expiresIn: number }>>(
        `${API_BASE_URL}/auth/refresh`,
        { refreshToken },
      )
      .then(async (res) => {
        const tokens = res.data.data;
        await useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);
        return tokens.accessToken;
      })
      .catch(async () => {
        await useAuthStore.getState().clear();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retried && !original.url?.includes('/auth/')) {
      original._retried = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${newToken}` };
        return http.request(original);
      }
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiError | undefined;
    if (data?.error?.message) return data.error.message;
    if (err.code === 'ECONNABORTED') return 'Request timed out. Check your connection.';
    if (!err.response) return 'No connection to the server.';
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await http.get<ApiResponse<T>>(url, config);
  return res.data.data;
}
export async function apiPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await http.post<ApiResponse<T>>(url, body, config);
  return res.data.data;
}
export async function apiPatch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await http.patch<ApiResponse<T>>(url, body, config);
  return res.data.data;
}
export async function apiGetWithMeta<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<{ data: T; meta: ApiResponse<T>['meta'] }> {
  const res = await http.get<ApiResponse<T>>(url, config);
  return { data: res.data.data, meta: res.data.meta };
}
