import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GlobalSearch } from '../workspace/GlobalSearch';
import type { Animation, EventProps } from 'react-useanimations';
import { WithAnimatedIcon } from '../ui/AnimatedIcon';
import { chain } from '../../lib/chain-handlers';
import aGrid from 'react-useanimations/lib/grid';
import aMessage from 'react-useanimations/lib/messageCircle';
import aUsers from 'react-useanimations/lib/users';
import aLayers from 'react-useanimations/lib/layers';
import aTrending from 'react-useanimations/lib/trendingUp';
import aAperture from 'react-useanimations/lib/aperture';
import aTool from 'react-useanimations/lib/tool';
import aZap from 'react-useanimations/lib/zap';
import aList from 'react-useanimations/lib/list';
import aSettings from 'react-useanimations/lib/settings';
import aLogOut from 'react-useanimations/lib/logOut';
import aBook from 'react-useanimations/lib/bookOpen';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAuthStore } from '../../store/auth.store';
import { logout as apiLogout } from '../../lib/auth.api';
import { getMembers } from '../../lib/projects.api';
import { COMPANY_ROLE_LABELS } from '../../lib/issue-constants';
import { NotificationBell } from './NotificationBell';
import { MessagesBell } from './MessagesBell';
import { ProjectSwitcher } from './ProjectContextPanel';
import { useProjectContext } from './useProjectContext';
import { CurvedGlassPanel } from './CurvedGlassPanel';
import { AppBackdrop } from './AppBackdrop';
import { ChatWidget } from '../chat/ChatWidget';
import { OnboardingFlow } from '../onboarding/OnboardingFlow';
import { LogoMark } from '../ui/LogoMark';
import { ThemeToggle } from '../ui/ThemeToggle';
import { clearAllOfflinePackages } from '../../lib/site-drawings-offline';

interface NavItem {
  /** Animated version of the icon, played when the row is hovered or focused. */
  anim?: Animation;
  to: string;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
  end?: boolean;
}
// A group with a heading is a section: one row (its icon and heading) that
// opens to show its pages on a tree line. A group without one lists its
// items as top-level rows.
interface NavGroup {
  anim?: Animation;
  // Stable key for the section's remembered open/closed state.
  id: string;
  heading?: string;
  icon?: (props: { className?: string }) => JSX.Element;
  items: NavItem[];
}

// The user's own tasks, calendar and saved items: personal, so the same
// section appears inside a project (where the calendar adds that
// project's deadlines) and outside one.
const MY_WORKSPACE_GROUP: NavGroup = {
  id: 'my-workspace',
  heading: 'My workspace',
  icon: IconCheckList,
  anim: aList,
  items: [
    { to: 'my-tasks', label: 'My tasks', icon: IconCheckList },
    { to: 'my-calendar', label: 'My calendar', icon: IconCheckList },
    { to: 'saved', label: 'My saved items', icon: IconCheckList },
  ],
};

// Company-level destinations, outside any project. Every item here is a
// route that already exists; nothing added for show.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    items: [
      { to: '', label: 'Projects', icon: IconGrid, end: true, anim: aGrid },
      { to: 'messages', label: 'Messages', icon: IconMail, anim: aMessage },
      { to: 'workforce', label: 'Workforce', icon: IconGauge, anim: aUsers },
    ],
  },
  MY_WORKSPACE_GROUP,
];

// Personal, account-level settings, pinned to the bottom of the sidebar so
// they're reachable from inside a project too. Every user connects their
// own AI provider (spec section 7) and their own mailbox (Phase 3: "a
// user can connect only their authorized mailbox"), so neither is gated.
const SETTINGS_ITEMS: NavItem[] = [
  { to: 'ai-settings', label: 'AI provider', icon: IconSpark },
  { to: 'email-settings', label: 'Email integration', icon: IconMail },
];
// Company-admin-only: API keys and webhooks are per-tenant (company_id),
// not per-project. Same role check WorkforcePage.tsx uses for its own
// admin-only sections.
const ADMIN_SETTINGS_ITEMS: NavItem[] = [
  { to: 'developer', label: 'Developer', icon: IconKey, end: false },
  { to: 'sharepoint-integration', label: 'SharePoint integration', icon: IconDrawingStack, end: false },
];

// Ordered by how a project team works: the day-to-day records first, then
// reporting, then the capture and engineering tools. Every item is an
// existing route (App.tsx); this only groups and orders them.
// Submittals/Transmittals/QA Inspections/Documents stay hidden from nav
// per request, backend modules/routes untouched; still reachable by
// direct URL, just not linked from the sidebar.
const PROJECT_NAV_GROUPS: NavGroup[] = [
  { id: 'overview', items: [{ to: '', label: 'Overview', icon: IconLayers, end: true, anim: aLayers }] },
  {
    id: 'project',
    heading: 'Project',
    icon: IconGrid,
    anim: aGrid,
    items: [
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
    icon: IconTrending,
    anim: aTrending,
    items: [
      { to: 'progress-report', label: 'Progress report', icon: IconTrending },
      { to: 'reports', label: 'Reports', icon: IconReport },
      { to: 'risk', label: 'Risk', icon: IconShield },
      // The project calendar: deadlines, inspections, reminders and (if
      // connected) the user's meetings. Same page as My workspace's
      // calendar outside a project.
      { to: 'my-calendar', label: 'Calendar', icon: IconCheckList },
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
    icon: IconCamera,
    anim: aAperture,
    items: [
      { to: 'bim', label: 'BIM models', icon: IconBim },
      { to: 'captures', label: 'BuildLens captures', icon: IconCamera },
      { to: 'buildlens', label: 'BuildLens timeline', icon: IconTimeline },
    ],
  },
  {
    id: 'engineering-tools',
    heading: 'Engineering tools',
    icon: IconGlobe,
    anim: aTool,
    items: [{ to: 'gis-prep', label: 'GIS preparation', icon: IconGlobe }],
  },
  { id: 'intelligence', items: [{ to: 'assistant', label: 'AI assistant', icon: IconSpark, anim: aZap }] },
  // Inside a project the calendar lives under Reporting & insights.
  { ...MY_WORKSPACE_GROUP, items: MY_WORKSPACE_GROUP.items.filter((i) => i.to !== 'my-calendar') },
];

// A 'subcontractor' project member (SubcontractorRfiAccessGuard) has
// backend access to this project's RFI module only; every other link
// above would 403 if clicked, so none of them are shown. No "Overview"
// entry either (ProjectDetail pulls from several of those same blocked
// modules); RFIs is both the only destination and, functionally, the
// project's landing page for this role; see RootRoute-style redirect in
// ProjectDetail.tsx for what happens if they land on /projects/:id anyway.
const SUBCONTRACTOR_NAV_GROUPS: NavGroup[] = [
  { id: 'subcontractor', items: [{ to: 'rfis', label: 'RFIs', icon: IconQuestion, anim: aMessage }] },
];

// Glass-tile look for the header's bell and messages buttons.
const HEADER_TILE = '!w-8 !h-8 !rounded-lg nav-tile';

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
  const settingsGroup: NavGroup = {
    id: 'settings',
    heading: 'Settings',
    icon: IconCog,
    anim: aSettings,
    items: isCompanyAdmin ? [...SETTINGS_ITEMS, ...ADMIN_SETTINGS_ITEMS] : SETTINGS_ITEMS,
  };

  // Same query useProjectContext already makes (shares its cache entry,
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
    <div className="relative isolate min-h-screen flex flex-col md:flex-row">
      <AppBackdrop />

      {/* Solid and layered above the page (no backdrop-blur: a filter would
          trap fixed-position descendants inside this 56px bar). */}
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

      {/* The curved glass sidebar: a drawer on phones, and pinned beside
          the page (sticky, full height) from tablet up. */}
      <aside
        className={`w-80 max-w-[calc(100vw-2rem)] shrink-0 fixed inset-y-0 left-0 z-50 p-2 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:p-4 md:pr-0 md:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <CurvedGlassPanel className="h-full">
          <div className="h-full flex flex-col px-6 pt-6 pb-4">
            <div className="flex items-center gap-2">
              <LogoMark className="w-8 h-8" />
              <div className="flex-1 min-w-0 text-eyebrow font-medium uppercase tracking-[0.16em] whitespace-nowrap truncate">
                Reality Capture
              </div>
              {/* Phones get the bells in the top bar instead. */}
              <div className="hidden md:flex items-center gap-2">
                <NotificationBell buttonClassName={HEADER_TILE} />
                <MessagesBell buttonClassName={HEADER_TILE} />
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
                className="md:hidden nav-tile hover:text-ink-100"
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>

            <SidebarProfile projectId={inProject ? params.projectId : undefined} />

            <div className="h-px my-4 bg-gradient-to-r from-transparent via-ink-100/25 to-transparent" />

            {inProject && (
              <NavLink to="/projects" end className="flex items-center gap-2 pl-2 mb-4 text-sm text-ink-500 hover:text-ink-100 transition-colors">
                <IconArrowLeft className="w-3.5 h-3.5" /> All projects
              </NavLink>
            )}
            <div className="nav-label">Menu</div>

            <nav aria-label="Main" className="nav-scroll flex-1 min-h-0 overflow-y-auto -mx-2 px-2 pb-4">
              {inProject && params.projectId ? (
                <NavTree groups={effectiveProjectNavGroups} basePath={`/projects/${params.projectId}`} />
              ) : (
                <NavTree groups={NAV_GROUPS} basePath="/projects" />
              )}
            </nav>

            <HelpCard />

            <div className="pt-2">
              <NavTree groups={[settingsGroup]} basePath="/projects" />
              <div className="flex items-center gap-2">
                <WithAnimatedIcon animation={aLogOut} interaction="hover-replay">
                  {(ev, icon) => (
                    <button type="button" {...ev} onClick={chain(() => void handleLogout(), ev.onClick)} className="nav-row flex-1">
                      <span className="nav-tile">{icon}</span>
                      Log out
                    </button>
                  )}
                </WithAnimatedIcon>
                <ThemeToggle />
              </div>
            </div>
          </div>
        </CurvedGlassPanel>
      </aside>

      {/* pb-16 keeps the last row of a page clear of the phone tab bar. */}
      <main className="flex-1 min-w-0 pb-16 md:pb-0">
        {/* Routes inside the shell are lazy-loaded (App.tsx); suspending here
            keeps the sidebar and header on screen while a page's chunk loads,
            instead of App's full-screen loader replacing the whole shell. */}
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>

      <PhoneTabBar
        projectId={inProject ? params.projectId : undefined}
        subcontractor={isSubcontractor}
        onMore={() => setMobileNavOpen(true)}
      />

      <GlobalSearch />
      <ChatWidget />
      <OnboardingFlow />
    </div>
  );
}

// The signed-in person: avatar with an online dot, name and role badge,
// then (inside a project) the project switcher, or their email outside one.
function SidebarProfile({ projectId }: { projectId?: string }) {
  const user = useAuthStore((s) => s.user);
  const initials = (user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '');
  const isCompanyAdmin = user?.companyRole === 'company_admin' || user?.companyRole === 'super_admin';
  const companyRoleLabel = isCompanyAdmin ? 'Admin' : user?.companyRole ? COMPANY_ROLE_LABELS[user.companyRole] : undefined;

  return (
    <div className="flex items-center gap-4 mt-6">
      <div className="relative w-14 h-14 shrink-0 rounded-full grid place-items-center text-lg font-semibold text-on-noir bg-noir ring-2 ring-ink-100/50 shadow-lg">
        {initials}
        <span aria-label="Signed in" role="img" className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-ok ring-2 ring-base-950" />
      </div>
      <div className="min-w-0 flex-1">
        {projectId ? (
          <ProjectProfileLines projectId={projectId} name={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`} fallbackRole={companyRoleLabel} />
        ) : (
          <>
            <ProfileName name={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`} role={companyRoleLabel} />
            <div className="text-sm text-ink-500 truncate">{user?.email}</div>
          </>
        )}
      </div>
    </div>
  );
}

function ProjectProfileLines({ projectId, name, fallbackRole }: { projectId: string; name: string; fallbackRole?: string }) {
  const { roleLabel, orgSlotLabel } = useProjectContext(projectId);
  return (
    <>
      <ProfileName name={name} role={roleLabel ?? fallbackRole} />
      <ProjectSwitcher projectId={projectId} />
      {orgSlotLabel && <div className="text-xs text-ink-500 truncate">{orgSlotLabel}</div>}
    </>
  );
}

function ProfileName({ name, role }: { name: string; role?: string }) {
  return (
    // The badge sits beside the name when both fit, and wraps under it when
    // a long role ("Project lead") would otherwise squeeze the name.
    <div className="flex flex-wrap items-center gap-x-2 min-w-0">
      <span className="max-w-full text-lg font-semibold text-ink-100 truncate">{name}</span>
      {role && (
        <span className="shrink-0 px-2 rounded-md bg-signal text-on-signal text-eyebrow leading-5 font-semibold uppercase tracking-wider">
          {role}
        </span>
      )}
    </div>
  );
}

// Help & training, as one clear shortcut above the account rows: the
// sidebar's own glass row style with a red icon tile, a title and a
// one-line hint, so it reads as a link to the help pages. (It replaces an
// image-and-panel "notice" card that read like a rendering glitch, and the
// plain Help row it duplicated.)
function HelpCard() {
  return (
    <WithAnimatedIcon animation={aBook} size={20} interaction="hover-replay">
      {(ev, icon) => (
        <NavLink
          to="/projects/help"
          {...ev}
          className={({ isActive }) =>
            `group flex items-center gap-4 shrink-0 mt-2 mb-2 p-2 pr-4 rounded-2xl border transition-colors ${
              isActive ? 'border-signal/60 bg-signal/10' : 'border-ink-100/15 bg-ink-100/5 hover:bg-ink-100/10'
            }`
          }
        >
          <span className="w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-signal text-on-signal">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-100 truncate">Help &amp; training</span>
            <span className="block text-xs text-ink-500 truncate">Guides and videos</span>
          </span>
          <IconChevron className="w-4 h-4 -rotate-90 text-ink-500 group-hover:text-ink-100 group-hover:translate-x-1 transition motion-reduce:transition-none" />
        </NavLink>
      )}
    </WithAnimatedIcon>
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

const OPEN_KEY = 'rc.nav.open';

function readOpen(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

// Which sections are open, shared by the main menu and the Settings
// section at the bottom, and kept in localStorage so the sidebar opens the
// way it was left.
const useNavOpenStore = create<{ open: Set<string>; set: (id: string, isOpen: boolean) => void }>((set, get) => ({
  open: readOpen(),
  set: (id, isOpen) => {
    const next = new Set(get().open);
    if (isOpen) next.add(id);
    else next.delete(id);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // Storage unavailable (private browsing): state just isn't remembered.
    }
    set({ open: next });
  },
}));

function isItemActive(pathname: string, basePath: string, item: NavItem): boolean {
  const target = item.to ? `${basePath}/${item.to}` : basePath;
  const path = pathname.replace(/\/+$/, '');
  return item.end ? path === target : path === target || path.startsWith(`${target}/`);
}

// Top-level rows put their icon in a glass tile; a section is a row that
// opens to show its pages on a tree line. The current page is a glossy
// accent pill. Navigating to a page opens its section, so the current page
// is never hidden; otherwise sections stay as the person left them.
function NavTree({ groups, basePath }: { groups: NavGroup[]; basePath: string }) {
  const { pathname } = useLocation();
  const open = useNavOpenStore((s) => s.open);
  const setOpen = useNavOpenStore((s) => s.set);

  useEffect(() => {
    const activeGroup = groups.find((g) => g.heading && g.items.some((item) => isItemActive(pathname, basePath, item)));
    if (activeGroup && !useNavOpenStore.getState().open.has(activeGroup.id)) setOpen(activeGroup.id, true);
    // Only a route change should open a section, not a manual close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, basePath]);

  const href = (item: NavItem) => (item.to ? `${basePath}/${item.to}` : basePath);

  return (
    <div className="space-y-0">
      {groups.map((group) => {
        if (!group.heading) {
          return group.items.map((item) => {
            const row = (ev: Partial<EventProps>, icon: ReactNode) => (
              <NavLink
                key={item.label}
                to={href(item)}
                end={item.end}
                {...ev}
                className={({ isActive }) => `nav-row ${isActive ? 'nav-pill-active' : ''}`}
              >
                <span className="nav-tile">{icon}</span>
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
            return item.anim
              ? <WithAnimatedIcon key={item.label} animation={item.anim} interaction="hover-replay">{row}</WithAnimatedIcon>
              : row({}, <item.icon className="w-4 h-4" />);
          });
        }
        const Icon = group.icon ?? IconLayers;
        const isOpen = open.has(group.id);
        const holdsCurrent = group.items.some((item) => isItemActive(pathname, basePath, item));
        const listId = `nav-section-${group.id}`;
        return (
          <div key={group.id}>
            {(() => {
              const head = (ev: Partial<EventProps>, icon: ReactNode) => (
                <button
                  type="button"
                  {...ev}
                  onClick={chain(() => setOpen(group.id, !isOpen), ev.onClick)}
                  aria-expanded={isOpen}
                  aria-controls={listId}
                  className={`nav-row ${holdsCurrent ? 'nav-row-current' : ''}`}
                >
                  <span className="nav-tile">{icon}</span>
                  <span className="flex-1 truncate">{group.heading}</span>
                  <IconChevron className={`w-3.5 h-3.5 opacity-60 transition-transform duration-150 motion-reduce:transition-none ${isOpen ? '' : '-rotate-90'}`} />
                </button>
              );
              return group.anim
                ? <WithAnimatedIcon animation={group.anim} interaction={group.anim === aSettings ? 'hover' : 'hover-replay'}>{head}</WithAnimatedIcon>
                : head({}, <Icon className="w-4 h-4" />);
            })()}
            {isOpen && (
              <div id={listId} className="nav-tree">
                {group.items.map((item) => (
                  <NavLink
                    key={item.label}
                    to={href(item)}
                    end={item.end}
                    className={({ isActive }) => `nav-child ${isActive ? 'nav-pill-active' : ''}`}
                  >
                    <span aria-hidden="true" className="nav-dot" />
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

function IconCheckList({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCog({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" strokeLinejoin="round" />
    </svg>
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

function PageLoading() {
  return (
    <div className="p-6 space-y-4" aria-busy="true" aria-label="Loading page">
      <div className="h-7 w-48 rounded bg-base-700/40 motion-safe:animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel h-[68px] bg-base-700/40 motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="panel h-64 bg-base-700/40 motion-safe:animate-pulse" />
    </div>
  );
}
