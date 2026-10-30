import type { AuditEntry } from './audit.api';

const ACTION_VERB_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  archived: 'archived',
  uploaded: 'uploaded',
  model_uploaded: 'uploaded a model for',
  invited: 'invited',
  login: 'logged in',
  logout: 'logged out',
};

// What a site team would call each record. The audit trail also logs
// internal steps by their URL segment ("jobs", "uploads", "rerun" -- a
// capture's processing pipeline); those mean nothing to a reader, so only
// the record types named here appear in the feed.
const RESOURCE_LABELS: Record<string, string> = {
  issue: 'issue', issues: 'issue',
  rfi: 'RFI', rfis: 'RFI',
  snag_item: 'snag', snag_items: 'snag', snags: 'snag',
  qaqc_record: 'QA/QC record', qaqc: 'QA/QC record',
  risk: 'risk', risks: 'risk',
  submittal: 'submittal', submittals: 'submittal',
  transmittal: 'transmittal', transmittals: 'transmittal',
  document: 'document', documents: 'document',
  capture: 'capture', captures: 'capture',
  drawing: 'floor plan', drawings: 'floor plan',
  site_drawing: 'site drawing', site_drawings: 'site drawing',
  bim_model: 'BIM model', models: 'BIM model',
  building: 'building', buildings: 'building',
  level: 'level', levels: 'level',
  location: 'location', locations: 'location',
  project: 'project',
  members: 'team member', member: 'team member',
  comments: 'comment', comment: 'comment',
};

function formatActivity(action: string, resourceType: string, resourceLabel?: string): string | null {
  const [, verbRaw] = action.split('.');
  const verb = ACTION_VERB_LABELS[verbRaw] ?? verbRaw ?? 'updated';
  if (action.startsWith('auth.') || action === 'session.login' || action === 'session.logout') return null;
  const resourceName = RESOURCE_LABELS[resourceType];
  if (!resourceName) return null;
  const label = resourceLabel ? ` "${resourceLabel}"` : '';
  return `${verb} ${resourceName}${label}`;
}

// Readable rows for the feed: internal events dropped, and a run of the
// same person doing the same thing ("created snag" x7) merged into one
// row ("created 7 snags") stamped with the latest time.
export function groupActivity(entries: AuditEntry[]) {
  const rows: (AuditEntry & { text: string; count: number })[] = [];
  for (const entry of entries) {
    const text = formatActivity(entry.action, entry.resourceType, entry.resourceLabel);
    if (!text) continue;
    const prev = rows[rows.length - 1];
    if (prev && prev.userName === entry.userName && prev.action === entry.action && prev.resourceType === entry.resourceType) {
      prev.count += 1;
      const [, verbRaw] = entry.action.split('.');
      const noun = RESOURCE_LABELS[entry.resourceType];
      prev.text = `${ACTION_VERB_LABELS[verbRaw] ?? verbRaw} ${prev.count} ${noun}s`;
      continue;
    }
    rows.push({ ...entry, text, count: 1 });
  }
  return rows;
}
