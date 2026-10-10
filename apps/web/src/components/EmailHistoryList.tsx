import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from './ui/Badge';
import { apiErrorMessage } from '../lib/api';
import { listEmailMessages, type EmailRelatedRecordType } from '../lib/email-integration.api';

const PROVIDER_LABEL: Record<string, string> = { microsoft: 'Outlook', google: 'Gmail' };

// Phase 3G: a read-only audit trail, metadata only -- there is no message
// body to show (migration 066 never stores one; see its own comment), so
// this renders exactly what the brief's Section 8 field list covers: who
// sent it, from where, to whom, when, the subject, and whether it
// succeeded. Visibility is enforced server-side (EmailComposerService.
// listMessages' own project-membership check) -- this component has no
// separate access decision of its own to get wrong.
export function EmailHistoryList({
  projectId, relatedRecordType, relatedRecordId,
}: {
  projectId: string;
  relatedRecordType?: EmailRelatedRecordType;
  relatedRecordId?: string;
}) {
  const query = useQuery({
    queryKey: ['email-messages', projectId, relatedRecordType, relatedRecordId],
    queryFn: () => listEmailMessages(projectId, { relatedRecordType, relatedRecordId, perPage: 50 }),
  });

  if (query.isLoading) return <p className="text-xs text-ink-500">Loading email history…</p>;
  if (query.isError) return <p className="field-error">{apiErrorMessage(query.error)}</p>;

  const messages = query.data?.data ?? [];
  if (messages.length === 0) return <p className="text-xs text-ink-500">No email sent yet.</p>;

  return (
    <ul className="space-y-2">
      {messages.map((m) => (
        <li key={m.id} className="panel p-3 text-sm">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge tone={m.status === 'sent' ? 'success' : 'danger'} label={m.status === 'sent' ? 'Sent' : 'Failed'} />
            <span className="text-xs text-ink-500">via {PROVIDER_LABEL[m.provider] ?? m.provider}</span>
            <span className="text-xs text-ink-500 ml-auto">{new Date(m.createdAt).toLocaleString()}</span>
          </div>
          <div className="font-medium text-ink-100">{m.subject}</div>
          <div className="text-xs text-ink-500">
            From {m.senderEmail} to {m.recipientsTo.join(', ')}
            {m.recipientsCc.length > 0 && ` (cc: ${m.recipientsCc.join(', ')})`}
          </div>
          <div className="text-xs text-ink-500">Sent by {m.initiatingUserName ?? 'Unknown'}</div>
          {m.status === 'failed' && m.failureReason && <p className="field-error mt-1">{m.failureReason}</p>}
          {m.attachmentMetadata.length > 0 && (
            <div className="text-xs text-ink-500 mt-1">
              Attachments: {m.attachmentMetadata.map((a) => a.filename).join(', ')}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
