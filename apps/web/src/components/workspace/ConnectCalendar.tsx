import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, type MenuItem } from '../ui/Menu';
import {
  listCalendarConnections, getCalendarAuthorizeUrl, disconnectCalendar,
  CALENDAR_PROVIDER_LABEL, type CalendarProvider,
} from '../../lib/workspace.api';
import { apiErrorMessage } from '../../lib/api';
import { showToast } from '../../store/toast.store';

// "+ Connect calendar": optionally link your own Google or Outlook
// calendar so your meetings show beside your project deadlines. Read-only:
// RealityCapture never creates or changes events there. A provider your
// organisation hasn't set up yet is shown, but disabled, with the reason.
export function ConnectCalendar({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: ['me', 'calendar-connections'], queryFn: listCalendarConnections, staleTime: 60_000 });
  const connect = useMutation({
    mutationFn: (p: CalendarProvider) => getCalendarAuthorizeUrl(p),
    // Off to the provider's consent screen; it sends the browser back to My calendar.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => showToast(apiErrorMessage(e), 'danger'),
  });
  const disconnect = useMutation({
    mutationFn: (p: CalendarProvider) => disconnectCalendar(p),
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      showToast(`${CALENDAR_PROVIDER_LABEL[p]} disconnected`, 'success');
    },
    onError: (e) => showToast(apiErrorMessage(e), 'danger'),
  });

  const list = connections.data ?? [];
  const connected = list.filter((c) => c.connected);
  const available: MenuItem[] = list.filter((c) => !c.connected).map((c) => ({
    label: c.configured ? CALENDAR_PROVIDER_LABEL[c.provider] : `${short(c.provider)}: not set up yet`,
    icon: <ProviderIcon provider={c.provider} />,
    disabled: !c.configured,
    onSelect: () => connect.mutate(c.provider),
  }));
  const connectedItems: MenuItem[] = connected.map((c) => ({
    label: `Disconnect ${short(c.provider)}`,
    icon: <ProviderIcon provider={c.provider} />,
    danger: true,
    onSelect: () => disconnect.mutate(c.provider),
  }));
  const sections = [
    ...(available.length ? [{ heading: 'Connect (read-only)', items: available }] : []),
    ...(connectedItems.length ? [{ heading: 'Connected', items: connectedItems }] : []),
  ];

  if (connections.isError || list.length === 0) return null;
  const label = connected.length
    ? `${connected.map((c) => short(c.provider)).join(' + ')} connected`
    : '+ Connect calendar';
  return (
    <Menu
      label="Connect calendar"
      align="right"
      buttonClassName={compact ? 'h-8 px-2 rounded-lg text-xs font-medium text-blueprint hover:bg-ink-100/5' : 'btn-secondary'}
      buttonContent={
        <>
          {connected.length > 0 && <span aria-hidden="true" className="w-2 h-2 rounded-full bg-ok" />}
          {label}
        </>
      }
      sections={sections}
    />
  );
}

function ProviderIcon({ provider }: { provider: CalendarProvider }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
      <text x="12" y="19" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">
        {provider === 'google_calendar' ? 'G' : 'O'}
      </text>
    </svg>
  );
}

const short = (p: CalendarProvider) => (p === 'google_calendar' ? 'Google' : 'Outlook');
