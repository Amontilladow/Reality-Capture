import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Listbox } from '../ui/Listbox';
import { apiErrorMessage } from '../../lib/api';
import {
  listSiteDrawingOrgMappings, createSiteDrawingOrgMapping, deleteSiteDrawingOrgMapping,
  SITE_DRAWING_ORG_MAPPING_ROLES, type SiteDrawingOrgMappingRole,
} from '../../lib/site-drawings.api';

const ROLE_LABELS: Record<SiteDrawingOrgMappingRole, string> = { originator: 'Originator', subcontractor: 'Subcontractor' };

// Master spec section 4: a project-specific "drawing numbers starting with
// X belong to organization Y" lookup an authorized user maintains here.
// Extraction (both bulk import and "Register a drawing") consults this
// before falling back to a blank field; it's never an inference engine,
// just a literal, auditable prefix match the uploader confirms once.
export function OrgMappingsModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [role, setRole] = useState<SiteDrawingOrgMappingRole>('originator');

  const mappingsQuery = useQuery({ queryKey: ['site-drawing-org-mappings', projectId], queryFn: () => listSiteDrawingOrgMappings(projectId) });

  const createMutation = useMutation({
    mutationFn: () => createSiteDrawingOrgMapping(projectId, pattern.trim(), organizationName.trim(), role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing-org-mappings', projectId] });
      setPattern(''); setOrganizationName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (mappingId: string) => deleteSiteDrawingOrgMapping(projectId, mappingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['site-drawing-org-mappings', projectId] }),
  });

  const canCreate = Boolean(pattern.trim() && organizationName.trim());

  return (
    <Modal open={open} onClose={onClose} title="Manage organizations" wide>
      <div className="space-y-4">
        <p className="text-xs text-ink-500">
          Map a drawing-number prefix to an organization. New drawings whose number starts with the prefix (case-insensitive)
          get this organization filled in automatically; a human can always override it.
        </p>

        <div className="panel p-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div>
            <label className="field-label" htmlFor="map-pattern">Drawing number prefix</label>
            <input id="map-pattern" className="field-input" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. S-" />
          </div>
          <div>
            <label className="field-label" htmlFor="map-org">Organization</label>
            <input id="map-org" className="field-input" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="e.g. Acme Structural" />
          </div>
          <div>
            <label className="field-label" htmlFor="map-role">Role</label>
            <Listbox id="map-role" className="field-input" value={role} onChange={(e) => setRole(e.target.value as SiteDrawingOrgMappingRole)}>
              {SITE_DRAWING_ORG_MAPPING_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Listbox>
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!canCreate || createMutation.isPending} className="btn-primary">
            {createMutation.isPending ? 'Saving…' : 'Add mapping'}
          </button>
        </div>
        {createMutation.isError && <p className="field-error">{apiErrorMessage(createMutation.error)}</p>}

        <div className="panel tick-frame divide-y divide-base-700/60">
          {(mappingsQuery.data ?? []).map((m) => (
            <div key={m.id} className="px-4 py-2 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-mono text-xs text-ink-500">{m.pattern}</span>
                <span className="text-ink-100">{m.organizationName}</span>
                <span className="text-xs text-ink-500">{ROLE_LABELS[m.role]}</span>
              </div>
              <button onClick={() => deleteMutation.mutate(m.id)} disabled={deleteMutation.isPending} className="btn-ghost !px-2 !py-2 text-xs">Remove</button>
            </div>
          ))}
          {mappingsQuery.data?.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-500">No mappings yet.</div>}
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      </div>
    </Modal>
  );
}
