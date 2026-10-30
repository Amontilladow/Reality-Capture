import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { apiErrorMessage } from '../lib/api';
import { listProjects } from '../lib/projects.api';
import {
  getSharePointStatus, connectSharePoint, disconnectSharePoint, mapSharePointProjectSite, unmapSharePointProjectSite,
  type SharePointProjectSiteConfig,
} from '../lib/sharepoint-integration.api';
import { triggerSiteDrawingSync } from '../lib/site-drawings.api';
import { Listbox } from '../components/ui/Listbox';

const STATUS_QUERY_KEY = ['sharepoint-integration-status'];

function formatTimestamp(iso?: string): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

const EMPTY_SITE_FORM: SharePointProjectSiteConfig = {
  siteId: '', driveId: '', folderPath: '', drawingNumberField: '', drawingTitleField: '', disciplineField: '',
  buildingOrZoneField: '', floorOrLevelField: '', revisionNumberField: '', statusField: '', issueDateField: '',
};

// Company-admin-only config for the Site Drawing Hub's SharePoint adapter
// (server-gated by @Roles('company_admin') on
// SharePointIntegrationController -- this page has no separate
// client-side gate, same convention DeveloperSettingsPage already
// follows: hidden from the nav for a non-admin, and a 403 from the API
// either way if they reach it directly).
export default function SharePointIntegrationPage() {
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [siteForm, setSiteForm] = useState<SharePointProjectSiteConfig>(EMPTY_SITE_FORM);

  const statusQuery = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: getSharePointStatus });
  const projectsQuery = useQuery({ queryKey: ['projects', 'all-for-sharepoint-mapping'], queryFn: () => listProjects({ perPage: 200 }) });

  const connectMutation = useMutation({
    mutationFn: () => connectSharePoint(tenantId.trim()),
    onSuccess: () => { setTenantId(''); queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }); },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectSharePoint,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
  });

  const mapMutation = useMutation({
    mutationFn: () => mapSharePointProjectSite(selectedProjectId, stripEmpty(siteForm)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
  });

  const unmapMutation = useMutation({
    mutationFn: () => unmapSharePointProjectSite(selectedProjectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSiteDrawingSync(selectedProjectId),
  });

  const status = statusQuery.data;
  const projects = projectsQuery.data?.data ?? [];
  const existingMapping = selectedProjectId ? status?.projectSites[selectedProjectId] : undefined;

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    syncMutation.reset();
    setSiteForm(status?.projectSites[projectId] ?? EMPTY_SITE_FORM);
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title="SharePoint Integration" subtitle="Connect a company's SharePoint tenant and map projects to a document library for the Site Drawing Hub." />
      <div className="p-6 space-y-6 max-w-3xl">
        <div className="panel tick-frame p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-100">Connection</h2>
            <p className="text-xs text-ink-500 mt-2">
              The tenant ID is verified with Microsoft before it's saved. There's no separate credential to enter here --
              every customer reuses this app's own Microsoft Entra registration; a tenant admin grants it access to
              specific SharePoint sites directly in Microsoft Entra / Graph, outside RealityCapture.
            </p>
          </div>

          {statusQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}

          {!statusQuery.isLoading && status && (
            <div className="flex items-center justify-between rounded border border-base-700/60 px-4 py-2">
              <div className="text-sm">
                <span className="text-ink-100 font-medium">{status.connected ? status.tenantId : 'Not connected'}</span>
                {status.connected && !status.isActive && <span className="text-ink-500 ml-2">(disconnected, mappings kept)</span>}
              </div>
              {status.connected && (
                <span className={status.lastSyncError ? 'badge bg-danger/15 text-danger' : 'badge bg-ok/15 text-ok'}>
                  {status.lastSyncError ? 'Sync issue' : 'OK'}
                </span>
              )}
            </div>
          )}

          {status?.connected && (
            <div className="text-xs text-ink-500 space-y-0">
              <p>Last successful sync: {formatTimestamp(status.lastSuccessfulSyncAt)}</p>
              <p>Last attempted sync: {formatTimestamp(status.lastAttemptedSyncAt)}</p>
              {status.lastSyncError && <p className="field-error">{status.lastSyncError}</p>}
            </div>
          )}

          {status?.connected && status.isActive && (
            <button onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} className="btn-ghost text-xs text-danger">
              {disconnectMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
          {disconnectMutation.isError && <p className="field-error">{apiErrorMessage(disconnectMutation.error)}</p>}

          <div className="pt-2 border-t border-base-700/60 space-y-2">
            <label className="field-label" htmlFor="sp-tenant-id">{status?.connected ? 'Reconnect with a different tenant ID' : 'Tenant ID'}</label>
            <div className="flex gap-2">
              <input id="sp-tenant-id" className="field-input flex-1" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="e.g. contoso.onmicrosoft.com or a tenant GUID" />
              <button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending || !tenantId.trim()} className="btn-primary shrink-0">
                {connectMutation.isPending ? 'Verifying…' : 'Connect'}
              </button>
            </div>
            {connectMutation.isError && <p className="field-error">{apiErrorMessage(connectMutation.error)}</p>}
          </div>
        </div>

        <div className="panel tick-frame p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-100">Project Site Mapping</h2>
            <p className="text-xs text-ink-500 mt-2">
              Map a project onto one SharePoint site + document library. The drive is checked for reachability before
              the mapping is saved. Column overrides are optional. Without them, the drawing number/title fall back
              to the filename, and the revision number falls back to SharePoint's own version label.
            </p>
          </div>

          <Listbox aria-label="Project" className="field-input" value={selectedProjectId} onChange={(e) => selectProject(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Listbox>

          {selectedProjectId && (
            <div className="space-y-4 pt-2 border-t border-base-700/60">
              {existingMapping && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-ok">Mapped to drive {existingMapping.driveId}.</p>
                  <div className="flex gap-2">
                    <button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="btn-secondary !px-2 !py-2 text-xs">
                      {syncMutation.isPending ? 'Syncing…' : 'Sync now'}
                    </button>
                    <button onClick={() => unmapMutation.mutate()} disabled={unmapMutation.isPending} className="btn-ghost !px-2 !py-2 text-xs text-danger">
                      Unmap
                    </button>
                  </div>
                </div>
              )}
              {syncMutation.isSuccess && (
                <p className="text-xs text-ok">
                  Sync {syncMutation.data.status === 'SUCCESS' ? 'completed' : 'failed'}: {syncMutation.data.drawingsSeen} seen,
                  {' '}{syncMutation.data.drawingsCreated} new, {syncMutation.data.revisionsCreated} new revision(s).
                </p>
              )}
              {syncMutation.isError && <p className="field-error">{apiErrorMessage(syncMutation.error)}</p>}
              {unmapMutation.isError && <p className="field-error">{apiErrorMessage(unmapMutation.error)}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Site ID" value={siteForm.siteId} onChange={(v) => setSiteForm((f) => ({ ...f, siteId: v }))} />
                <Field label="Drive ID" value={siteForm.driveId} onChange={(v) => setSiteForm((f) => ({ ...f, driveId: v }))} />
                <Field label="Folder path (optional)" value={siteForm.folderPath ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, folderPath: v }))} span2 />
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-ink-500">Column name overrides (optional)</summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <Field label="Drawing number column" value={siteForm.drawingNumberField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, drawingNumberField: v }))} />
                  <Field label="Drawing title column" value={siteForm.drawingTitleField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, drawingTitleField: v }))} />
                  <Field label="Discipline column" value={siteForm.disciplineField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, disciplineField: v }))} />
                  <Field label="Building/zone column" value={siteForm.buildingOrZoneField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, buildingOrZoneField: v }))} />
                  <Field label="Floor/level column" value={siteForm.floorOrLevelField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, floorOrLevelField: v }))} />
                  <Field label="Revision number column" value={siteForm.revisionNumberField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, revisionNumberField: v }))} />
                  <Field label="Approval status column" value={siteForm.statusField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, statusField: v }))} />
                  <Field label="Issue date column" value={siteForm.issueDateField ?? ''} onChange={(v) => setSiteForm((f) => ({ ...f, issueDateField: v }))} />
                </div>
              </details>

              {mapMutation.isError && <p className="field-error">{apiErrorMessage(mapMutation.error)}</p>}
              <button
                onClick={() => mapMutation.mutate()}
                disabled={mapMutation.isPending || !siteForm.siteId.trim() || !siteForm.driveId.trim()}
                className="btn-primary"
              >
                {mapMutation.isPending ? 'Verifying…' : existingMapping ? 'Update mapping' : 'Save mapping'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function stripEmpty(form: SharePointProjectSiteConfig): SharePointProjectSiteConfig {
  const entries = Object.entries(form).filter(([, v]) => typeof v === 'string' && v.trim().length > 0);
  return Object.fromEntries(entries) as unknown as SharePointProjectSiteConfig;
}

function Field({ label, value, onChange, span2 }: { label: string; value: string; onChange: (v: string) => void; span2?: boolean }) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="field-label">{label}</label>
      <input className="field-input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
