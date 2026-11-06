import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { Listbox } from '../components/ui/Listbox';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, acknowledgeNotification,
  lookupIssueProject, NOTIFICATION_CATEGORIES, type Notification, type NotificationCategory,
} from '../lib/notifications.api';

const PER_PAGE = 25;

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  drawing: 'Drawings', issue: 'Issues', ncr: 'NCR', sor: 'SOR', rfi: 'RFIs', submittal: 'Submittals',
  assignment: 'Assignments', approval: 'Approvals', deadline: 'Deadlines', announcement: 'Announcements',
};

const PRIORITY_BADGE: Record<Notification['priority'], string> = {
  critical: 'bg-danger/15 text-danger', high: 'bg-warn/15 text-warn', normal: 'bg-base-700 text-ink-500',
};

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

// Master spec section 4 channel 1: "notification history", "search and
// filtering" -- the bell dropdown only ever shows the last 10; this is the
// full, paginated record every notification the current user has ever
// received, filterable by category and free text.
export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [search, category, unreadOnly]);

  const listQuery = useQuery({
    queryKey: ['notifications-history', search, category, unreadOnly, page],
    queryFn: () => listNotifications({ search: search || undefined, category: category || undefined, unreadOnly: unreadOnly || undefined, page, perPage: PER_PAGE }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-history'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => acknowledgeNotification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-history'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-history'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  // Same resource-type -> route map as the bell dropdown.
  function routeFor(resourceType: string, projectId: string, resourceId: string): string | null {
    switch (resourceType) {
      case 'issue': return `/projects/${projectId}/issues?issueId=${resourceId}`;
      case 'rfi': return `/projects/${projectId}/rfis`;
      case 'snag_item': return `/projects/${projectId}/snagging`;
      case 'qaqc_record': return `/projects/${projectId}/qaqc`;
      case 'submittal': return `/projects/${projectId}/submittals`;
      case 'site_drawing': return `/projects/${projectId}/site-drawings`;
      default: return null;
    }
  }

  async function openNotification(n: Notification) {
    if (!n.readAt) markReadMutation.mutate(n.id);
    if (!n.resourceType || !n.resourceId) return;
    if (n.projectId) {
      const route = routeFor(n.resourceType, n.projectId, n.resourceId);
      if (route) navigate(route);
      return;
    }
    if (n.resourceType === 'issue') {
      try {
        const issue = await lookupIssueProject(n.resourceId);
        navigate(`/projects/${issue.projectId}/issues?issueId=${n.resourceId}`);
      } catch {
        // Issue may have been deleted since the notification was created.
      }
    }
  }

  const notifications = listQuery.data?.data ?? [];
  const total = listQuery.data?.meta?.total ?? 0;
  const totalPages = listQuery.data?.meta?.totalPages ?? 1;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Notifications' }]}
        title="Notifications"
        subtitle="Everything the platform has notified you about, across every project."
        actions={
          <button onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending} className="btn-secondary">
            Mark all read
          </button>
        }
      />
      <div className="p-6 space-y-4">
        <div className="panel p-4 flex items-center gap-2 flex-wrap">
          <input
            type="text" placeholder="Search title or body…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="field-input w-56 text-xs !py-2"
          />
          <Listbox aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="field-input w-auto text-xs !py-2">
            <option value="">All categories</option>
            {NOTIFICATION_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </Listbox>
          <label className="flex items-center gap-2 text-xs text-ink-300">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
        </div>

        {listQuery.isLoading && <div className="panel tick-frame p-10 text-center text-sm text-ink-500">Loading…</div>}

        {!listQuery.isLoading && (
          <>
            <div className="panel tick-frame divide-y divide-base-700/60">
              {notifications.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-500">No notifications match the current filters.</div>}
              {notifications.map((n) => (
                <div key={n.id} className={`px-4 py-4 flex items-start justify-between gap-4 flex-wrap ${!n.readAt ? 'bg-blueprint/5' : ''}`}>
                  <button onClick={() => openNotification(n)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm ${!n.readAt ? 'text-ink-100 font-medium' : 'text-ink-300'}`}>{n.title}</span>
                      <span className={`badge text-xs ${PRIORITY_BADGE[n.priority]}`}>{n.priority}</span>
                      {n.category && <span className="badge bg-base-700 text-ink-500 text-xs">{CATEGORY_LABELS[n.category]}</span>}
                      {n.actionRequired && !n.acknowledgedAt && <span className="badge bg-warn/15 text-warn text-xs">Action required</span>}
                    </div>
                    {n.body && <div className="text-xs text-ink-500 mt-0">{n.body}</div>}
                    <div className="text-xs text-ink-500 mt-0">{timeAgo(n.createdAt)}</div>
                  </button>
                  {n.actionRequired && !n.acknowledgedAt && (
                    <button
                      onClick={(e) => { e.stopPropagation(); acknowledgeMutation.mutate(n.id); }}
                      disabled={acknowledgeMutation.isPending}
                      className="btn-secondary !px-2 !py-2 text-xs shrink-0"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-ink-500 px-2">
                <span>Page {page} of {totalPages} · {total} notification{total === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost !px-2 !py-2 disabled:opacity-40">Previous</button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-ghost !px-2 !py-2 disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
