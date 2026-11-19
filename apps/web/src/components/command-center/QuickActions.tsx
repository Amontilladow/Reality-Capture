import { Link } from 'react-router-dom';
import { categoryCan, getOrgCategory, SITE_RESTRICTED_COMPANY_ROLES, type CompanyRole } from '@engineeringos/types';
import { useAuthStore } from '../../store/auth.store';
import type { Animation } from 'react-useanimations';
import { WithAnimatedIcon } from '../ui/AnimatedIcon';
import aUpload from 'react-useanimations/lib/upload';
import aFlag from 'react-useanimations/lib/flag';
import aMessage from 'react-useanimations/lib/messageSquare';
import aCheck from 'react-useanimations/lib/checkCircle';
import aPlus from 'react-useanimations/lib/plusCircle';
import aClock from 'react-useanimations/lib/clock';

// Shortcuts into existing create flows. Each one shows only when the
// user's role could actually do it: the same org-category rules the API
// enforces (a project lead may always), narrowed by the site-role
// restriction (SiteRoleRestrictionGuard: construction roles write to
// issues/snags only; a site_engineer project member also to drawings).
// The API stays the authority.
export function QuickActions({ projectId, projectRole, onNewTask, onNewReminder }: {
  projectId: string;
  projectRole?: string;
  onNewTask: () => void;
  onNewReminder: () => void;
}) {
  const role = useAuthStore((s) => s.user?.companyRole) as CompanyRole | undefined;
  const cat = role ? getOrgCategory(role) : 'view_only';
  const superUser = projectRole === 'project_lead' || role === 'super_admin';
  const companyRestricted = Boolean(role && (SITE_RESTRICTED_COMPANY_ROLES as readonly string[]).includes(role));
  const siteAllowed = companyRestricted ? ['issues_snags'] : projectRole === 'site_engineer' ? ['issues_snags', 'drawings'] : null;
  const can = (module: Parameters<typeof categoryCan>[1]) =>
    (!siteAllowed || siteAllowed.includes(module)) && (superUser || categoryCan(cat, module, 'create'));
  const base = `/projects/${projectId}`;
  const links = [
    can('drawings') && { to: `${base}/site-drawings?new=1`, label: 'Upload drawing', anim: aUpload },
    can('issues_snags') && { to: `${base}/issues?new=1`, label: 'Create issue', anim: aFlag },
    can('rfis') && { to: `${base}/rfis/main?new=1`, label: 'Create RFI', anim: aMessage },
    can('qaqc_checklists') && { to: `${base}/qaqc/wir?new=1`, label: 'New inspection', anim: aCheck },
  ].filter(Boolean) as { to: string; label: string; anim: Animation }[];
  return (
    <div className="flex flex-wrap gap-2" aria-label="Quick actions">
      {links.map((l) => (
        <WithAnimatedIcon key={l.label} animation={l.anim} interaction="hover-replay">
          {(ev, icon) => <Link to={l.to} {...ev} className="btn-secondary">{icon}{l.label}</Link>}
        </WithAnimatedIcon>
      ))}
      <WithAnimatedIcon animation={aPlus} interaction="hover-replay">
        {(ev, icon) => <button type="button" {...ev} onClick={onNewTask} className="btn-secondary">{icon}Personal task</button>}
      </WithAnimatedIcon>
      <WithAnimatedIcon animation={aClock} interaction="hover-replay">
        {(ev, icon) => <button type="button" {...ev} onClick={onNewReminder} className="btn-secondary">{icon}Reminder</button>}
      </WithAnimatedIcon>
    </div>
  );
}
