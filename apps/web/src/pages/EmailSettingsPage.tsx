import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { Alert } from '../components/ui/Alert';
import { StatusBadge } from '../components/ui/Badge';
import type { StatusTone } from '../lib/status-tone';
import {
  getOutlookStatus, getOutlookAuthorizeUrl, testOutlookConnection, disconnectOutlook,
  getGmailStatus, getGmailAuthorizeUrl, testGmailConnection, disconnectGmail,
} from '../lib/email-integration.api';
import { apiErrorMessage } from '../lib/api';
import type { EmailIntegrationStatus, EmailIntegrationStatusValue } from '@engineeringos/types';

// Phase 3C/3D: both providers are now fully wired (connect/status/test/
// disconnect), same shape for each -- the OAuth callback for either one
// redirects the full browser back here with ?outlook=... or ?gmail=...
// (see outlook-integration.controller.ts / gmail-integration.controller.ts).

const STATUS_LABEL: Record<EmailIntegrationStatusValue, string> = {
  not_connected: 'Not Connected',
  connected: 'Connected',
  connection_expired: 'Connection Expired',
  authorization_required: 'Authorization Required',
  error: 'Error',
};

const STATUS_TONE: Record<EmailIntegrationStatusValue, StatusTone> = {
  not_connected: 'neutral',
  connected: 'success',
  connection_expired: 'warning',
  authorization_required: 'warning',
  error: 'danger',
};

function ProviderCard({
  name, status, isLoading, onConnect, onTest, onDisconnect, testPending, disconnectPending, connectPending, testResult, testError,
}: {
  name: string;
  status: EmailIntegrationStatus | undefined;
  isLoading: boolean;
  onConnect: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  testPending: boolean;
  disconnectPending: boolean;
  connectPending: boolean;
  testResult?: { ok: boolean; error?: string };
  testError?: unknown;
}) {
  const value = status?.status ?? 'not_connected';
  const connected = value !== 'not_connected';

  return (
    <div className="panel tick-frame p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">{name}</h2>
        {!isLoading && <StatusBadge tone={STATUS_TONE[value]} label={STATUS_LABEL[value]} />}
      </div>

      {isLoading && <p className="text-sm text-ink-500">Loading…</p>}

      {!isLoading && connected && status?.connectedEmail && (
        <p className="text-sm text-ink-300">
          Connected account: <span className="font-mono text-ink-100">{status.connectedEmail}</span>
        </p>
      )}

      {!isLoading && status?.lastErrorMessage && (
        <p className="field-error">{status.lastErrorMessage}</p>
      )}

      {!isLoading && (
        <div className="flex gap-2">
          {!connected && (
            <button onClick={onConnect} disabled={connectPending} className="btn-primary text-xs">
              {connectPending ? 'Connecting…' : `Connect ${name}`}
            </button>
          )}
          {connected && (
            <button onClick={onTest} disabled={testPending} className="btn-secondary text-xs">
              {testPending ? 'Testing…' : 'Test connection'}
            </button>
          )}
          {connected && (
            <button onClick={onDisconnect} disabled={disconnectPending} className="btn-ghost text-xs text-danger">
              {disconnectPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      )}

      {testResult && (
        <p className={testResult.ok ? 'text-xs text-ok' : 'field-error'}>
          {testResult.ok ? 'Connection OK.' : (testResult.error ?? 'Connection failed.')}
        </p>
      )}
      {testError !== undefined && <p className="field-error">{apiErrorMessage(testError)}</p>}
    </div>
  );
}

type ProviderKey = 'outlook' | 'gmail';
const PROVIDER_DISPLAY_NAME: Record<ProviderKey, string> = { outlook: 'Outlook', gmail: 'Gmail' };
const PROVIDER_CONSENT_OWNER: Record<ProviderKey, string> = { outlook: 'Microsoft', gmail: 'Google' };

export default function EmailSettingsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [redirectOutcome, setRedirectOutcome] = useState<{ provider: ProviderKey; outcome: string } | null>(null);

  const outlookStatusQuery = useQuery({ queryKey: ['email-integration', 'outlook', 'status'], queryFn: getOutlookStatus });
  const gmailStatusQuery = useQuery({ queryKey: ['email-integration', 'gmail', 'status'], queryFn: getGmailStatus });

  // Read once on mount (a real page load from the OAuth callback redirect,
  // not an API response) and strip the param so a refresh doesn't re-show it.
  useEffect(() => {
    const providers: ProviderKey[] = ['outlook', 'gmail'];
    const matched = providers.find((p) => searchParams.get(p));
    if (matched) {
      setRedirectOutcome({ provider: matched, outcome: searchParams.get(matched)! });
      queryClient.invalidateQueries({ queryKey: ['email-integration', matched, 'status'] });
      const next = new URLSearchParams(searchParams);
      next.delete(matched);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectOutlookMutation = useMutation({
    mutationFn: async () => {
      const { url } = await getOutlookAuthorizeUrl();
      window.location.href = url; // full browser redirect -- OAuth consent cannot happen inside an XHR
    },
  });
  const testOutlookMutation = useMutation({
    mutationFn: testOutlookConnection,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email-integration', 'outlook', 'status'] }),
  });
  const disconnectOutlookMutation = useMutation({
    mutationFn: disconnectOutlook,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email-integration', 'outlook', 'status'] }),
  });

  const connectGmailMutation = useMutation({
    mutationFn: async () => {
      const { url } = await getGmailAuthorizeUrl();
      window.location.href = url;
    },
  });
  const testGmailMutation = useMutation({
    mutationFn: testGmailConnection,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email-integration', 'gmail', 'status'] }),
  });
  const disconnectGmailMutation = useMutation({
    mutationFn: disconnectGmail,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email-integration', 'gmail', 'status'] }),
  });

  return (
    <>
      <PageHeader eyebrow="Account Settings" title="Email Integration" />
      <div className="p-6 space-y-6 max-w-3xl">
        <p className="text-xs text-ink-500">
          Connect your own Outlook or Gmail mailbox to send project-related email (RFIs, issues, submittals) from
          your own address, with every message recorded against the right project. We never see or store your
          email password, and access/refresh tokens are encrypted at rest and never sent to this page.
        </p>

        {redirectOutcome?.outcome === 'connected' && (
          <Alert tone="success" title={`${PROVIDER_DISPLAY_NAME[redirectOutcome.provider]} connected`}>
            Your {PROVIDER_DISPLAY_NAME[redirectOutcome.provider]} account is now connected.
          </Alert>
        )}
        {redirectOutcome?.outcome === 'declined' && (
          <Alert tone="warning" title="Connection cancelled">
            You declined the {PROVIDER_CONSENT_OWNER[redirectOutcome.provider]} consent request, so {PROVIDER_DISPLAY_NAME[redirectOutcome.provider]} was not connected.
          </Alert>
        )}
        {redirectOutcome?.outcome === 'failed' && (
          <Alert tone="danger" title="Connection failed">
            Something went wrong connecting {PROVIDER_DISPLAY_NAME[redirectOutcome.provider]}. Please try again.
          </Alert>
        )}

        <ProviderCard
          name="Microsoft Outlook"
          status={outlookStatusQuery.data}
          isLoading={outlookStatusQuery.isLoading}
          onConnect={() => connectOutlookMutation.mutate()}
          onTest={() => testOutlookMutation.mutate()}
          onDisconnect={() => disconnectOutlookMutation.mutate()}
          connectPending={connectOutlookMutation.isPending}
          testPending={testOutlookMutation.isPending}
          disconnectPending={disconnectOutlookMutation.isPending}
          testResult={testOutlookMutation.data}
          testError={testOutlookMutation.isError ? testOutlookMutation.error : undefined}
        />

        <ProviderCard
          name="Google Gmail"
          status={gmailStatusQuery.data}
          isLoading={gmailStatusQuery.isLoading}
          onConnect={() => connectGmailMutation.mutate()}
          onTest={() => testGmailMutation.mutate()}
          onDisconnect={() => disconnectGmailMutation.mutate()}
          connectPending={connectGmailMutation.isPending}
          testPending={testGmailMutation.isPending}
          disconnectPending={disconnectGmailMutation.isPending}
          testResult={testGmailMutation.data}
          testError={testGmailMutation.isError ? testGmailMutation.error : undefined}
        />
      </div>
    </>
  );
}
