import { apiGet, apiPost, apiDelete } from './api';

export const BYO_AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'custom_openai_compatible', 'ollama'] as const;
export type ByoAiProvider = typeof BYO_AI_PROVIDERS[number];

export const BYO_AI_PROVIDER_LABELS: Record<ByoAiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  custom_openai_compatible: 'Custom (OpenAI-compatible)',
  ollama: 'Ollama (self-hosted)',
};

export interface AiConnectionStatus {
  connected: boolean;
  provider?: ByoAiProvider;
  model?: string;
  baseUrl?: string | null;
  apiKeyLast4?: string;
  lastValidatedAt?: string | null;
  lastValidationError?: string | null;
}

export interface ConnectAiProviderInput {
  provider: ByoAiProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export function getAiConnectionStatus() {
  return apiGet<AiConnectionStatus>('/ai-connections');
}

export function connectAiProvider(input: ConnectAiProviderInput) {
  return apiPost<AiConnectionStatus>('/ai-connections', input);
}

export function testAiConnection() {
  return apiPost<{ ok: boolean; error?: string }>('/ai-connections/test');
}

export function disconnectAiProvider() {
  return apiDelete<{ connected: false }>('/ai-connections');
}
