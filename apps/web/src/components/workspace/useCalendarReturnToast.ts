import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '../../store/toast.store';
import { CALENDAR_PROVIDER_LABEL, type CalendarProvider } from '../../lib/workspace.api';

// After Google/Microsoft send the browser back (?calendar=connected|declined|failed),
// say what happened once, refresh the calendar, and tidy the URL.
export function useCalendarReturnToast() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const outcome = params.get('calendar');
  useEffect(() => {
    if (!outcome) return;
    const name = CALENDAR_PROVIDER_LABEL[params.get('provider') as CalendarProvider] ?? 'Your calendar';
    if (outcome === 'connected') {
      showToast(`${name} connected. Your meetings now show here.`, 'success');
      qc.invalidateQueries({ queryKey: ['me'] });
    } else if (outcome === 'declined') showToast(`${name} wasn't connected: access was declined.`, 'info');
    else showToast(`Couldn't connect ${name}. Try again, or ask your administrator.`, 'danger');
    const next = new URLSearchParams(params);
    next.delete('calendar');
    next.delete('provider');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);
}
