import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import type { ProjectMember } from '../lib/projects.api';
import type { RfiListItem } from '../lib/rfis.api';
import {
  getRfiLetter, saveRfiLetter, shareRfiLetter, buildDefaultLetterBody, formatMemberRole,
} from '../lib/rfi-letters.api';
import { formatDateTime } from '../lib/issue-constants';
import { apiErrorMessage, apiDownload } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

const RECIPIENT_TITLE_PRESETS = ['Cost Controller', 'QS Engineer', 'Project Manager', 'Other'] as const;
type RecipientTitlePreset = typeof RECIPIENT_TITLE_PRESETS[number];

export function RfiNoticeLetterModal({
  open, onClose, projectId, rfi, project, members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  rfi: RfiListItem | null;
  project?: Project;
  members: ProjectMember[];
}) {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [recipientUserId, setRecipientUserId] = useState('');
  const [titleOption, setTitleOption] = useState<RecipientTitlePreset>('Cost Controller');
  const [customTitle, setCustomTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const letterQuery = useQuery({
    queryKey: ['rfi-letter', projectId, rfi?.id],
    queryFn: () => getRfiLetter(projectId, rfi!.id),
    enabled: open && Boolean(projectId) && Boolean(rfi?.id),
  });

  // Seeds the form from the existing draft/shared letter, or -- only when no
  // letter exists yet for this RFI -- from the default template. Runs again
  // whenever a different RFI's letter finishes loading (fresh query result),
  // never overwriting an existing draft's real saved body with the template.
  useEffect(() => {
    if (!open || !rfi || letterQuery.isLoading) return;
    const letter = letterQuery.data;
    setError('');
    if (letter) {
      setRecipientUserId(letter.recipientUserId);
      const isPreset = (RECIPIENT_TITLE_PRESETS as readonly string[]).includes(letter.recipientTitle)
        && letter.recipientTitle !== 'Other';
      setTitleOption(isPreset ? (letter.recipientTitle as RecipientTitlePreset) : 'Other');
      setCustomTitle(isPreset ? '' : letter.recipientTitle);
      setBody(letter.body);
    } else {
      setRecipientUserId('');
      setTitleOption('Cost Controller');
      setCustomTitle('');
      const senderName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : '';
      const senderMember = members.find((m) => m.userId === currentUser?.id);
      setBody(buildDefaultLetterBody({
        rfi,
        project,
        recipientName: '',
        recipientTitle: 'Cost Controller',
        senderName,
        senderTitle: formatMemberRole(senderMember?.role),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rfi?.id, letterQuery.data, letterQuery.isLoading]);

  const resolvedTitle = titleOption === 'Other' ? customTitle.trim() : titleOption;
  const letter = letterQuery.data;
  const letterExists = Boolean(letter);
  const isShared = letter?.status === 'shared';

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!rfi) throw new Error('No RFI selected.');
      if (!recipientUserId) throw new Error('Select a recipient.');
      if (!resolvedTitle) throw new Error('Enter a title for the recipient.');
      if (!body.trim()) throw new Error('Letter body cannot be empty.');
      return saveRfiLetter(projectId, rfi.id, { recipientUserId, recipientTitle: resolvedTitle, body });
    },
    onSuccess: (saved) => {
      setError('');
      queryClient.setQueryData(['rfi-letter', projectId, rfi?.id], saved);
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const shareMutation = useMutation({
    mutationFn: () => {
      if (!rfi) throw new Error('No RFI selected.');
      return shareRfiLetter(projectId, rfi.id);
    },
    onSuccess: (shared) => {
      setError('');
      queryClient.setQueryData(['rfi-letter', projectId, rfi?.id], shared);
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  async function handleDownloadPdf() {
    if (!rfi) return;
    setDownloadError('');
    setDownloading(true);
    try {
      await apiDownload(`/projects/${projectId}/rfis/${rfi.id}/letter/pdf`, `${rfi.rfiNumber ?? rfi.id}-notice-letter.pdf`);
    } catch (err) {
      setDownloadError(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  if (!open || !rfi) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Notice letter — ${rfi.rfiNumber ?? rfi.subject}`} wide>
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        {isShared && letter?.sharedAt && (
          <p className="text-xs text-ok flex items-center gap-1.5">
            <CheckIcon /> Shared {formatDateTime(letter.sharedAt)}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="letterRecipient">Recipient *</label>
            <select
              id="letterRecipient"
              className="field-input"
              value={recipientUserId}
              onChange={(e) => setRecipientUserId(e.target.value)}
            >
              <option value="">Select recipient…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="letterTitle">Title *</label>
            <select
              id="letterTitle"
              className="field-input"
              value={titleOption}
              onChange={(e) => setTitleOption(e.target.value as RecipientTitlePreset)}
            >
              {RECIPIENT_TITLE_PRESETS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {titleOption === 'Other' && (
              <input
                className="field-input mt-2"
                placeholder="Recipient title"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
              />
            )}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="letterBody">Letter body</label>
          <textarea
            id="letterBody"
            className="field-input min-h-[360px] font-mono text-xs whitespace-pre-wrap"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {downloadError && <p className="field-error">{downloadError}</p>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="btn-secondary !px-3 !py-1.5 text-xs"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={() => shareMutation.mutate()}
            disabled={!letterExists || isShared || shareMutation.isPending}
            className="btn-primary !px-3 !py-1.5 text-xs"
            title={!letterExists ? 'Save a draft first' : undefined}
          >
            {shareMutation.isPending ? 'Sharing…' : isShared ? 'Shared' : 'Share'}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!letterExists || downloading}
            className="btn-secondary !px-3 !py-1.5 text-xs ml-auto"
            title={!letterExists ? 'Save a draft first' : undefined}
          >
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
