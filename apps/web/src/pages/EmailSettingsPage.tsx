import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { Alert } from '../components/ui/Alert';
import { StatusBadge } from '../components/ui/Badge';
import type { StatusTone } from '../lib/status-tone';
import {
  getOutlookStatus, getOutlookAuthorizeUrl, testOutlookConnection, disconnectOutlook,
} from '../lib/email-integration.api';
import { apiErrorMessage } from '../lib/api';
import type { EmailIntegrationStatus, EmailIntegrationStatusValue } from '@engineeringos/types';

// Phase 3C: Outlook is fully wired (connect/status/test/disconnect).
// Gmail's card is shown per the brief's "show two providers" UI
// requirement but not yet functional -- its own connect/status/test/
// disconnect endpoints land in Phase 3D, at which point this page gains
// the same four actions for it. Showing a visibly disabled card here is
// more honest than omitting it (the settings section exists now) or
// wiring a button to a route that doesn't exist yet (a confusing 404).

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
  onConnect?: () => void;
  onTest?: () => void;
  onDisconnect?: () => void;
  testPending?: boolean;
  disconnectPending?: boolean;
  connectPending?: boolean;
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
          {!connected && onConnect && (
            <button onClick={onConnect} disabled={connectPending} className="btn-primary text-xs">
              {connectPending ? 'Connecting…' : `Connect ${name}`}
            </button>
          )}
          {!connected && !onConnect && (
            <button disabled className="btn-primary text-xs opacity-50 cursor-not-allowed" title="Coming in the next stage of this phase">
              {`Connect ${name}`}
            </button>
          )}
          {connected && onTest && (
            <button onClick={onTest} disabled={testPending} className="btn-secondary text-xs">
              {testPending ? 'Testing…' : 'Test connection'}
            </button>
          )}
          {connected && onDisconnect && (
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

      {!onConnect && !connected && (
        <p className="text-xs text-ink-500">Gmail support ships in the next stage of this phase.</p>
      )}
    </div>
  );
}

export default function EmailSettingsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [redirectOutcome, setRedirectOutcome] = useState<string | null>(null);

  const outlookStatusQuery = useQuery({ queryKey: ['email-integration', 'outlook', 'status'], queryFn: getOutlookStatus });

  // The OAuth callback redirects the full browser back here with
  // ?outlook=connected|declined|failed (see outlook-integration.controller.ts) --
  // this is a real page load, not an API response, so it's read from the
  // URL once on mount and then stripped so a refresh doesn't re-show it.
  useEffect(() => {
    const outcome = searchParams.get('outlook');
    if (outcome) {
      setRedirectOutcome(outcome);
      queryClient.invalidateQueries({ queryKey: ['email-integration', 'outlook', 'status'] });
      const next = new URLSearchParams(searchParams);
      next.delete('outlook');
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

  return (
    <>
      <PageHeader eyebrow="Account Settings" title="Email Integration" />
      <div className="p-6 space-y-6 max-w-3xl">
        <p className="text-xs text-ink-500">
          Connect your own Outlook or Gmail mailbox to send project-related email (RFIs, issues, submittals) from
          your own address, with every message recorded against the right project. We never see or store your
          email password, and access/refresh tokens are encrypted at rest and never sent to this page.
        </p>

        {redirectOutcome === 'connected' && (
          <Alert tone="success" title="Outlook connected">
            Your Outlook mailbox is now connected.
          </Alert>
        )}
        {redirectOutcome === 'declined' && (
          <Alert tone="warning" title="Connection cancelled">
            You declined the Microsoft consent request, so Outlook was not connected.
          </Alert>
        )}
        {redirectOutcome === 'failed' && (
          <Alert tone="danger" title="Connection failed">
            Something went wrong connecting Outlook. Please try again.
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

        <ProviderCard name="Google Gmail" status={undefined} isLoading={false} />
      </div>
    </>
  );
}
