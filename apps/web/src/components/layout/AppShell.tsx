import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth.store';
import { logout as apiLogout } from '../../lib/auth.api';
import { getMembers } from '../../lib/projects.api';
import { NotificationBell } from './NotificationBell';
import { MessagesBell } from './MessagesBell';
import { ProjectContextPanel } from './ProjectContextPanel';
import { ChatWidget } from '../chat/ChatWidget';
import { OnboardingFlow } from '../onboarding/OnboardingFlow';
import { LogoMark } from '../ui/LogoMark';
import { ThemeToggle } from '../ui/ThemeToggle';
import { clearAllOfflinePackages } from '../../lib/site-drawings-offline';

interface NavItem {
  to: string;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
  end?: boolean;
}
interface NavGroup {
  // Stable key for the group's remembered expanded/collapsed state.
  id: string;
  heading?: string;
  items: NavItem[];
}

// Grouped so the list reads as sections (brief: "the navigation must be
// scalable as more modules are added") instead of one flat column; every
// item here is a route that already exists; nothing added for show.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    items: [
      { to: '', label: 'Projects', icon: IconGrid, end: true },
      { to: 'messages', label: 'Messages', icon: IconMail },
      { to: 'workforce', label: 'Workforce', icon: IconGauge },
    ],
  },
  // Personal, account-level settings; every user connects their own AI
  // provider (spec section 7) and their own mailbox (Phase 3: "a user can
  // connect only their authorized mailbox"), so neither is gated like
  // DEVELOPER_NAV_GROUP below. Merged from four one-item groups whose
  // headings only repeated the item's own name.
  {
    id: 'account',
    heading: 'Account',
    items: [
      { to: 'ai-settings', label: 'AI provider', icon: IconSpark },
      { to: 'email-settings', label: 'Email integration', icon: IconMail },
      { to: 'help', label: 'Help & training', icon: IconHelp },
    ],
  },
];

// Company-admin-only: API keys and webhooks are per-tenant (company_id),
// not per-project, so this lives alongside the other company-level nav
// groups, not under PROJECT_NAV_GROUPS. Same role check WorkforcePage.tsx
// uses for its own admin-only sections.
const DEVELOPER_NAV_GROUP: NavGroup = {
  id: 'admin',
  heading: 'Admin',
  items: [
    { to: 'developer', label: 'Developer', icon: IconKey, end: false },
    { to: 'sharepoint-integration', label: 'SharePoint integration', icon: IconDrawingStack, end: false },
  ],
};

// Sections ordered by how a project team works: the day-to-day records
// first, then reporting, then the capture and engineering tools. Every
// item is an existing route (App.tsx); this only groups and orders them.
// Submittals/Transmittals/QA Inspections/Documents stay hidden from nav
// per request, backend modules/routes untouched; still reachable by
// direct URL, just not linked from the sidebar.
const PROJECT_NAV_GROUPS: NavGroup[] = [
  {
    id: 'project',
    heading: 'Project',
    items: [
      { to: '', label: 'Overview', icon: IconLayers, end: true },
      { to: 'site-drawings', label: 'Site drawings', icon: IconDrawingStack },
      { to: 'drawings', label: 'Floor plans', icon: IconMap },
      { to: 'issues', label: 'Issues', icon: IconFlag },
      { to: 'qaqc', label: 'QA/QC', icon: IconQaqc },
      { to: 'rfis', label: 'RFIs', icon: IconQuestion },
      { to: 'snagging', label: 'Snagging', icon: IconTag },
    ],
  },
  {
    id: 'reporting',
    heading: 'Reporting & insights',
    items: [
      { to: 'progress-report', label: 'Progress report', icon: IconTrending },
      { to: 'reports', label: 'Reports', icon: IconReport },
      { to: 'risk', label: 'Risk', icon: IconShield },
    ],
  },
  {
    // Two distinct BuildLens tools, both kept: "captures" is the
    // plan-and-pin tool (camera-location pins on an uploaded plan, media
    // attached per pin; CapturesPage.tsx), "buildlens" plays back each
    // location's captures over time (BuildLensPage/BuildLensTimelinePage).
    // Only the nav label of the latter gained "timeline" to tell them apart.
    id: 'reality-capture',
    heading: 'Reality capture',
    items: [
      { to: 'bim', label: 'BIM models', icon: IconBim },
      { to: 'captures', label: 'BuildLens captures', icon: IconCamera },
      { to: 'buildlens', label: 'BuildLens timeline', icon: IconTimeline },
    ],
  },
  {
    id: 'engineering-tools',
    heading: 'Engineering tools',
    items: [{ to: 'gis-prep', label: 'GIS preparation', icon: IconGlobe }],
  },
  {
    id: 'intelligence',
    heading: 'Intelligence',
    items: [{ to: 'assistant', label: 'AI assistant', icon: IconSpark }],
  },
];

// A 'subcontractor' project member (SubcontractorRfiAccessGuard) has
// backend access to this project's RFI module only; every other link
// above would 403 if clicked, so none of them are shown. No "Overview"
// entry either (ProjectDetail pulls from several of those same blocked
// modules); RFIs is both the only destination and, functionally, the
// project's landing page for this role; see RootRoute-style redirect in
// ProjectDetail.tsx for what happens if they land on /projects/:id anyway.
const SUBCONTRACTOR_NAV_GROUPS: NavGroup[] = [
  { id: 'subcontractor', items: [{ to: 'rfis', label: 'RFIs', icon: IconQuestion }] },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // A route change means the user picked a destination; close the drawer
  // so it doesn't stay covering the page it just navigated to.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    try {
      await apiLogout();
    } catch {
      // best-effort: clear local session regardless
    }
    clear();
    // Site Drawing Hub offline packages (brief section 9: "Clear locally
    // cached protected data when the user signs out"). Best-effort and
    // fire-and-forget, same as apiLogout() above; a failure here must
    // never block sign-out itself.
    clearAllOfflinePackages().catch(() => {});
    navigate('/login', { replace: true });
  }

  const inProject = Boolean(params.projectId);
  const isCompanyAdmin = user?.companyRole === 'company_admin' || user?.companyRole === 'super_admin';
  const navGroups = isCompanyAdmin ? [...NAV_GROUPS, DEVELOPER_NAV_GROUP] : NAV_GROUPS;

  // Same query ProjectContextPanel already makes (shares its cache entry,
  // no extra request): read here too so the nav itself can collapse down
  // to RFIs-only for a subcontractor project member, rather than showing
  // every link and letting each one 403 when clicked.
  const membersQuery = useQuery({
    queryKey: ['members', params.projectId],
    queryFn: () => getMembers(params.projectId!),
    enabled: inProject,
  });
  const isSubcontractor = (membersQuery.data ?? []).some((m) => m.userId === user?.id && m.role === 'subcontractor');
  const effectiveProjectNavGroups = isSubcontractor ? SUBCONTRACTOR_NAV_GROUPS : PROJECT_NAV_GROUPS;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Solid and layered above the page (no backdrop-blur: a filter would
          trap the bells' fixed-position menus inside this 56px bar). */}
      <div className="relative z-30 h-14 flex md:hidden items-center gap-2 px-4 border-b border-base-600/70 bg-base-950 shrink-0">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation menu"
          className="p-2 -ml-2 text-ink-300 hover:text-ink-100"
        >
          <IconMenu className="w-5 h-5" />
        </button>
        <LogoMark className="w-8 h-8" />
        <div className="text-base font-semibold tracking-tight flex-1 truncate">Reality Capture</div>
        <NotificationBell />
        <MessagesBell />
        <ThemeToggle />
      </div>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-base-950/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-72 shrink-0 border-r border-base-600/70 bg-base-900 md:bg-transparent flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand on one line with the notifications bell and the single
            Messages menu (inbox, team chat, email app); the theme toggle
            moved to the account footer, where it no longer squeezes the
            product name into a three-line wrap. */}
        <div className="h-16 flex items-center gap-2 pl-4 pr-2 border-b border-base-600">
          <LogoMark className="w-10 h-10 shrink-0" />
          <div className="leading-tight flex-1 min-w-0">
            <div className="text-base font-semibold tracking-tight truncate">Reality Capture</div>
            <div className="text-xs text-ink-500 truncate">EngineeringOS</div>
          </div>
          {/* Phones get the bells in the top bar instead. */}
          <div className="hidden md:flex items-center">
            <NotificationBell />
            <MessagesBell />
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="md:hidden p-2 text-ink-300 hover:text-ink-100"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-4 overflow-y-auto">
          {!inProject && <NavGroupList groups={navGroups} basePath="/projects" />}

          {inProject && params.projectId && (
            <>
              <NavLink
                to="/projects"
                end
                className="flex items-center gap-2 px-4 py-2 mb-2 text-sm text-ink-500 hover:text-ink-100"
              >
                <IconArrowLeft className="w-3.5 h-3.5" /> All projects
              </NavLink>
              <ProjectContextPanel projectId={params.projectId} />
              <div className="mt-4">
                <NavGroupList groups={effectiveProjectNavGroups} basePath={`/projects/${params.projectId}`} />
              </div>
            </>
          )}
        </nav>

        <div className="border-t border-base-600 p-4">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-base-700 border border-base-600 flex items-center justify-center text-xs font-semibold text-ink-300 shrink-0">
              {(user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-xs text-ink-500 truncate">{user?.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={handleLogout} className="btn-ghost flex-1 justify-start px-2 h-9">
              <IconLogout className="w-4 h-4" /> Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* pb-16 keeps the last row of a page clear of the phone tab bar. */}
      <main className="flex-1 min-w-0 pb-16 md:pb-0">
        <Outlet />
      </main>

      <PhoneTabBar
        projectId={inProject ? params.projectId : undefined}
        subcontractor={isSubcontractor}
        onMore={() => setMobileNavOpen(true)}
      />

      <ChatWidget />
      <OnboardingFlow />
    </div>
  );
}

// Phones: the four places a site team goes most, as a bottom tab bar
// (thumb reach, always visible), plus "More" for the full menu drawer.
function PhoneTabBar({ projectId, subcontractor, onMore }: { projectId?: string; subcontractor: boolean; onMore: () => void }) {
  const base = projectId ? `/projects/${projectId}` : '/projects';
  const tabs: NavItem[] = projectId
    ? subcontractor
      ? [{ to: 'rfis', label: 'RFIs', icon: IconQuestion }]
      : [
          { to: '', label: 'Overview', icon: IconLayers, end: true },
          { to: 'issues', label: 'Issues', icon: IconFlag },
          { to: 'rfis', label: 'RFIs', icon: IconQuestion },
          { to: 'risk', label: 'Risk', icon: IconShield },
        ]
    : [
        { to: '', label: 'Projects', icon: IconGrid, end: true },
        { to: 'messages', label: 'Messages', icon: IconMail },
        { to: 'workforce', label: 'Workforce', icon: IconGauge },
      ];
  const tabClass = (active: boolean) =>
    `flex-1 flex flex-col items-center justify-center gap-0 text-xs transition-colors ${active ? 'text-ink-100 font-semibold' : 'text-ink-500 hover:text-ink-100'}`;
  return (
    <nav
      aria-label="Quick navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 flex bg-base-950 border-t border-base-600/70"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((t) => (
        <NavLink key={t.label} to={t.to ? `${base}/${t.to}` : base} end={t.end} className={({ isActive }) => tabClass(isActive)}>
          <t.icon className="w-5 h-5" />
          {t.label}
        </NavLink>
      ))}
      <button type="button" onClick={onMore} className={tabClass(false)}>
        <IconMenu className="w-5 h-5" />
        More
      </button>
    </nav>
  );
}

const COLLAPSED_KEY = 'rc.nav.collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function isItemActive(pathname: string, basePath: string, item: NavItem): boolean {
  const target = item.to ? `${basePath}/${item.to}` : basePath;
  const path = pathname.replace(/\/+$/, '');
  return item.end ? path === target : path === target || path.startsWith(`${target}/`);
}

// Headed sections collapse and expand; which ones are collapsed is kept in
// localStorage so the sidebar opens the way it was left. A section that
// holds the page being navigated to always reopens, so the active item is
// never hidden behind a collapsed heading.
function NavGroupList({ groups, basePath }: { groups: NavGroup[]; basePath: string }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  function persist(next: Set<string>) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      // Storage unavailable (private browsing): state just isn't remembered.
    }
  }

  useEffect(() => {
    const activeGroup = groups.find((g) => g.items.some((item) => isItemActive(pathname, basePath, item)));
    if (activeGroup && collapsed.has(activeGroup.id)) {
      const next = new Set(collapsed);
      next.delete(activeGroup.id);
      persist(next);
    }
    // Only a route change should reopen a section, not the collapse itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, basePath]);

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persist(next);
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const open = !group.heading || !collapsed.has(group.id);
        const listId = `nav-section-${group.id}`;
        return (
          <div key={group.id}>
            {group.heading && (
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
                aria-controls={listId}
                className="group w-full flex items-center justify-between h-7 px-4 rounded-full text-eyebrow font-medium uppercase text-ink-500 hover:text-ink-300 transition-colors"
              >
                {group.heading}
                <IconChevron className={`w-3.5 h-3.5 md:opacity-0 md:group-hover:opacity-100 group-focus-visible:opacity-100 transition-transform duration-150 motion-reduce:transition-none ${open ? '' : '-rotate-90 !opacity-100'}`} />
              </button>
            )}
            {open && (
              <div id={listId} className="space-y-0">
                {group.items.map((item) => (
                  <NavLink
                    key={item.label}
                    to={item.to ? `${basePath}/${item.to}` : basePath}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-4 h-8 rounded-full text-sm transition-colors ${
                        isActive
                          ? 'bg-signal text-base-800 font-medium'
                          : 'text-ink-300 hover:bg-base-800/70 hover:text-ink-100'
                      }`
                    }
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IconChevron({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
// GIS preparation: a globe, so it no longer shares Floor plans' map icon.
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" strokeLinejoin="round" />
    </svg>
  );
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  );
}
function IconLayers({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" strokeLinecap="round" />
    </svg>
  );
}
function IconCamera({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}
function IconFlag({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 3v18" strokeLinecap="round" /><path d="M5 4h13l-3 4 3 4H5" strokeLinejoin="round" />
    </svg>
  );
}
function IconMap({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 3L3 5v16l6-2 6 2 6-2V3l-6 2-6-2z" strokeLinejoin="round" />
      <path d="M9 3v16M15 5v16" />
    </svg>
  );
}
function IconDrawingStack({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="6" y="3" width="14" height="14" rx="1.5" />
      <path d="M4 7v12a1.5 1.5 0 0 0 1.5 1.5H17" />
    </svg>
  );
}
function IconTimeline({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 12h4l2-6 4 12 2-6h6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconQuestion({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 014.9.8c0 1.7-2.4 2-2.4 3.7" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconTag({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3h6a3 3 0 013 3v6l-9 9-9-9 9-9z" strokeLinejoin="round" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
// Document-with-alert-mark: distinct from a checklist pass/fail icon and
// IconShield (Risk) since NCR/SOR is neither: a formal flagged report, not
// a checklist and not the risk score itself.
function IconQaqc({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      <path d="M12 9v4" strokeLinecap="round" />
      <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconSpark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" strokeLinejoin="round" />
      <path d="M19 15l0.8 2.2L22 18l-2.2 0.8L19 21l-0.8-2.2L16 18l2.2-0.8L19 15z" strokeLinejoin="round" />
    </svg>
  );
}
function IconGauge({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 20a8 8 0 1 1 8-8" strokeLinecap="round" />
      <path d="M12 12l4-4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconShield({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" strokeLinejoin="round" />
      <path d="M12 8v5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconReport({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 3h7l4 4v14H7z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M9.5 13l2 2 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconTrending({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
// Open book, not another question mark; IconQuestion (RFI) already owns
// that shape; Help & Training needs its own silhouette in the same nav.
function IconHelp({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 6c-1.5-1-4-1.5-6-1.2v12c2 -0.3 4.5 0.2 6 1.2 1.5-1 4-1.5 6-1.2V4.8c-2-0.3-4.5 0.2-6 1.2z" strokeLinejoin="round" />
      <path d="M12 6v12" />
    </svg>
  );
}
function IconBim({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" strokeLinejoin="round" />
      <path d="M12 3v9m0 9v-9m-8-4.5L12 12l8-4.5" strokeLinejoin="round" />
    </svg>
  );
}
function IconKey({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M14 9l2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconMail({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconLogout({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" />
      <path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconMenu({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}
function IconClose({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
