import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { listApiKeys, createApiKey, revokeApiKey, type ApiKey } from '../lib/api-keys.api';
import {
  listWebhookEndpoints, createWebhookEndpoint, deleteWebhookEndpoint, setWebhookActive,
  listWebhookDeliveries, WEBHOOK_EVENT_TYPES, type WebhookEndpoint,
} from '../lib/webhooks.api';
import { getSignupCode, regenerateSignupCode } from '../lib/tenancy.api';
import { apiErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

function SecretReveal({ label, secret }: { label: string; secret: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="panel p-3 space-y-1">
      <p className="text-xs text-danger font-medium">{label} — copy it now, it won't be shown again.</p>
      <div className="flex items-center gap-2">
        <input readOnly value={secret} className="field-input flex-1 text-xs font-mono" onFocus={(e) => e.target.select()} />
        <button onClick={handleCopy} className="btn-secondary !px-3 !py-1.5 text-xs">{copied ? 'Copied!' : 'Copy'}</button>
      </div>
    </div>
  );
}

// Gated server-side to super_admin (see TenancyController) -- the code
// shown/regenerated here is a credential that lets anyone holding it create
// an account under this company, so it gets the same sensitivity level as
// an API key above.
function SignupCodeSection() {
  const queryClient = useQueryClient();
  const codeQuery = useQuery({ queryKey: ['signup-code'], queryFn: getSignupCode });
  const regenerateMutation = useMutation({
    mutationFn: regenerateSignupCode,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signup-code'] }),
  });

  const code = codeQuery.data?.signupCode;
  const signupLink = code ? `${window.location.origin}/signup?code=${code}` : null;

  async function copyLink() {
    if (signupLink) await navigator.clipboard.writeText(signupLink);
  }

  return (
    <div className="panel tick-frame p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Self-Signup Code</h2>
        <p className="text-xs text-ink-500 mt-1">
          Share this code (or the link below) with anyone who needs their own account -- clients, PMC,
          consultants, contractors. They pick their own organization and position at signup; every new
          account lands pending until a Super Admin approves it, same as an accepted invitation.
        </p>
      </div>

      {codeQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
      {!codeQuery.isLoading && !code && (
        <p className="text-sm text-ink-500">No signup code has been generated yet.</p>
      )}

      {code && (
        <div className="flex items-center gap-2">
          <input readOnly value={signupLink ?? ''} className="field-input flex-1 text-xs font-mono" onFocus={(e) => e.target.select()} />
          <button onClick={copyLink} className="btn-secondary !px-3 !py-1.5 text-xs">Copy link</button>
        </div>
      )}

      {regenerateMutation.isError && <p className="field-error">{apiErrorMessage(regenerateMutation.error)}</p>}

      <button
        onClick={() => regenerateMutation.mutate()}
        className="btn-secondary text-xs"
        disabled={regenerateMutation.isPending}
      >
        {regenerateMutation.isPending ? 'Generating…' : code ? 'Regenerate code (invalidates the old one)' : 'Generate signup code'}
      </button>
    </div>
  );
}

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const keysQuery = useQuery({ queryKey: ['api-keys'], queryFn: listApiKeys });
  const createMutation = useMutation({
    mutationFn: () => createApiKey(name.trim()),
    onSuccess: () => { setName(''); queryClient.invalidateQueries({ queryKey: ['api-keys'] }); },
  });
  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revokeApiKey(keyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  return (
    <div className="panel tick-frame p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Public API Keys</h2>
        <p className="text-xs text-ink-500 mt-1">
          Authenticate read-only requests to projects, captures, issues and progress via the X-API-Key header.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="field-label" htmlFor="apikey-name">Name</label>
          <input id="apikey-name" className="field-input" placeholder="e.g. Procore sync" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending} className="btn-primary">
          {createMutation.isPending ? 'Generating…' : 'Generate key'}
        </button>
      </div>
      {createMutation.isError && <p className="field-error">{apiErrorMessage(createMutation.error)}</p>}
      {createMutation.data && <SecretReveal label="API key" secret={createMutation.data.apiKey} />}

      {(keysQuery.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-ink-500">No API keys yet.</p>
      ) : (
        <div className="divide-y divide-base-700/60">
          {(keysQuery.data ?? []).map((k: ApiKey) => (
            <div key={k.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <span className="text-ink-100">{k.name}</span>
                <span className="text-ink-500 ml-2 text-xs font-mono">{k.keyPrefix}…</span>
                {k.revokedAt && <span className="badge bg-base-700 text-ink-500 ml-2">Revoked</span>}
              </div>
              {!k.revokedAt && (
                <button onClick={() => revokeMutation.mutate(k.id)} disabled={revokeMutation.isPending} className="btn-ghost !px-2 !py-1 text-xs text-danger">
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveriesList({ endpointId }: { endpointId: string }) {
  const deliveriesQuery = useQuery({ queryKey: ['webhook-deliveries', endpointId], queryFn: () => listWebhookDeliveries(endpointId) });
  if ((deliveriesQuery.data?.length ?? 0) === 0) return <p className="text-xs text-ink-500 px-3 pb-2">No deliveries yet.</p>;
  return (
    <div className="px-3 pb-2 space-y-1">
      {(deliveriesQuery.data ?? []).slice(0, 10).map((d) => (
        <div key={d.id} className="flex items-center justify-between text-xs">
          <span className="text-ink-300">{d.eventType}</span>
          <span className={d.status === 'delivered' ? 'text-ok' : 'text-danger'}>
            {d.status} ({d.attempts} attempt{d.attempts === 1 ? '' : 's'})
          </span>
        </div>
      ))}
    </div>
  );
}

function WebhooksSection() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const endpointsQuery = useQuery({ queryKey: ['webhook-endpoints'], queryFn: listWebhookEndpoints });
  const createMutation = useMutation({
    mutationFn: () => createWebhookEndpoint(url.trim(), eventTypes),
    onSuccess: () => { setUrl(''); setEventTypes([]); queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] }); },
  });
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setWebhookActive(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWebhookEndpoint(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] }),
  });

  function toggleEventType(type: string) {
    setEventTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  return (
    <div className="panel tick-frame p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Webhooks</h2>
        <p className="text-xs text-ink-500 mt-1">
          Receive an HMAC-signed POST (X-Webhook-Signature) on issue created, issue status changed, and capture uploaded.
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <label className="field-label" htmlFor="webhook-url">Endpoint URL (https)</label>
          <input id="webhook-url" className="field-input" placeholder="https://example.com/webhooks/engineeringos" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="flex gap-3">
          {WEBHOOK_EVENT_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-xs text-ink-300">
              <input type="checkbox" checked={eventTypes.includes(type)} onChange={() => toggleEventType(type)} />
              {type}
            </label>
          ))}
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={!url.trim() || eventTypes.length === 0 || createMutation.isPending}
          className="btn-primary"
        >
          {createMutation.isPending ? 'Creating…' : 'Add webhook'}
        </button>
      </div>
      {createMutation.isError && <p className="field-error">{apiErrorMessage(createMutation.error)}</p>}
      {createMutation.data && <SecretReveal label="Signing secret" secret={createMutation.data.secret} />}

      {(endpointsQuery.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-ink-500">No webhook endpoints yet.</p>
      ) : (
        <div className="panel tick-frame divide-y divide-base-700/60">
          {(endpointsQuery.data ?? []).map((e: WebhookEndpoint) => (
            <div key={e.id}>
              <div className="flex items-center justify-between px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="text-ink-100 truncate">{e.url}</div>
                  <div className="text-xs text-ink-500">{e.eventTypes.join(', ')}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`badge ${e.isActive ? 'bg-ok/15 text-ok' : 'bg-base-700 text-ink-500'}`}>{e.isActive ? 'Active' : 'Disabled'}</span>
                  <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)} className="text-xs text-blue-400 hover:text-blue-300">
                    {expandedId === e.id ? 'Hide' : 'Deliveries'}
                  </button>
                  <button
                    onClick={() => toggleActiveMutation.mutate({ id: e.id, isActive: !e.isActive })}
                    className="text-xs text-ink-500 hover:text-ink-300"
                  >
                    {e.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => deleteMutation.mutate(e.id)} className="text-xs text-danger hover:text-danger/80">Delete</button>
                </div>
              </div>
              {expandedId === e.id && <DeliveriesList endpointId={e.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DeveloperSettingsPage() {
  // Unlike ApiKeysSection/WebhooksSection (both @Roles('company_admin') --
  // company_admin or above), the signup code is gated to super_admin only
  // server-side (TenancyController), same sensitivity level as
  // updateSettings(). This nav item is reachable by any company_admin, so
  // render the section only when the API would actually accept the
  // request -- a company_admin otherwise sees ApiKeys/Webhooks work fine
  // and the signup-code section silently absent, not an error.
  const isSuperAdmin = useAuthStore((s) => s.user?.companyRole === 'super_admin');

  return (
    <>
      <PageHeader eyebrow="Company Settings" title="Developer" />
      <div className="p-6 space-y-6 max-w-3xl">
        {isSuperAdmin && <SignupCodeSection />}
        <ApiKeysSection />
        <WebhooksSection />
      </div>
    </>
  );
}
