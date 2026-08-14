import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiResponse, ApiError } from '@engineeringos/types';
import { useAuthStore } from '../store/auth.store';

// In dev, requests go through the Vite dev proxy at /api -> http://localhost:3000/api/v1.
// In production (frontend and backend on separate hosts), VITE_API_BASE must point
// at the deployed API's full URL — set at build time, baked into the bundle by Vite.
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

export const http = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Single-flight refresh: if multiple requests 401 at once, only refresh once.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = axios
      .post<ApiResponse<{ accessToken: string; refreshToken: string; expiresIn: number }>>(
        `${API_BASE}/auth/refresh`,
        { refreshToken },
      )
      .then((res) => {
        const tokens = res.data.data;
        useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);
        return tokens.accessToken;
      })
      .catch(() => {
        useAuthStore.getState().clear();
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
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

// Unwraps the { data, meta, error } envelope every endpoint returns.
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
export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await http.delete<ApiResponse<T>>(url, config);
  return res.data.data;
}

// Downloads a binary response (e.g. a generated PDF) and saves it via the
// browser, the same way a normal <a href download> would. Goes through the
// same authenticated `http` instance as every other call here, since these
// endpoints require the same auth header everything else already gets --
// unlike the S3 downloads elsewhere in this app (those are presigned URLs
// with their own auth baked in and don't need this).
export async function apiDownload(url: string, filename: string): Promise<void> {
  const res = await http.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

// Meta (pagination) alongside data, for list endpoints.
export async function apiGetWithMeta<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<{ data: T; meta: ApiResponse<T>['meta'] }> {
  const res = await http.get<ApiResponse<T>>(url, config);
  return { data: res.data.data, meta: res.data.meta };
}
