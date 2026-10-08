import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { ProjectCard } from '../components/ProjectCard';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { SubscriptionBanner } from '../components/SubscriptionBanner';
import { StatTile } from '../components/ui/StatTile';
import { listProjects } from '../lib/projects.api';
import { getSubscription } from '../lib/subscription.api';

export default function ProjectList() {
  const [createOpen, setCreateOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects({ perPage: 50 }),
  });

  const subscriptionQuery = useQuery({
    queryKey: ['subscription'],
    queryFn: getSubscription,
  });

  const projects = projectsQuery.data?.data ?? [];

  // Every KPI below is a sum over fields listProjects() already returns per
  // project (openIssueCount/captureCount/memberCount) -- no new endpoint,
  // no per-project fan-out queries. memberCount double-counts anyone on
  // multiple projects, so this reads "Project Memberships," not "People,"
  // to not imply a unique headcount the data doesn't actually give us.
  const kpis = {
    total: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    openIssues: projects.reduce((sum, p) => sum + (p.openIssueCount ?? 0), 0),
    captures: projects.reduce((sum, p) => sum + (p.captureCount ?? 0), 0),
  };

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <PlusIcon /> New project
          </button>
        }
      />

      <div className="p-6 grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3">
          {projectsQuery.isSuccess && projects.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <StatTile size="lg" label="Projects" value={kpis.total} />
              <StatTile size="lg" label="Active" value={kpis.active} />
              <StatTile size="lg" label="Open Issues" value={kpis.openIssues} tone={kpis.openIssues > 0 ? 'danger' : undefined} />
              <StatTile size="lg" label="Captures" value={kpis.captures} />
            </div>
          )}

          {projectsQuery.isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="panel h-40 animate-pulse bg-base-700/40" />
              ))}
            </div>
          )}

          {projectsQuery.isError && (
            <div className="panel p-6 text-sm text-danger">Couldn't load projects. Try refreshing.</div>
          )}

          {projectsQuery.isSuccess && projects.length === 0 && (
            <div className="tick-frame panel p-12 text-center">
              <div className="text-sm font-medium mb-1">No projects yet</div>
              <p className="text-sm text-ink-500 mb-5">
                Create your first project to start registering reality captures against a building
                hierarchy.
              </p>
              <button onClick={() => setCreateOpen(true)} className="btn-primary mx-auto">
                <PlusIcon /> New project
              </button>
            </div>
          )}

          {projects.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>

        <div className="xl:col-span-1">
          {subscriptionQuery.data && <SubscriptionBanner subscription={subscriptionQuery.data} />}
        </div>
      </div>

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
