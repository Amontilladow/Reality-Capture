import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { generateReport, type ReportType, type GeneratedReport } from '../lib/reports.api';
import { getProject } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

// The LLM writes plain markdown (**bold** section headers, blank-line
// paragraphs) -- render just enough of it to avoid literal asterisks
// showing up in the UI, without pulling in a markdown dependency for one
// field.
function renderNarrative(text: string) {
  return text.split(/\n\n+/).map((para, i) => (
    <p key={i} className="text-sm text-ink-100 leading-relaxed">
      {para.split(/(\*\*[^*]+\*\*)/g).map((chunk, j) =>
        chunk.startsWith('**') && chunk.endsWith('**')
          ? <strong key={j} className="text-ink-100">{chunk.slice(2, -2)}</strong>
          : chunk,
      )}
    </p>
  ));
}

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'progress', label: 'Progress Report' },
  { value: 'site_condition', label: 'Site Condition Report' },
  { value: 'handover', label: 'Handover Report' },
  { value: 'dispute_evidence', label: 'Dispute Evidence Report' },
];

export default function ReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [reportType, setReportType] = useState<ReportType>('progress');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [report, setReport] = useState<GeneratedReport | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateReport(
      projectId!,
      reportType,
      dateFrom ? new Date(dateFrom).toISOString() : undefined,
      dateTo ? new Date(dateTo).toISOString() : undefined,
    ),
    onSuccess: (result) => setReport(result),
  });

  if (!projectId) return null;

  return (
    <>
      <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="Reports" />

      <div className="p-6 space-y-6 max-w-3xl">
        <div className="panel tick-frame p-4 space-y-4">
          <div>
            <label className="field-label" htmlFor="reportType">Report type</label>
            <select id="reportType" className="field-input" value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="dateFrom">From (optional)</label>
              <input id="dateFrom" type="date" className="field-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="dateTo">To (optional)</label>
              <input id="dateTo" type="date" className="field-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          {generateMutation.isError && <p className="field-error">{apiErrorMessage(generateMutation.error)}</p>}

          <button onClick={() => generateMutation.mutate()} className="btn-primary" disabled={generateMutation.isPending}>
            {generateMutation.isPending ? 'Generating…' : 'Generate report'}
          </button>
        </div>

        {report && (
          <div className="panel tick-frame p-6 space-y-4 print:border-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{report.project.name}</h2>
                <p className="text-xs text-ink-500 font-mono">{report.project.code} · {report.project.location ?? 'No location set'}</p>
              </div>
              <button onClick={() => window.print()} className="btn-secondary !py-1.5 text-xs shrink-0">
                Print / Save as PDF
              </button>
            </div>

            <div className="space-y-3">
              {renderNarrative(report.narrative)}
            </div>

            <div className="pt-4 border-t border-base-600 space-y-3">
              <div className="text-xs font-mono uppercase tracking-widest text-ink-500">Underlying data</div>
              <div className="text-sm text-ink-300">{report.data.captureCount} ready captures</div>
              {report.data.issueSummary.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                      <th className="py-1.5 font-medium">Status</th>
                      <th className="py-1.5 font-medium">Priority</th>
                      <th className="py-1.5 font-medium text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.issueSummary.map((row, i) => (
                      <tr key={i} className="border-b border-base-700/60 last:border-0">
                        <td className="py-1.5 text-ink-300">{row.status}</td>
                        <td className="py-1.5 text-ink-300">{row.priority}</td>
                        <td className="py-1.5 text-right font-mono">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
