import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listProjects, getProject, getMembers, getOrganizationMembers } from '../../lib/projects.api';
import { PROJECT_ROLE_LABELS } from '../../lib/issue-constants';
import { PROJECT_ORGANIZATION_SLOT_LABELS } from '@engineeringos/types';
import type { ProjectRole } from '@engineeringos/types';
import { useAuthStore } from '../../store/auth.store';

// RBAC Phase 5: shows which project you're in, your own role and
// organization slot on it, and a switcher to jump to another project --
// all previously invisible once inside a project (the sidebar only ever
// showed company-wide nav + the signed-in person's name/email). Every
// query here hits an already-ungated read (getProject/getMembers/
// getOrganizationMembers), same endpoints ManageMembersModal already
// calls -- this doesn't add any new backend surface, just surfaces it.
export function ProjectContextPanel({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });

  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId),
  });

  const organizationMembersQuery = useQuery({
    queryKey: ['organizationMembers', projectId],
    queryFn: () => getOrganizationMembers(projectId),
  });

  // Every project the signed-in person can see, for the switcher -- same
  // list ProjectList.tsx itself renders. 100 is this app's existing
  // "effectively unpaginated" convention (see e.g. getDrawingUpdatesNotApplied).
  const projectsQuery = useQuery({
    queryKey: ['projects-switcher'],
    queryFn: () => listProjects({ perPage: 100 }),
  });

  const myMembership = (membersQuery.data ?? []).find((m) => m.userId === currentUser?.id);
  const myOrgSlot = (organizationMembersQuery.data ?? []).find((m) => m.userId === currentUser?.id);
  const projects = projectsQuery.data?.data ?? [];

  return (
    <div className="px-3 py-2.5 border-b border-base-600 space-y-1.5">
      <select
        className="field-input !py-1 text-xs w-full"
        value={projectId}
        onChange={(e) => {
          if (e.target.value) navigate(`/projects/${e.target.value}`);
        }}
        aria-label="Switch project"
      >
        {/* Keeps the current project selected even before the switcher's own
            list has loaded, by falling back to the one we already know from
            the project-detail query. */}
        {!projects.some((p) => p.id === projectId) && (
          <option value={projectId}>{projectQuery.data?.name ?? 'Loading…'}</option>
        )}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {(myMembership || myOrgSlot) && (
        <div className="flex flex-wrap gap-1">
          {myMembership && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-base-800 text-ink-300 border border-base-600">
              {PROJECT_ROLE_LABELS[myMembership.role as ProjectRole] ?? myMembership.role}
            </span>
          )}
          {myOrgSlot && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blueprint/15 text-blueprint border border-blueprint/30">
              {PROJECT_ORGANIZATION_SLOT_LABELS[myOrgSlot.slot]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
