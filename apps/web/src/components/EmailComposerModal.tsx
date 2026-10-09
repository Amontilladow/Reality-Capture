import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { EmailProvider } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { Input, Textarea } from './ui/Field';
import { Alert } from './ui/Alert';
import { apiErrorMessage } from '../lib/api';
import {
  getOutlookStatus, getGmailStatus,
} from '../lib/email-integration.api';
import {
  sendEmail, uploadEmailAttachment,
  type EmailAttachmentInput, type EmailRelatedRecordType,
} from '../lib/email-integration.api';

const PROVIDER_LABEL: Record<EmailProvider, string> = { microsoft: 'Outlook', google: 'Gmail' };

function parseRecipients(raw: string): string[] {
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Phase 3E: the one reusable compose-and-send surface, used standalone
// (a general project communication, no record context) today and -- in
// Phase 3F -- opened with `prefill` from an RFI/Issue/Submittal page so the
// subject/related record are already filled in. Never auto-sends and never
// changes any workflow record's status as a side effect of sending --
// composing an email is its own action, independent of the RFI/Issue/
// Submittal lifecycle it may be about.
export function EmailComposerModal({
  open, onClose, projectId, prefill,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  prefill?: { subject?: string; relatedRecordType?: EmailRelatedRecordType; relatedRecordId?: string };
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const outlookStatusQuery = useQuery({ queryKey: ['email-integration', 'outlook', 'status'], queryFn: getOutlookStatus, enabled: open });
  const gmailStatusQuery = useQuery({ queryKey: ['email-integration', 'gmail', 'status'], queryFn: getGmailStatus, enabled: open });

  const connectedProviders: EmailProvider[] = [
    ...(outlookStatusQuery.data?.status === 'connected' ? (['microsoft'] as const) : []),
    ...(gmailStatusQuery.data?.status === 'connected' ? (['google'] as const) : []),
  ];

  const [provider, setProvider] = useState<EmailProvider | ''>('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [attachments, setAttachments] = useState<EmailAttachmentInput[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [formError, setFormError] = useState('');

  function reset() {
    setProvider(''); setTo(''); setCc(''); setBcc(''); setShowCcBcc(false);
    setSubject(''); setBodyText(''); setAttachments([]); setFormError('');
    setIdempotencyKey(newIdempotencyKey());
  }

  // Applies the prefill once per open, same "re-apply only when the modal
  // is (re)opened" pattern RfiFormModal already uses for its own
  // initialValues -- never fights the user's own edits mid-compose.
  useEffect(() => {
    if (!open) return;
    if (prefill?.subject !== undefined) setSubject(prefill.subject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!provider && connectedProviders.length > 0) setProvider(connectedProviders[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedProviders.join(',')]);

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingCount((n) => n + files.length);
    try {
      const uploaded = await Promise.all(Array.from(files).map((file) => uploadEmailAttachment(projectId, file)));
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setFormError(apiErrorMessage(err));
    } finally {
      setUploadingCount((n) => n - files.length);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const mutation = useMutation({
    mutationFn: () => {
      const toList = parseRecipients(to);
      if (!provider) throw new Error('Choose which connected mailbox to send from.');
      if (toList.length === 0) throw new Error('At least one recipient is required.');
      if (!subject.trim()) throw new Error('Subject is required.');
      if (!bodyText.trim()) throw new Error('Message is required.');

      return sendEmail(projectId, {
        provider,
        to: toList,
        cc: parseRecipients(cc),
        bcc: parseRecipients(bcc),
        subject: subject.trim(),
        bodyText,
        attachments,
        relatedRecordType: prefill?.relatedRecordType,
        relatedRecordId: prefill?.relatedRecordId,
        idempotencyKey,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-messages', projectId] });
      reset();
      onClose();
    },
  });

  const noProvidersConnected = outlookStatusQuery.isFetched && gmailStatusQuery.isFetched && connectedProviders.length === 0;
  const sending = mutation.isPending;
  const canSend = !sending && uploadingCount === 0 && connectedProviders.length > 0;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Compose Email" wide>
      <div className="space-y-4">
        {noProvidersConnected && (
          <Alert tone="warning" title="No mailbox connected">
            Connect your Outlook or Gmail account in{' '}
            <Link to="/projects/email-settings" className="underline">Email Integration settings</Link> before sending.
          </Alert>
        )}

        {connectedProviders.length > 1 && (
          <div>
            <label className="field-label">Send from</label>
            <select className="field-input" value={provider} onChange={(e) => setProvider(e.target.value as EmailProvider)}>
              {connectedProviders.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
            </select>
          </div>
        )}
        {connectedProviders.length === 1 && (
          <p className="text-xs text-ink-500">Sending from your connected {PROVIDER_LABEL[connectedProviders[0]]} account.</p>
        )}

        <Input label="To" placeholder="name@example.com, name2@example.com" value={to} onChange={(e) => setTo(e.target.value)} />

        {!showCcBcc && (
          <button type="button" onClick={() => setShowCcBcc(true)} className="text-xs text-ink-500 underline">
            Add CC/BCC
          </button>
        )}
        {showCcBcc && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="CC" requirement="optional" value={cc} onChange={(e) => setCc(e.target.value)} />
            <Input label="BCC" requirement="optional" value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </div>
        )}

        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <Textarea label="Message" rows={8} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />

        <div>
          <label className="field-label">Attachments (optional)</label>
          <input ref={fileInputRef} type="file" multiple onChange={(e) => handleFilesSelected(e.target.files)} className="text-xs text-ink-300" />
          {uploadingCount > 0 && <p className="text-xs text-ink-500 mt-1">Uploading {uploadingCount} file(s)…</p>}
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((a, i) => (
                <li key={a.storageKey} className="flex items-center justify-between text-xs text-ink-300">
                  <span>{a.filename}</span>
                  <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))} className="text-danger">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(formError || mutation.isError) && (
          <p className="field-error">{formError || apiErrorMessage(mutation.error)}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => { reset(); onClose(); }} className="btn-secondary">Cancel</button>
          <button
            type="button"
            onClick={() => { setFormError(''); mutation.mutate(); }}
            disabled={!canSend}
            className="btn-primary"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
