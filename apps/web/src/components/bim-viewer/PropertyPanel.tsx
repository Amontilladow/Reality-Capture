import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BimElementDetail } from '../../lib/bim.api';
import { getCapturesForElement, getIssuesForElement, createPinForElement } from '../../lib/bim.api';
import { updateLocation, convertPinToSnag } from '../../lib/projects.api';
import type { ProjectPinResult } from '../../lib/drawings.api';
import { PinSearch } from './PinSearch';
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
  const queryClient = useQueryClient();
  const [pickingPin, setPickingPin] = useState(false);
  const [creatingPin, setCreatingPin] = useState(false);
  const [newPinName, setNewPinName] = useState('');

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

  const pinLinkMutation = useMutation({
    mutationFn: (pin: ProjectPinResult | null) =>
      updateLocation(
        projectId,
        pin ? pin.locationId : element!.linkedPin!.locationId,
        { elementId: pin ? element!.id : null },
      ),
    onSuccess: () => {
      setPickingPin(false);
      queryClient.invalidateQueries({ queryKey: ['bim-element-by-guid'] });
      queryClient.invalidateQueries({ queryKey: ['pins', projectId] });
    },
  });

  const createPinMutation = useMutation({
    mutationFn: () => createPinForElement(projectId, element!.id, newPinName.trim() || 'Untitled pin'),
    onSuccess: () => {
      setCreatingPin(false);
      setNewPinName('');
      queryClient.invalidateQueries({ queryKey: ['bim-element-by-guid'] });
      queryClient.invalidateQueries({ queryKey: ['pins', projectId] });
    },
  });

  const convertToSnagMutation = useMutation({
    mutationFn: () => convertPinToSnag(projectId, element!.linkedPin!.locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bim-element-by-guid'] });
      queryClient.invalidateQueries({ queryKey: ['pins', projectId] });
      // The converted issue is deleted server-side, so the "Open issues"
      // section (fed by this key) needs to refetch too, or it keeps
      // showing the now-gone issue until some unrelated remount/refocus.
      queryClient.invalidateQueries({ queryKey: ['bim-element-issues', element?.id] });
    },
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
      <div className="space-y-2 pb-3">
        <button onClick={onRaiseIssue} className="btn-primary w-full text-sm">
          + Raise an issue here
        </button>

        {pickingPin ? (
          <div className="space-y-2">
            <PinSearch projectId={projectId} onSelect={(pin) => pinLinkMutation.mutate(pin)} />
            <button
              type="button"
              onClick={() => setPickingPin(false)}
              className="w-full text-center text-xs text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        ) : element.linkedPin ? (
          <div className="space-y-1.5 rounded border border-gray-200 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <span className="text-gray-500">Linked pin: </span>
                <span className="font-medium text-gray-900">{element.linkedPin.name || 'Untitled pin'}</span>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button type="button" onClick={() => setPickingPin(true)} className="text-blue-700 hover:text-blue-900">
                  Change
                </button>
                <button
                  type="button"
                  disabled={pinLinkMutation.isPending}
                  onClick={() => pinLinkMutation.mutate(null)}
                  className="text-red-600 hover:text-red-800"
                >
                  Unlink
                </button>
              </div>
            </div>
            {element.linkedPin.linkedRecord?.type === 'issue' && (
              <div className="flex items-center gap-3 text-xs">
                <Link to={`/projects/${projectId}/issues?issueId=${element.linkedPin.linkedRecord.id}`} className="text-blue-700 hover:text-blue-900">
                  View in Issues →
                </Link>
                <button
                  type="button"
                  onClick={() => convertToSnagMutation.mutate()}
                  disabled={convertToSnagMutation.isPending}
                  className="text-gray-600 hover:text-gray-900"
                >
                  {convertToSnagMutation.isPending ? 'Converting…' : 'Mark as snag'}
                </button>
              </div>
            )}
            {element.linkedPin.linkedRecord?.type === 'snag' && (
              <div className="text-xs">
                <Link to={`/projects/${projectId}/snagging?snagId=${element.linkedPin.linkedRecord.id}`} className="text-blue-700 hover:text-blue-900">
                  View in Snagging →
                </Link>
              </div>
            )}
          </div>
        ) : creatingPin ? (
          <div className="space-y-2">
            <input
              autoFocus
              className="field-input w-full text-sm"
              placeholder="New pin name"
              value={newPinName}
              onChange={(e) => setNewPinName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createPinMutation.mutate();
                if (e.key === 'Escape') { setCreatingPin(false); setNewPinName(''); }
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => createPinMutation.mutate()}
                disabled={createPinMutation.isPending}
                className="btn-primary flex-1 text-xs"
              >
                {createPinMutation.isPending ? 'Creating…' : 'Create pin'}
              </button>
              <button
                type="button"
                onClick={() => { setCreatingPin(false); setNewPinName(''); }}
                className="btn-ghost flex-1 text-xs"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Creates the pin here, with no floor-plan position yet -- place it on a drawing later from the Floor Plans page.
            </p>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setPickingPin(true)} className="btn-secondary flex-1 text-sm">
              + Link to a pin
            </button>
            <button onClick={() => setCreatingPin(true)} className="btn-secondary flex-1 text-sm">
              + Create new pin
            </button>
          </div>
        )}
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
