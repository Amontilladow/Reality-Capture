import { Link } from 'react-router-dom';
import { categoryCan, getOrgCategory, type CompanyRole } from '@engineeringos/types';
import { useAuthStore } from '../../store/auth.store';

// Shortcuts into existing create flows. Each one shows only when the
// user's role could actually do it (same org-category rules the API
// enforces; a project lead may always). The API stays the authority.
export function QuickActions({ projectId, isProjectLead, onNewTask, onNewReminder }: {
  projectId: string;
  isProjectLead: boolean;
  onNewTask: () => void;
  onNewReminder: () => void;
}) {
  const role = useAuthStore((s) => s.user?.companyRole) as CompanyRole | undefined;
  const cat = role ? getOrgCategory(role) : 'view_only';
  const superUser = isProjectLead || role === 'super_admin';
  const can = (module: Parameters<typeof categoryCan>[1]) => superUser || categoryCan(cat, module, 'create');
  const base = `/projects/${projectId}`;
  const links = [
    can('drawings') && { to: `${base}/site-drawings?new=1`, label: 'Upload drawing', icon: 'M12 16V4m0 0l-4 4m4-4l4 4M4 20h16' },
    can('issues_snags') && { to: `${base}/issues?new=1`, label: 'Create issue', icon: 'M5 3v18M5 4h13l-3 4 3 4H5' },
    can('rfis') && { to: `${base}/rfis/main?new=1`, label: 'Create RFI', icon: 'M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V14m0 4h.01' },
    can('qaqc_checklists') && { to: `${base}/qaqc/wir?new=1`, label: 'New inspection', icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9' },
  ].filter(Boolean) as { to: string; label: string; icon: string }[];
  return (
    <div className="flex flex-wrap gap-2" aria-label="Quick actions">
      {links.map((l) => (
        <Link key={l.label} to={l.to} className="btn-secondary"><Glyph d={l.icon} />{l.label}</Link>
      ))}
      <button type="button" onClick={onNewTask} className="btn-secondary"><Glyph d="M12 5v14M5 12h14" />Personal task</button>
      <button type="button" onClick={onNewReminder} className="btn-secondary"><Glyph d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />Reminder</button>
    </div>
  );
}

function Glyph({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
