import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listInbox, getUnreadMessageCount, markThreadRead, snippetOf, type ThreadSummary,
} from '../../lib/messaging.api';
import { getChatUnreadCount } from '../../lib/chat.api';
import { setChatPanelOpen } from '../../lib/chatPanel';
import { EmailLauncherButton } from '../ui/EmailLauncherButton';

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

// The header's one messaging icon. It gathers the three ways to talk to
// someone -- the threaded inbox, live team chat (ChatWidget's panel) and
// the user's own email app -- so they no longer sit side by side as look-
// alike envelopes and a floating bubble.
export function MessagesBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const unreadQuery = useQuery({
    queryKey: ['messages-unread-count'],
    queryFn: getUnreadMessageCount,
    refetchInterval: 30_000,
  });

  const chatUnreadQuery = useQuery({
    queryKey: ['chat-unread-count'],
    queryFn: getChatUnreadCount,
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ['messages-inbox-preview'],
    queryFn: () => listInbox({ perPage: 5 }),
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

  const chatUnread = chatUnreadQuery.data?.count ?? 0;
  const unreadCount = (unreadQuery.data?.count ?? 0) + chatUnread;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded text-ink-300 hover:bg-base-700 hover:text-ink-100 transition-colors"
        aria-label={unreadCount > 0 ? `Messages, ${unreadCount} unread` : 'Messages'}
        aria-expanded={open}
      >
        <ChatIcon className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-2 rounded-full bg-signal text-base-950 text-xs font-mono font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed md:absolute top-16 md:top-full inset-x-4 md:inset-x-auto md:mt-2 md:left-0 z-50 md:w-80 max-h-[32rem] tick-frame panel !bg-base-800 overflow-hidden flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b border-base-600 shrink-0">
              <span className="text-xs text-ink-500 font-medium">Messages</span>
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/projects/messages');
                }}
                className="text-xs text-blueprint hover:text-blueprint-hover"
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
                  className={`block w-full text-left px-4 py-2 border-b border-base-600 last:border-b-0 hover:bg-base-700 transition-colors ${
                    t.unread ? 'bg-blueprint/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {t.unread && <span className="w-1.5 h-1.5 rounded-full bg-blueprint mt-2 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs truncate ${t.unread ? 'text-ink-100' : 'text-ink-300'}`}>
                        <span className="font-medium">{t.fromUserName ?? 'Unknown'}</span>: {t.subject}
                      </div>
                      <div className="text-xs text-ink-500 truncate mt-0">{snippetOf(t, 60)}</div>
                      <div className="text-xs font-mono text-ink-500 mt-0">{timeAgo(t.createdAt)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="border-t border-base-600 shrink-0 py-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setChatPanelOpen(true); }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-ink-300 text-left hover:bg-base-700 hover:text-ink-100 transition-colors"
              >
                <ChatIcon className="w-4 h-4 shrink-0" />
                <span className="flex-1">Team chat</span>
                {chatUnread > 0 && <span className="text-xs font-semibold text-ink-100 tabular-nums">{chatUnread} new</span>}
              </button>
              <EmailLauncherButton variant="row" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 5h16v11H8l-4 4V5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
