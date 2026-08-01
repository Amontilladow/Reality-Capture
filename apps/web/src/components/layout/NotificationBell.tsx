import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  lookupIssueProject, type Notification,
} from '../../lib/notifications.api';

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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const unreadQuery = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ['notifications-list'],
    queryFn: () => listNotifications({ perPage: 10 }),
    enabled: open,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });

  async function handleClick(n: Notification) {
    if (!n.readAt) markReadMutation.mutate(n.id);
    setOpen(false);
    if (n.resourceType === 'issue' && n.resourceId) {
      try {
        const issue = await lookupIssueProject(n.resourceId);
        navigate(`/projects/${issue.projectId}/issues?issueId=${n.resourceId}`);
      } catch {
        // Issue may have been deleted since the notification was created —
        // nothing sensible to navigate to, so just leave it marked read.
      }
    }
  }

  const unreadCount = unreadQuery.data?.count ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-9 h-9 rounded text-ink-300 hover:bg-base-800 hover:text-ink-100 transition-colors"
        aria-label="Notifications"
      >
        <BellIcon className="w-4.5 h-4.5" />
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
              <span className="text-xs font-mono uppercase tracking-widest text-ink-500">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  className="text-[11px] text-blueprint hover:text-blueprint-hover"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {listQuery.isLoading && <p className="p-4 text-sm text-ink-500">Loading…</p>}
              {listQuery.data && listQuery.data.data.length === 0 && (
                <p className="p-4 text-sm text-ink-500">No notifications yet.</p>
              )}
              {listQuery.data?.data.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`block w-full text-left px-3 py-2.5 border-b border-base-600 last:border-b-0 hover:bg-base-800 transition-colors ${
                    !n.readAt ? 'bg-blueprint/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-blueprint mt-1.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs ${!n.readAt ? 'text-ink-100' : 'text-ink-300'}`}>{n.title}</div>
                      <div className="text-[10px] font-mono text-ink-500 mt-0.5">{timeAgo(n.createdAt)}</div>
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

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
