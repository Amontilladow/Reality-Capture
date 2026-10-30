import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { getProject, getMembers } from '../lib/projects.api';
import { getRfiSummary } from '../lib/rfis.api';
import { useAuthStore } from '../store/auth.store';

// The moment someone clicks "RFIs" they get two clearly-labeled windows --
// Main Contractor's RFIs and Subcontractor's RFIs -- each its own shareable
// sub-route (/rfis/main, /rfis/subcontractor), same pattern QaqcLandingPage
// already uses for its four record types. A subcontractor project member
// still sees both cards (they have read-only access to the main register,
// per spec) -- SubcontractorRfiAccessGuard and RfisPage's own role check
// handle the actual read/write restriction once inside a window, not this
// page.
export default function RfisLandingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });

  const mainSummaryQuery = useQuery({
    queryKey: ['rfi-summary', projectId, 'main'],
    queryFn: () => getRfiSummary(projectId!, 'main'),
    enabled: Boolean(projectId),
  });

  const subSummaryQuery = useQuery({
    queryKey: ['rfi-summary', projectId, 'subcontractor'],
    queryFn: () => getRfiSummary(projectId!, 'subcontractor'),
    enabled: Boolean(projectId),
  });

  const isSubcontractor = (membersQuery.data ?? []).find((m) => m.userId === currentUser?.id)?.role === 'subcontractor';

  if (!projectId) return null;

  return (
    <>
      <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="RFIs" />

      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-ink-500 mb-6">
          {isSubcontractor
            ? "Raise and track your own RFIs, and read (but not action) the main contractor's register."
            : "Your own RFI register, plus the subcontractors’: they raise their own, you respond."}
        </p>

        <div className="enter-stagger grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/rfis/main`)}
            className="panel tick-frame panel-interactive p-6 text-left"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Main Contractor's RFIs</h3>
              {(mainSummaryQuery.data?.open ?? 0) > 0 && (
                <span className="badge bg-danger/15 text-danger">{mainSummaryQuery.data?.open} open</span>
              )}
            </div>
            <p className="text-sm text-ink-500 mb-4">
              {isSubcontractor ? 'Read-only.' : 'Raise, respond to, and track your own RFIs, unchanged from before.'}
            </p>
            <div className="flex gap-4 text-xs tabular-nums text-ink-500">
              <span>{mainSummaryQuery.data?.total ?? 0} total</span>
              <span>{mainSummaryQuery.data?.overdue ?? 0} overdue</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/rfis/subcontractor`)}
            className="panel tick-frame panel-interactive p-6 text-left"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Subcontractor's RFIs</h3>
              {(subSummaryQuery.data?.open ?? 0) > 0 && (
                <span className="badge bg-danger/15 text-danger">{subSummaryQuery.data?.open} open</span>
              )}
            </div>
            <p className="text-sm text-ink-500 mb-4">
              RFIs raised by subcontractors with platform access. You respond. They can’t close or review their own.
            </p>
            <div className="flex gap-4 text-xs tabular-nums text-ink-500">
              <span>{subSummaryQuery.data?.total ?? 0} total</span>
              <span>{subSummaryQuery.data?.overdue ?? 0} overdue</span>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}
