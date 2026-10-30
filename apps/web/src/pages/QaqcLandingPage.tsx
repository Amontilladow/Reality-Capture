import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { getProject } from '../lib/projects.api';
import { getQaqcSummary, type QaqcRecordType, type QaqcSummary } from '../lib/qaqc.api';
import { QAQC_RECORD_TYPES, QAQC_RECORD_TYPE_LABELS, QAQC_RECORD_TYPE_SHORT_LABELS } from '../lib/qaqc-constants';

const RECORD_TYPE_DESCRIPTION: Record<QaqcRecordType, string> = {
  ncr: 'Formally record and track a quality non-conformance through to close-out.',
  sor: 'Raise and track a site quality observation through to close-out.',
  wir: 'Request and track an inspection of completed work before it is covered or proceeds.',
  mir: 'Request and track an inspection/acceptance of a material before it is used.',
};

function summaryFieldsFor(recordType: QaqcRecordType, summary?: QaqcSummary) {
  if (!summary) return { total: 0, open: 0, closed: 0 };
  return {
    total: summary[`${recordType}Total` as const],
    open: summary[`${recordType}Open` as const],
    closed: summary[`${recordType}Closed` as const],
  };
}

// The moment someone clicks "QAQC" they get four clearly-labeled options --
// NCR, SOR, WIR, MIR -- per the brief's §3. Each card navigates into
// /projects/:projectId/qaqc/{ncr|sor|wir|mir}, a path sub-route (not a
// query param) so the list for one record type has its own shareable URL
// and back-button behavior, the same way /rfis and /qa-inspections already do.
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
          Non-Conformance, Site Observation, Work Inspection, and Material Inspection records -- restricted-issuer, risk-linked quality records.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {QAQC_RECORD_TYPES.map((recordType) => {
            const { total, open, closed } = summaryFieldsFor(recordType, summaryQuery.data);
            return (
              <button
                key={recordType}
                type="button"
                onClick={() => navigate(`/projects/${projectId}/qaqc/${recordType}`)}
                className="panel tick-frame p-6 text-left hover:border-blueprint/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold">{QAQC_RECORD_TYPE_SHORT_LABELS[recordType]}</h3>
                  <span className="badge bg-danger/15 text-danger">{open} open</span>
                </div>
                <p className="text-xs text-ink-400 font-medium mb-2">{QAQC_RECORD_TYPE_LABELS[recordType]}</p>
                <p className="text-sm text-ink-500 mb-4">{RECORD_TYPE_DESCRIPTION[recordType]}</p>
                <div className="flex gap-4 text-xs text-ink-500 font-mono">
                  <span>{total} total</span>
                  <span>·</span>
                  <span>{closed} closed</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
