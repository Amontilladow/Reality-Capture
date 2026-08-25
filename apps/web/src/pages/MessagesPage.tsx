import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/ui/Modal';
import {
  listInbox, listSent, getThread, sendMessage, replyToThread, markThreadRead,
  snippetOf, type ThreadSummary,
} from '../lib/messaging.api';
import { listUsers, type CompanyUser } from '../lib/users.api';
import { useAuthStore } from '../store/auth.store';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function userLabel(u: CompanyUser): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
  return name ? `${name} (${u.email})` : u.email;
}

export default function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const threadId = searchParams.get('threadId');
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const queryClient = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: ['messages-inbox'],
    queryFn: () => listInbox({ perPage: 100 }),
    enabled: tab === 'inbox' && !threadId,
  });

  const sentQuery = useQuery({
    queryKey: ['messages-sent'],
    queryFn: () => listSent({ perPage: 100 }),
    enabled: tab === 'sent' && !threadId,
  });

  const threadQuery = useQuery({
    queryKey: ['messages-thread', threadId],
    queryFn: () => getThread(threadId as string),
    enabled: Boolean(threadId),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markThreadRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['messages-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['messages-inbox-preview'] });
    },
  });

  const replyMutation = useMutation({
    mutationFn: (body: string) => replyToThread(threadId as string, body),
    onSuccess: () => {
      setReplyBody('');
      queryClient.invalidateQueries({ queryKey: ['messages-thread', threadId] });
    },
  });

  function openThread(t: ThreadSummary) {
    if (t.unread) markReadMutation.mutate(t.threadId);
    setSearchParams({ threadId: t.threadId });
  }

  function closeThread() {
    const next = new URLSearchParams(searchParams);
    next.delete('threadId');
    setSearchParams(next);
  }

  function submitReply(e: FormEvent) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    replyMutation.mutate(replyBody.trim());
  }

  if (threadId) {
    const messages = threadQuery.data ?? [];
    return (
      <>
        <PageHeader
          eyebrow="Messages"
          title={messages[0]?.subject ?? 'Thread'}
          actions={
            <button onClick={closeThread} className="btn-ghost text-xs">
              ← Back to inbox
            </button>
          }
        />
        <div className="p-6 space-y-4 max-w-3xl">
          {threadQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

          {!threadQuery.isLoading && messages.length === 0 && (
            <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
              This thread has no messages.
            </div>
          )}

          {messages.length > 0 && (
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.id} className="tick-frame panel p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">{m.fromUserName ?? 'Unknown sender'}</span>
                    <span className="text-[10px] font-mono text-ink-500">{timeAgo(m.createdAt)}</span>
                  </div>
                  <div className="text-sm text-ink-300 whitespace-pre-wrap">{m.body}</div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={submitReply} className="tick-frame panel p-4 space-y-2">
            <textarea
              className="field-input w-full min-h-[80px]"
              placeholder="Write a reply…"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
            />
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={replyMutation.isPending || !replyBody.trim()}>
                {replyMutation.isPending ? 'Sending…' : 'Reply'}
              </button>
            </div>
          </form>
        </div>
      </>
    );
  }

  const activeQuery = tab === 'inbox' ? inboxQuery : sentQuery;
  const rows = activeQuery.data?.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Company-wide"
        title="Messages"
        actions={
          <button onClick={() => setComposeOpen(true)} className="btn-primary">
            + Compose
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('inbox')}
            className={`px-3 py-1.5 rounded text-sm ${tab === 'inbox' ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800'}`}
          >
            Inbox
          </button>
          <button
            onClick={() => setTab('sent')}
            className={`px-3 py-1.5 rounded text-sm ${tab === 'sent' ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800'}`}
          >
            Sent
          </button>
        </div>

        {activeQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {!activeQuery.isLoading && rows.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            {tab === 'inbox' ? 'No messages yet.' : 'No sent messages yet.'}
          </div>
        )}

        {rows.length > 0 && (
          <div className="panel tick-frame overflow-hidden">
            {rows.map((t) => (
              <button
                key={t.threadId}
                onClick={() => openThread(t)}
                className={`block w-full text-left px-4 py-3 border-b border-base-700/60 last:border-0 hover:bg-base-800/40 transition-colors ${
                  t.unread ? 'bg-blueprint/5' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {t.unread && <span className="w-1.5 h-1.5 rounded-full bg-blueprint mt-1.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${t.unread ? 'text-ink-100 font-semibold' : 'text-ink-300'}`}>
                        {t.fromUserName ?? 'Unknown'}
                      </span>
                      <span className="text-[10px] font-mono text-ink-500 shrink-0">{timeAgo(t.createdAt)}</span>
                    </div>
                    <div className={`text-sm truncate ${t.unread ? 'text-ink-100 font-medium' : 'text-ink-300'}`}>
                      {t.subject}
                    </div>
                    <div className="text-xs text-ink-500 truncate mt-0.5">{snippetOf(t)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </>
  );
}

function ComposeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const usersQuery = useQuery({
    queryKey: ['company-users-for-messaging'],
    queryFn: () => listUsers(),
    enabled: open,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      sendMessage({ subject: subject.trim(), body: body.trim(), recipientUserIds: recipients }),
    onSuccess: () => {
      setSubject('');
      setBody('');
      setRecipients([]);
      queryClient.invalidateQueries({ queryKey: ['messages-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['messages-sent'] });
      onClose();
    },
  });

  function toggleRecipient(id: string) {
    setRecipients((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim() || recipients.length === 0) return;
    sendMutation.mutate();
  }

  const candidates = (usersQuery.data?.data ?? []).filter((u) => u.id !== currentUser?.id);

  return (
    <Modal open={open} onClose={onClose} title="Compose message" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-ink-500 block mb-1">Recipients</label>
          {usersQuery.isLoading && <div className="text-sm text-ink-500">Loading users…</div>}
          <div className="max-h-40 overflow-y-auto tick-frame panel p-2 space-y-1">
            {candidates.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-base-800 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={recipients.includes(u.id)}
                  onChange={() => toggleRecipient(u.id)}
                />
                {userLabel(u)}
              </label>
            ))}
            {!usersQuery.isLoading && candidates.length === 0 && (
              <div className="text-sm text-ink-500 px-2 py-1.5">No other users to message.</div>
            )}
          </div>
        </div>

        <div>
          <label className="text-xs text-ink-500 block mb-1">Subject</label>
          <input className="field-input w-full" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div>
          <label className="text-xs text-ink-500 block mb-1">Message</label>
          <textarea
            className="field-input w-full min-h-[120px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={sendMutation.isPending || !subject.trim() || !body.trim() || recipients.length === 0}
          >
            {sendMutation.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
