import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listInbox, getUnreadMessageCount, markThreadRead, snippetOf, type ThreadSummary,
} from '../../lib/messaging.api';

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

export function MessagesBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const unreadQuery = useQuery({
    queryKey: ['messages-unread-count'],
    queryFn: getUnreadMessageCount,
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ['messages-inbox-preview'],
    queryFn: () => listInbox({ perPage: 10 }),
    enabled: open,
  });

  const markReadMutation = useMutation({
    mutationFn: (threadId: string) => markThreadRead(threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['messages-inbox-preview'] });
    },
  });

  function handleClick(t: ThreadSummary) {
    if (t.unread) markReadMutation.mutate(t.threadId);
    setOpen(false);
    navigate(`/projects/messages?threadId=${t.threadId}`);
  }

  const unreadCount = unreadQuery.data?.count ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-9 h-9 rounded text-ink-300 hover:bg-base-800 hover:text-ink-100 transition-colors"
        aria-label="Messages"
      >
        <MailIcon className="w-4.5 h-4.5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-signal text-base-950 text-[9px] font-mono font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 left-0 z-50 w-80 max-h-96 tick-frame panel overflow-hidden flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-base-600 shrink-0">
              <span className="text-xs font-mono uppercase tracking-widest text-ink-500">Messages</span>
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/projects/messages');
                }}
                className="text-[11px] text-blueprint hover:text-blueprint-hover"
              >
                View all
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {listQuery.isLoading && <p className="p-4 text-sm text-ink-500">Loading…</p>}
              {listQuery.data && listQuery.data.data.length === 0 && (
                <p className="p-4 text-sm text-ink-500">No messages yet.</p>
              )}
              {listQuery.data?.data.map((t) => (
                <button
                  key={t.threadId}
                  onClick={() => handleClick(t)}
                  className={`block w-full text-left px-3 py-2.5 border-b border-base-600 last:border-b-0 hover:bg-base-800 transition-colors ${
                    t.unread ? 'bg-blueprint/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {t.unread && <span className="w-1.5 h-1.5 rounded-full bg-blueprint mt-1.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs truncate ${t.unread ? 'text-ink-100' : 'text-ink-300'}`}>
                        <span className="font-medium">{t.fromUserName ?? 'Unknown'}</span> — {t.subject}
                      </div>
                      <div className="text-[10px] text-ink-500 truncate mt-0.5">{snippetOf(t, 60)}</div>
                      <div className="text-[10px] font-mono text-ink-500 mt-0.5">{timeAgo(t.createdAt)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
