import axios, { type AxiosInstance, type AxiosError } from 'axios';
import type { AgentConfig, IngestActivityItem } from './types.js';
import { updateTokens } from './config.js';

export interface IngestResult {
  total: number;
  inserted: number;
  duplicates: number;
  rejected: number;
}

export interface UploadUrlResult {
  uploadUrl: string;
  storageKey: string;
}

export interface ApiClient {
  ingestActivities(items: IngestActivityItem[]): Promise<IngestResult>;
  requestScreenshotUploadUrl(): Promise<UploadUrlResult>;
  recordScreenshot(params: { storageKey: string; capturedAt: string; deviceId: string }): Promise<void>;
  isForbidden(err: unknown): boolean;
}

// Authenticated client for the agent's steady-state loops (post-enrollment).
// Mirrors apps/web/src/lib/api.ts's single-flight-refresh-on-401 pattern --
// the agent needs the identical "don't lose the request, don't refresh
// twice for two concurrent 401s" behavior a browser client already has,
// since it runs unattended for hours between token expiries.
export function createApiClient(config: AgentConfig): ApiClient {
  const http: AxiosInstance = axios.create({ baseURL: config.serverUrl });
  let accessToken = config.accessToken;
  let refreshToken = config.refreshToken;
  let refreshPromise: Promise<string> | null = null;

  http.interceptors.request.use((req) => {
    req.headers = req.headers ?? {};
    (req.headers as Record<string, string>).Authorization = `Bearer ${accessToken}`;
    return req;
  });

  http.interceptors.response.use(
    (res) => res,
    async (error: AxiosError & { config?: { _retried?: boolean } }) => {
      const original = error.config;
      if (error.response?.status === 401 && original && !original._retried) {
        original._retried = true;
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${config.serverUrl}/auth/refresh`, { refreshToken })
            .then((res) => {
              const tokens = res.data.data.tokens as { accessToken: string; refreshToken: string };
              accessToken = tokens.accessToken;
              refreshToken = tokens.refreshToken;
              updateTokens(tokens.accessToken, tokens.refreshToken);
              return tokens.accessToken;
            })
            .finally(() => { refreshPromise = null; });
        }
        const newToken = await refreshPromise;
        (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        return http.request(original);
      }
      return Promise.reject(error);
    },
  );

  return {
    async ingestActivities(items) {
      const res = await http.post('/workforce/activities/ingest', { activities: items });
      return res.data.data as IngestResult;
    },
    async requestScreenshotUploadUrl() {
      const res = await http.post('/workforce/screenshots/upload-url', {});
      return res.data.data as UploadUrlResult;
    },
    async recordScreenshot(params) {
      await http.post('/workforce/screenshots', params);
    },
    isForbidden(err: unknown): boolean {
      return axios.isAxiosError(err) && err.response?.status === 403;
    },
  };
}
