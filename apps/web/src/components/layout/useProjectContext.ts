import { useQuery } from '@tanstack/react-query';
import { listProjects, getProject, getMembers, getOrganizationMembers } from '../../lib/projects.api';
import { PROJECT_ROLE_LABELS } from '../../lib/issue-constants';
import { PROJECT_ORGANIZATION_SLOT_LABELS } from '@engineeringos/types';
import type { ProjectRole } from '@engineeringos/types';
import { useAuthStore } from '../../store/auth.store';

// RBAC Phase 5: which project you're in, your own role and organization
// slot on it, and a switcher to jump to another project. The sidebar's
// profile block shows these: the role as the badge beside your name, the
// switcher as the line under it, the organization slot under that. Every
// query here hits an already-ungated read (getProject/getMembers/
// getOrganizationMembers), same endpoints ManageMembersModal already
// calls; this doesn't add any new backend surface, just surfaces it.
export function useProjectContext(projectId: string) {
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

  // Every project the signed-in person can see, for the switcher; same
  // list ProjectList.tsx itself renders. 100 is this app's existing
  // "effectively unpaginated" convention (see e.g. getDrawingUpdatesNotApplied).
  const projectsQuery = useQuery({
    queryKey: ['projects-switcher'],
    queryFn: () => listProjects({ perPage: 100 }),
  });

  const myMembership = (membersQuery.data ?? []).find((m) => m.userId === currentUser?.id);
  const myOrgSlot = (organizationMembersQuery.data ?? []).find((m) => m.userId === currentUser?.id);

  return {
    project: projectQuery.data,
    projects: projectsQuery.data?.data ?? [],
    roleLabel: myMembership ? PROJECT_ROLE_LABELS[myMembership.role as ProjectRole] ?? myMembership.role : undefined,
    orgSlotLabel: myOrgSlot ? PROJECT_ORGANIZATION_SLOT_LABELS[myOrgSlot.slot] : undefined,
  };
}
