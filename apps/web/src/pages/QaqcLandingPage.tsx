import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { getProject } from '../lib/projects.api';
import { getQaqcSummary } from '../lib/qaqc.api';

// The moment someone clicks "QAQC" they get exactly two clear options --
// NCR or SOR -- per the brief's §3. Each card navigates into
// /projects/:projectId/qaqc/{ncr|sor}, a path sub-route (not a query param)
// so the list for one record type has its own shareable URL and back-button
// behavior, the same way /rfis and /qa-inspections already do.
export default function QaqcLandingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const summaryQuery = useQuery({
    queryKey: ['qaqc-summary', projectId],
    queryFn: () => getQaqcSummary(projectId!),
    enabled: Boolean(projectId),
  });

  if (!projectId) return null;

  return (
    <>
      <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="QAQC" />

      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-ink-500 mb-6">
          Non-Conformance Reports and Site Observation Reports -- restricted-issuer, risk-linked quality records.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/qaqc/ncr`)}
            className="panel tick-frame p-6 text-left hover:border-blueprint/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">NCR</h3>
              <span className="badge bg-danger/15 text-danger">{summaryQuery.data?.ncrOpen ?? 0} open</span>
            </div>
            <p className="text-sm text-ink-500 mb-3">Non-Conformance Report -- formally record and track a quality defect through to close-out.</p>
            <div className="flex gap-3 text-xs text-ink-500 font-mono">
              <span>{summaryQuery.data?.ncrTotal ?? 0} total</span>
              <span>·</span>
              <span>{summaryQuery.data?.ncrClosed ?? 0} closed</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/qaqc/sor`)}
            className="panel tick-frame p-6 text-left hover:border-blueprint/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">SOR</h3>
              <span className="badge bg-danger/15 text-danger">{summaryQuery.data?.sorOpen ?? 0} open</span>
            </div>
            <p className="text-sm text-ink-500 mb-3">Site Observation Report -- raise and track a site quality observation through to close-out.</p>
            <div className="flex gap-3 text-xs text-ink-500 font-mono">
              <span>{summaryQuery.data?.sorTotal ?? 0} total</span>
              <span>·</span>
              <span>{summaryQuery.data?.sorClosed ?? 0} closed</span>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}
