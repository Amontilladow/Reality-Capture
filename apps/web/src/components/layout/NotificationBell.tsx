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

  // Route per resource type, once we know which project it belongs to.
  // Issue links deep-link straight to the record (?issueId=); the other
  // types don't have an equivalent deep-link target on their list pages
  // yet, so they land on the list itself -- still a real destination,
  // just not scrolled-to-and-opened.
  function routeFor(resourceType: string, projectId: string, resourceId: string): string | null {
    switch (resourceType) {
      case 'issue': return `/projects/${projectId}/issues?issueId=${resourceId}`;
      case 'rfi': return `/projects/${projectId}/rfis`;
      case 'snag_item': return `/projects/${projectId}/snagging`;
      default: return null;
    }
  }

  async function handleClick(n: Notification) {
    if (!n.readAt) markReadMutation.mutate(n.id);
    setOpen(false);
    if (!n.resourceType || !n.resourceId) return;

    if (n.projectId) {
      const route = routeFor(n.resourceType, n.projectId, n.resourceId);
      if (route) navigate(route);
      return;
    }

    // Notifications created before project_id was added to the table
    // (migration 019) don't have it -- issue notifications can still
    // resolve their project via the existing per-issue lookup; the other
    // types have no equivalent lookup, so they just stay marked read.
    if (n.resourceType === 'issue') {
      try {
        const issue = await lookupIssueProject(n.resourceId);
        navigate(`/projects/${issue.projectId}/issues?issueId=${n.resourceId}`);
      } catch {
        // Issue may have been deleted since the notification was created —
        // nothing sensible to navigate to.
      }
    }
  }

  const unreadCount = unreadQuery.data?.count ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded text-ink-300 hover:bg-base-700 hover:text-ink-100 transition-colors"
        aria-label="Notifications"
      >
        <BellIcon className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-2 rounded-full bg-signal text-base-950 text-xs font-mono font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed md:absolute top-16 md:top-full inset-x-4 md:inset-x-auto md:mt-2 md:left-0 z-50 md:w-80 max-h-96 tick-frame panel !bg-base-800 overflow-hidden flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b border-base-600 shrink-0">
              <span className="text-xs text-ink-500 font-medium">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  className="text-xs text-blueprint hover:text-blueprint-hover"
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
                  className={`block w-full text-left px-4 py-2 border-b border-base-600 last:border-b-0 hover:bg-base-700 transition-colors ${
                    !n.readAt ? 'bg-blueprint/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-blueprint mt-2 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs ${!n.readAt ? 'text-ink-100' : 'text-ink-300'}`}>{n.title}</div>
                      {n.body && <div className="text-xs text-ink-500 mt-0">{n.body}</div>}
                      <div className="text-xs font-mono text-ink-500 mt-0">{timeAgo(n.createdAt)}</div>
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
