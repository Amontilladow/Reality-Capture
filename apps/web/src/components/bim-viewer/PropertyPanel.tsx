import { useQuery } from '@tanstack/react-query';
import type { BimElementDetail } from '../../lib/bim.api';
import { getCapturesForElement, getIssuesForElement } from '../../lib/bim.api';
import { STATUS_LABELS, STATUS_BADGE_CLASS, PRIORITY_LABELS, PRIORITY_BADGE_CLASS, formatDateTime } from '../../lib/issue-constants';
import type { IssueStatus, IssuePriority } from '@engineeringos/types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-200 py-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      {children}
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{value}</span>
    </div>
  );
}

export function PropertyPanel({
  element,
  loading,
  projectId,
  onRaiseIssue,
}: {
  element: BimElementDetail | null;
  loading: boolean;
  projectId: string;
  onRaiseIssue: () => void;
}) {
  const capturesQuery = useQuery({
    queryKey: ['bim-element-captures', projectId, element?.id],
    queryFn: () => getCapturesForElement(projectId, element!.id),
    enabled: Boolean(element),
  });

  const issuesQuery = useQuery({
    queryKey: ['bim-element-issues', element?.id],
    queryFn: () => getIssuesForElement(element!.id),
    enabled: Boolean(element),
  });

  if (loading) {
    return <p className="p-3 text-sm text-gray-400">Loading properties…</p>;
  }
  if (!element) {
    return <p className="p-3 text-sm text-gray-400">Select an element in the viewer or spatial tree to inspect it.</p>;
  }

  const propertyEntries = Object.entries(element.properties ?? {}).filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="overflow-y-auto p-3">
      <div className="pb-3">
        <button onClick={onRaiseIssue} className="btn-primary w-full text-sm">
          + Raise an issue here
        </button>
      </div>

      <Section title="Element">
        <KeyValueRow label="Name" value={element.ifcName ?? '—'} />
        <KeyValueRow label="Type" value={element.ifcType.replace('IFC', '')} />
        <KeyValueRow label="GUID" value={<span className="font-mono text-xs">{element.ifcGuid}</span>} />
        {element.spatialNodeName && (
          <KeyValueRow label="Location" value={`${element.spatialNodeName} (${element.spatialNodeType?.replace('IFC', '')})`} />
        )}
      </Section>

      <Section title={`Open issues${issuesQuery.data ? ` (${issuesQuery.data.length})` : ''}`}>
        {issuesQuery.isLoading && <p className="text-xs text-gray-400">Loading…</p>}
        {issuesQuery.data && issuesQuery.data.length === 0 && (
          <p className="text-xs text-gray-400">No open issues linked to this element.</p>
        )}
        {issuesQuery.data && issuesQuery.data.length > 0 && (
          <ul className="space-y-2">
            {issuesQuery.data.map((issue) => (
              <li key={issue.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-gray-500">{issue.issueNumber}</span>
                  <div className="flex gap-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE_CLASS[issue.status as IssueStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[issue.status as IssueStatus] ?? issue.status}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_BADGE_CLASS[issue.priority as IssuePriority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {PRIORITY_LABELS[issue.priority as IssuePriority] ?? issue.priority}
                    </span>
                  </div>
                </div>
                <div className="text-gray-900">{issue.title}</div>
                {issue.assignedToName && <div className="text-xs text-gray-500">Assigned: {issue.assignedToName}</div>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Photos${capturesQuery.data ? ` (${capturesQuery.data.length})` : ''}`}>
        {capturesQuery.isLoading && <p className="text-xs text-gray-400">Loading…</p>}
        {capturesQuery.data && capturesQuery.data.length === 0 && (
          <p className="text-xs text-gray-400">No captures linked to this element.</p>
        )}
        {capturesQuery.data && capturesQuery.data.length > 0 && (
          <ul className="space-y-2">
            {capturesQuery.data.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="text-gray-900">{c.title || 'Untitled capture'}</div>
                <div className="text-xs text-gray-500">
                  {formatDateTime(c.capturedAt)}
                  {c.capturedByName ? ` · ${c.capturedByName}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {propertyEntries.length > 0 && (
        <Section title="Properties">
          {propertyEntries.map(([key, value]) => (
            <KeyValueRow key={key} label={key} value={String(value)} />
          ))}
        </Section>
      )}

      {element.quantities.length > 0 && (
        <Section title="Quantities">
          {element.quantities.map((q, i) => (
            <KeyValueRow
              key={i}
              label={q.name}
              value={q.value !== null ? `${q.value.toLocaleString()}${q.unit ? ` ${q.unit}` : ''}` : '—'}
            />
          ))}
        </Section>
      )}

      {element.materials.length > 0 && (
        <Section title="Materials">
          {element.materials.map((m, i) => (
            <KeyValueRow key={i} label={m.category ?? 'Material'} value={m.name} />
          ))}
        </Section>
      )}

      {element.classifications.length > 0 && (
        <Section title="Classifications">
          {element.classifications.map((c, i) => (
            <KeyValueRow key={i} label={c.system} value={[c.code, c.name].filter(Boolean).join(' — ') || '—'} />
          ))}
        </Section>
      )}
    </div>
  );
}
