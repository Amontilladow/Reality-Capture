import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPreferences, updatePreferences, getAgenda, browserTimeZone, type WorkspacePreferences, type AgendaItem } from '../../lib/workspace.api';
import type { DayMarks } from './MiniCalendar';
import { useNow, zonedParts, hour12For } from './time';

export function usePreferences() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['me-preferences'], queryFn: getPreferences, staleTime: 5 * 60_000 });
  const mutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: (data) => {
      qc.setQueryData(['me-preferences'], data);
      // Dates in every personal list depend on the zone.
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const prefs = query.data;
  const timeZone = prefs?.timezone || browserTimeZone();
  const perspective: 'management' | 'engineer' =
    prefs?.perspective && prefs.perspective !== 'auto' ? prefs.perspective : prefs?.defaultPerspective ?? 'engineer';
  return {
    prefs,
    timeZone,
    hour12: hour12For(prefs?.clockFormat),
    perspective,
    update: (patch: Partial<Pick<WorkspacePreferences, 'timezone' | 'clockFormat' | 'perspective'>>) => mutation.mutate(patch),
  };
}

/** Today's date (YYYY-MM-DD) in the user's zone, refreshed each minute. */
export function useToday(): string {
  const { timeZone } = usePreferences();
  const now = useNow(60_000);
  return zonedParts(now, timeZone, undefined).date;
}

export function useAgenda(from: string, to: string, projectId?: string) {
  return useQuery({
    queryKey: ['me', 'agenda', from, to, projectId ?? null],
    queryFn: () => getAgenda(from, to, projectId),
    placeholderData: (prev) => prev,
  });
}

/** Everything that changes when a task or record is completed or edited. */
export function useInvalidateWorkspace() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['me'] }),
    qc.invalidateQueries({ queryKey: ['command-center'] }),
  ]);
}

/** Calendar dots: per day, how many items are open or done, and whether any open one is overdue. */
export function dayMarks(items: AgendaItem[], today: string): Map<string, DayMarks> {
  const marks = new Map<string, DayMarks>();
  for (const it of items) {
    const m = marks.get(it.date) ?? { open: 0, done: 0, overdue: false };
    if (it.done) m.done += 1;
    else {
      m.open += 1;
      if (it.date < today) m.overdue = true;
    }
    marks.set(it.date, m);
  }
  return marks;
}
