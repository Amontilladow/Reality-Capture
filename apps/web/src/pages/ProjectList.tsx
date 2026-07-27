import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { ProjectCard } from '../components/ProjectCard';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { SubscriptionBanner } from '../components/SubscriptionBanner';
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
