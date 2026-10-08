import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import {
  getAiConnectionStatus, connectAiProvider, testAiConnection, disconnectAiProvider,
  BYO_AI_PROVIDERS, BYO_AI_PROVIDER_LABELS, type ByoAiProvider,
} from '../lib/ai-connections.api';
import { apiErrorMessage } from '../lib/api';

// Spec sections 5-8: Mode A "RealityCapture AI" (platform-provided, the
// default -- nothing to configure) vs Mode B "Bring Your Own AI" (this
// user's own provider credentials, stored encrypted server-side and never
// re-displayed once submitted -- only a last-4 fingerprint). Connecting
// doesn't change WHAT the assistant can do: it still goes through the same
// domain guard, tools and project permissions either way, only which model
// answers and who pays for it changes.
const NEEDS_BASE_URL: ReadonlySet<ByoAiProvider> = new Set(['custom_openai_compatible', 'ollama']);
const NEEDS_NO_API_KEY: ReadonlySet<ByoAiProvider> = new Set(['ollama']);

const DEFAULT_MODEL: Record<ByoAiProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.0-flash',
  custom_openai_compatible: '',
  ollama: 'llama3',
};

export default function AiSettingsPage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ['ai-connection-status'], queryFn: getAiConnectionStatus });

  const [provider, setProvider] = useState<ByoAiProvider>('openai');
  const [model, setModel] = useState(DEFAULT_MODEL.openai);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const connectMutation = useMutation({
    mutationFn: () => connectAiProvider({
      provider, model: model.trim(),
      baseUrl: NEEDS_BASE_URL.has(provider) ? baseUrl.trim() : undefined,
      apiKey: NEEDS_NO_API_KEY.has(provider) ? undefined : apiKey.trim(),
    }),
    onSuccess: () => {
      setApiKey('');
      queryClient.invalidateQueries({ queryKey: ['ai-connection-status'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: testAiConnection,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-connection-status'] }),
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectAiProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-connection-status'] }),
  });

  const status = statusQuery.data;
  const connected = status?.connected ?? false;

  function handleProviderChange(next: ByoAiProvider) {
    setProvider(next);
    setModel(DEFAULT_MODEL[next]);
    setBaseUrl('');
  }

  return (
    <>
      <PageHeader eyebrow="Account Settings" title="AI Provider" />
      <div className="p-6 space-y-6 max-w-3xl">
        <div className="panel tick-frame p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">AI Mode</h2>
            <p className="text-xs text-ink-500 mt-1">
              By default, the AI Assistant runs on RealityCapture's own AI provider -- nothing to set up.
              Connect your own provider below to run the assistant on your account instead. Either way, the
              assistant only answers within RealityCapture's own rules: the same domain guard, tools, and
              project permissions apply regardless of which provider answers.
            </p>
          </div>

          {statusQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}

          {!statusQuery.isLoading && (
            <div className="flex items-center justify-between rounded border border-base-700/60 px-3 py-2.5">
              <div className="text-sm">
                <span className="text-ink-100 font-medium">
                  {connected ? 'My AI Provider' : 'RealityCapture AI'}
                </span>
                {connected && status?.provider && (
                  <span className="text-ink-500 ml-2">
                    {BYO_AI_PROVIDER_LABELS[status.provider]} · {status.model}
                  </span>
                )}
              </div>
              {connected && (
                <span className={status?.lastValidationError ? 'badge bg-danger/15 text-danger' : 'badge bg-ok/15 text-ok'}>
                  {status?.lastValidationError ? 'Connection issue' : 'Connected ✓'}
                </span>
              )}
            </div>
          )}

          {connected && status?.apiKeyLast4 && (
            <p className="text-xs text-ink-500">
              API key ending in <span className="font-mono text-ink-300">…{status.apiKeyLast4}</span>.
              {status.lastValidatedAt && ` Last validated ${new Date(status.lastValidatedAt).toLocaleString()}.`}
            </p>
          )}
          {connected && status?.lastValidationError && (
            <p className="field-error">{status.lastValidationError}</p>
          )}

          {connected && (
            <div className="flex gap-2">
              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="btn-secondary text-xs"
              >
                {testMutation.isPending ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="btn-ghost text-xs text-danger"
              >
                {disconnectMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          )}
          {testMutation.isSuccess && (
            <p className={testMutation.data.ok ? 'text-xs text-ok' : 'field-error'}>
              {testMutation.data.ok ? 'Connection OK.' : (testMutation.data.error ?? 'Connection failed.')}
            </p>
          )}
          {testMutation.isError && <p className="field-error">{apiErrorMessage(testMutation.error)}</p>}
        </div>

        <div className="panel tick-frame p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">
              {connected ? 'Replace Connection' : 'Connect My AI Provider'}
            </h2>
            <p className="text-xs text-ink-500 mt-1">
              Credentials are encrypted at rest and never shown again after you submit them -- only a last-4
              fingerprint is kept. We test the connection before saving it.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="ai-provider">Provider</label>
              <select
                id="ai-provider"
                className="field-input"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as ByoAiProvider)}
              >
                {BYO_AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>{BYO_AI_PROVIDER_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="ai-model">Model</label>
              <input id="ai-model" className="field-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-4o" />
            </div>
          </div>

          {NEEDS_BASE_URL.has(provider) && (
            <div>
              <label className="field-label" htmlFor="ai-base-url">Base URL</label>
              <input
                id="ai-base-url"
                className="field-input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://your-endpoint.example.com/v1'}
              />
            </div>
          )}

          {!NEEDS_NO_API_KEY.has(provider) && (
            <div>
              <label className="field-label" htmlFor="ai-api-key">API Key</label>
              <input id="ai-api-key" type="password" className="field-input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
            </div>
          )}

          {connectMutation.isError && <p className="field-error">{apiErrorMessage(connectMutation.error)}</p>}

          <button
            onClick={() => connectMutation.mutate()}
            disabled={
              connectMutation.isPending
              || !model.trim()
              || (NEEDS_BASE_URL.has(provider) && !baseUrl.trim())
              || (!NEEDS_NO_API_KEY.has(provider) && !apiKey.trim())
            }
            className="btn-primary"
          >
            {connectMutation.isPending ? 'Validating…' : connected ? 'Replace connection' : 'Connect'}
          </button>
        </div>
      </div>
    </>
  );
}
