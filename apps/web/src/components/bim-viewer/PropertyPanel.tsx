import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BimElementDetail } from '../../lib/bim.api';
import {
  getCapturesForElement, getIssuesForElement, createPinForElement,
  updateElementStatus, getElementStatusHistory, CONSTRUCTION_STATUS_OPTIONS,
} from '../../lib/bim.api';
import { updateLocation, convertPinToSnag } from '../../lib/projects.api';
import type { ProjectPinResult } from '../../lib/drawings.api';
import { PinSearch } from './PinSearch';
import { STATUS_LABELS, STATUS_BADGE_CLASS, PRIORITY_LABELS, PRIORITY_BADGE_CLASS, formatDateTime } from '../../lib/issue-constants';
import type { IssueStatus, IssuePriority } from '@engineeringos/types';
import { Listbox } from '../ui/Listbox';

function statusBadgeClass(status: string | null): string {
  switch (status) {
    case 'complete': return 'bg-ok/10 text-ok';
    case 'in_progress': return 'bg-warn/10 text-warn';
    case 'defective': return 'bg-danger/10 text-danger';
    default: return 'bg-base-800 text-ink-300';
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-base-600 py-4">
      <h4 className="mb-2 text-xs font-semibold text-ink-500">{title}</h4>
      {children}
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-0 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="text-right text-ink-100">{value}</span>
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
  const [statusDraft, setStatusDraft] = useState<{ status: string; completionPct: string; captureId: string } | null>(null);
  const [showStatusHistory, setShowStatusHistory] = useState(false);

  // Reset the status-editing draft and history visibility whenever the
  // selected element changes -- this component isn't remounted on
  // selection (same instance, new props), so stale draft state would
  // otherwise leak across elements.
  const [lastElementId, setLastElementId] = useState<string | null>(null);
  if (element && element.id !== lastElementId) {
    setLastElementId(element.id);
    if (statusDraft !== null) setStatusDraft(null);
    if (showStatusHistory) setShowStatusHistory(false);
  }

  const capturesQuery = useQuery({
    queryKey: ['bim-element-captures', projectId, element?.id],
    queryFn: () => getCapturesForElement(projectId, element!.id),
    enabled: Boolean(element),
  });

  const statusHistoryQuery = useQuery({
    queryKey: ['bim-element-status-history', element?.id],
    queryFn: () => getElementStatusHistory(projectId, element!.id),
    enabled: Boolean(element) && showStatusHistory,
  });

  const statusMutation = useMutation({
    mutationFn: () => updateElementStatus(projectId, element!.id, {
      status: statusDraft!.status,
      completionPct: statusDraft!.completionPct === '' ? undefined : Number(statusDraft!.completionPct),
      captureId: statusDraft!.captureId || undefined,
    }),
    onSuccess: () => {
      setStatusDraft(null);
      queryClient.invalidateQueries({ queryKey: ['bim-element-by-guid'] });
      queryClient.invalidateQueries({ queryKey: ['bim-element-status-history', element?.id] });
      queryClient.invalidateQueries({ queryKey: ['bim-level-progress', projectId] });
      queryClient.invalidateQueries({ queryKey: ['bim-element-status-map'] });
    },
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
    return <p className="p-4 text-sm text-ink-500">Loading properties…</p>;
  }
  if (!element) {
    return <p className="p-4 text-sm text-ink-500">Select an element in the viewer or spatial tree to inspect it.</p>;
  }

  // element.properties is normally a plain object (the API decodes the
  // bim_elements.properties JSONB column into one automatically), but a
  // small number of elements have it stored as a JSON-encoded STRING
  // instead (a data artifact from how/when they were processed -- see
  // ifc-repository.service.ts's insertElementsBatch). Object.entries() on
  // a raw string walks its characters by index, which renders as garbage
  // numbered rows, so unwrap that case defensively rather than trusting
  // the stored shape.
  let rawProperties: unknown = element.properties;
  if (typeof rawProperties === 'string') {
    try {
      rawProperties = JSON.parse(rawProperties);
    } catch {
      rawProperties = {};
    }
  }
  const propertyEntries = Object.entries((rawProperties && typeof rawProperties === 'object' ? rawProperties : {}) as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="overflow-y-auto p-4">
      <div className="space-y-2 pb-4">
        <button onClick={onRaiseIssue} className="btn-primary w-full text-sm">
          + Raise an issue here
        </button>

        {pickingPin ? (
          <div className="space-y-2">
            <PinSearch projectId={projectId} onSelect={(pin) => pinLinkMutation.mutate(pin)} />
            <button
              type="button"
              onClick={() => setPickingPin(false)}
              className="w-full text-center text-xs text-ink-500 hover:text-ink-100"
            >
              Cancel
            </button>
          </div>
        ) : element.linkedPin ? (
          <div className="space-y-2 rounded border border-base-600 px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <span className="text-ink-500">Linked pin: </span>
                <span className="font-medium text-ink-100">{element.linkedPin.name || 'Untitled pin'}</span>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button type="button" onClick={() => setPickingPin(true)} className="text-blueprint hover:text-blueprint">
                  Change
                </button>
                <button
                  type="button"
                  disabled={pinLinkMutation.isPending}
                  onClick={() => pinLinkMutation.mutate(null)}
                  className="text-danger hover:text-danger"
                >
                  Unlink
                </button>
              </div>
            </div>
            {element.linkedPin.linkedRecord?.type === 'issue' && (
              <div className="flex items-center gap-4 text-xs">
                <Link to={`/projects/${projectId}/issues?issueId=${element.linkedPin.linkedRecord.id}`} className="text-blueprint hover:text-blueprint">
                  View in Issues →
                </Link>
                <button
                  type="button"
                  onClick={() => convertToSnagMutation.mutate()}
                  disabled={convertToSnagMutation.isPending}
                  className="text-ink-300 hover:text-ink-100"
                >
                  {convertToSnagMutation.isPending ? 'Converting…' : 'Mark as snag'}
                </button>
              </div>
            )}
            {element.linkedPin.linkedRecord?.type === 'snag' && (
              <div className="text-xs">
                <Link to={`/projects/${projectId}/snagging?snagId=${element.linkedPin.linkedRecord.id}`} className="text-blueprint hover:text-blueprint">
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
            <p className="text-xs text-ink-500">
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

      <Section title="Construction status">
        {statusDraft === null ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0 text-xs font-medium ${statusBadgeClass(element.constructionStatus)}`}>
                  {CONSTRUCTION_STATUS_OPTIONS.find((o) => o.value === element.constructionStatus)?.label ?? 'Not started'}
                </span>
                {element.completionPct !== null && <span className="text-xs text-ink-500">{element.completionPct}%</span>}
              </div>
              <button
                type="button"
                onClick={() => setStatusDraft({
                  status: element.constructionStatus ?? 'not_started',
                  completionPct: element.completionPct !== null ? String(element.completionPct) : '',
                  captureId: '',
                })}
                className="text-xs text-blueprint hover:text-blueprint"
              >
                Update
              </button>
            </div>
            <button type="button" onClick={() => setShowStatusHistory((v) => !v)} className="text-xs text-ink-500 hover:text-ink-100">
              {showStatusHistory ? 'Hide history' : 'Show history'}
            </button>
            {showStatusHistory && (
              <div className="space-y-2 pt-2">
                {statusHistoryQuery.isLoading && <p className="text-xs text-ink-500">Loading…</p>}
                {statusHistoryQuery.data?.length === 0 && <p className="text-xs text-ink-500">No status changes recorded yet.</p>}
                {statusHistoryQuery.data?.map((h) => (
                  <div key={h.id} className="text-xs text-ink-300">
                    <span className="font-medium text-ink-100">{h.toStatus.replace('_', ' ')}</span>
                    {h.completionPct !== null && ` (${h.completionPct}%)`}
                    {' — '}{h.performedByName}, {formatDateTime(h.createdAt)}
                    {h.captureTitle && <span className="text-ink-500"> · evidence: {h.captureTitle}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="field-label text-xs" htmlFor="pp-status">Status</label>
              <Listbox
                id="pp-status" className="field-input text-sm" value={statusDraft.status}
                onChange={(e) => setStatusDraft({ ...statusDraft, status: e.target.value })}
              >
                {CONSTRUCTION_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Listbox>
            </div>
            <div>
              <label className="field-label text-xs" htmlFor="pp-pct">Completion %</label>
              <input
                id="pp-pct" type="number" min={0} max={100} className="field-input text-sm"
                value={statusDraft.completionPct}
                onChange={(e) => setStatusDraft({ ...statusDraft, completionPct: e.target.value })}
              />
            </div>
            <div>
              <label className="field-label text-xs" htmlFor="pp-evidence">Evidence photo (optional)</label>
              <Listbox
                id="pp-evidence" className="field-input text-sm" value={statusDraft.captureId}
                onChange={(e) => setStatusDraft({ ...statusDraft, captureId: e.target.value })}
              >
                <option value="">No evidence photo</option>
                {(capturesQuery.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.title || formatDateTime(c.capturedAt)}</option>
                ))}
              </Listbox>
            </div>
            {statusMutation.isError && <p className="text-xs text-danger">Failed to update status. Try again.</p>}
            <div className="flex gap-2">
              <button
                type="button" onClick={() => statusMutation.mutate()} disabled={statusMutation.isPending}
                className="btn-primary flex-1 text-xs"
              >
                {statusMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setStatusDraft(null)} className="btn-ghost flex-1 text-xs">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title={`Open issues${issuesQuery.data ? ` (${issuesQuery.data.length})` : ''}`}>
        {issuesQuery.isLoading && <p className="text-xs text-ink-500">Loading…</p>}
        {issuesQuery.data && issuesQuery.data.length === 0 && (
          <p className="text-xs text-ink-500">No open issues linked to this element.</p>
        )}
        {issuesQuery.data && issuesQuery.data.length > 0 && (
          <ul className="space-y-2">
            {issuesQuery.data.map((issue) => (
              <li key={issue.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink-500">{issue.issueNumber}</span>
                  <div className="flex gap-2">
                    <span className={`rounded px-2 py-0 text-xs font-medium ${STATUS_BADGE_CLASS[issue.status as IssueStatus] ?? 'bg-base-800 text-ink-300'}`}>
                      {STATUS_LABELS[issue.status as IssueStatus] ?? issue.status}
                    </span>
                    <span className={`rounded px-2 py-0 text-xs font-medium ${PRIORITY_BADGE_CLASS[issue.priority as IssuePriority] ?? 'bg-base-800 text-ink-300'}`}>
                      {PRIORITY_LABELS[issue.priority as IssuePriority] ?? issue.priority}
                    </span>
                  </div>
                </div>
                <div className="text-ink-100">{issue.title}</div>
                {issue.assignedToName && <div className="text-xs text-ink-500">Assigned: {issue.assignedToName}</div>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Photos${capturesQuery.data ? ` (${capturesQuery.data.length})` : ''}`}>
        {capturesQuery.isLoading && <p className="text-xs text-ink-500">Loading…</p>}
        {capturesQuery.data && capturesQuery.data.length === 0 && (
          <p className="text-xs text-ink-500">No captures linked to this element.</p>
        )}
        {capturesQuery.data && capturesQuery.data.length > 0 && (
          <ul className="space-y-2">
            {capturesQuery.data.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="text-ink-100">{c.title || 'Untitled capture'}</div>
                <div className="text-xs text-ink-500">
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
