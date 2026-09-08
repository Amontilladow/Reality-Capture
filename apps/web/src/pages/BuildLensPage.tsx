import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { listAllPhoto360Captures } from '../lib/buildlens.api';
import { getProject } from '../lib/projects.api';

interface LocationSummary {
  locationId: string;
  label: string;
  count: number;
  mostRecent: string;
}

export default function BuildLensPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const capturesQuery = useQuery({
    queryKey: ['buildlens', 'locations', projectId],
    queryFn: () => listAllPhoto360Captures(projectId!),
    enabled: Boolean(projectId),
  });

  const locations = useMemo<LocationSummary[]>(() => {
    const captures = capturesQuery.data ?? [];
    const byLocation = new Map<string, LocationSummary>();

    for (const c of captures) {
      if (!c.locationId) continue; // unassigned captures have nowhere to timeline
      const existing = byLocation.get(c.locationId);
      const label = [c.buildingName, c.levelName, c.locationName].filter(Boolean).join(' · ') || 'Unnamed location';
      if (!existing) {
        byLocation.set(c.locationId, { locationId: c.locationId, label, count: 1, mostRecent: c.capturedAt });
      } else {
        existing.count += 1;
        if (new Date(c.capturedAt).getTime() > new Date(existing.mostRecent).getTime()) {
          existing.mostRecent = c.capturedAt;
        }
      }
    }

    return Array.from(byLocation.values()).sort(
      (a, b) => new Date(b.mostRecent).getTime() - new Date(a.mostRecent).getTime(),
    );
  }, [capturesQuery.data]);

  if (!projectId) return null;

  return (
    <>
      <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="BuildLens" />

      <div className="p-6 space-y-4">
        <p className="text-sm text-ink-500">See the project evolve.</p>

        {capturesQuery.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 panel animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}

        {capturesQuery.isSuccess && locations.length === 0 && (
          <div className="panel p-8 text-center text-sm text-ink-500">
            No location has any 360° captures yet. Upload 360° captures to a location to build its timeline.
          </div>
        )}

        {locations.length > 0 && (
          <div className="divide-y divide-base-600 panel overflow-hidden">
            {locations.map((loc) => (
              <Link
                key={loc.locationId}
                to={`/projects/${projectId}/buildlens/${loc.locationId}`}
                className="flex items-center gap-4 px-4 py-3.5 hover:bg-base-800 transition-colors"
              >
                <TimelineIcon className="w-5 h-5 text-blueprint shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{loc.label}</div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    {loc.count} 360° capture{loc.count === 1 ? '' : 's'} · most recent{' '}
                    {new Date(loc.mostRecent).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <ChevronIcon className="w-4 h-4 text-ink-500 shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TimelineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 12h4l2-6 4 12 2-6h6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
