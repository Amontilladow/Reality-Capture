import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { apiErrorMessage } from '../lib/api';
import { createDocumentShare, listDocumentShares, revokeDocumentShare } from '../lib/documents.api';

// Mirrors ProgressReportPage.tsx's own ShareModal pattern exactly: a form to
// generate a link, a readonly URL + Copy button on success, and a list of
// previously issued links with revoke. Lets a project team hand a document
// to someone outside the company -- a client, consultant, or subcontractor
// with no EngineeringOS account -- without routing through Dropbox/
// WeTransfer/etc.
export function DocumentShareModal({
  projectId, documentId, documentTitle, onClose,
}: {
  projectId: string;
  documentId: string;
  documentTitle: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [copied, setCopied] = useState(false);

  const sharesQuery = useQuery({
    queryKey: ['document-shares', projectId, documentId],
    queryFn: () => listDocumentShares(projectId, documentId),
  });

  const createMutation = useMutation({
    mutationFn: () => createDocumentShare(projectId, documentId, { expiresInDays, recipientEmail: recipientEmail || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['document-shares', projectId, documentId] }),
  });

  const revokeMutation = useMutation({
    mutationFn: (shareId: string) => revokeDocumentShare(projectId, documentId, shareId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['document-shares', projectId, documentId] }),
  });

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const now = Date.now();

  return (
    <Modal open onClose={onClose} title={`Share "${documentTitle}"`} wide>
      <div className="space-y-4">
        <p className="text-xs text-ink-500">
          Generates a public link to this file. Anyone with the link can view and download it, logged out, until it expires or is revoked.
          No email is sent automatically. Copy the link yourself.
        </p>

        <div className="flex items-end gap-2">
          <div>
            <label className="field-label" htmlFor="doc-share-recipient">Recipient email (optional, for your own record)</label>
            <input
              id="doc-share-recipient" type="email" className="field-input w-56"
              value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="name@client.com"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="doc-share-expiry">Expires in (days)</label>
            <input
              id="doc-share-expiry" type="number" min={1} max={90} className="field-input w-28"
              value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}
            />
          </div>
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="btn-primary">
            {createMutation.isPending ? 'Generating…' : 'Generate link'}
          </button>
        </div>
        {createMutation.isError && <p className="field-error">{apiErrorMessage(createMutation.error)}</p>}

        {createMutation.data && (
          <div className="panel p-4 space-y-2">
            <div className="flex items-center gap-2">
              <input readOnly value={createMutation.data.shareUrl} className="field-input flex-1 text-xs" onFocus={(e) => e.target.select()} />
              <button onClick={() => handleCopy(createMutation.data!.shareUrl)} className="btn-secondary !px-4 !py-2 text-xs">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="field-label !mb-2">Active and past links</div>
          {(sharesQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-500">No share links generated yet.</p>
          ) : (
            <div className="panel tick-frame divide-y divide-base-700/60">
              {(sharesQuery.data ?? []).map((s) => {
                const expired = new Date(s.expiresAt).getTime() <= now;
                const status = s.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active';
                return (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <div>
                      <span className={`badge ${status === 'Active' ? 'bg-ok/15 text-ok' : 'bg-base-700 text-ink-500'}`}>{status}</span>
                      <span className="text-ink-500 ml-2 text-xs">
                        {s.recipientEmail ? `${s.recipientEmail} · ` : ''}expires {new Date(s.expiresAt).toLocaleDateString('en-GB')}
                      </span>
                    </div>
                    {status === 'Active' && (
                      <button onClick={() => revokeMutation.mutate(s.id)} disabled={revokeMutation.isPending} className="btn-ghost !px-2 !py-2 text-xs text-danger">
                        Revoke
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
