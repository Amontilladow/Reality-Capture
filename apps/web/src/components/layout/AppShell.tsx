import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { logout as apiLogout } from '../../lib/auth.api';
import { NotificationBell } from './NotificationBell';
import { MessagesBell } from './MessagesBell';
import { ChatWidget } from '../chat/ChatWidget';

const NAV_ITEMS = [
  { to: '', label: 'Projects', icon: IconGrid, end: true },
  { to: 'messages', label: 'Messages', icon: IconMail },
  { to: 'workforce', label: 'Workforce', icon: IconGauge },
];

const PROJECT_NAV_ITEMS = [
  { to: '', label: 'Overview', icon: IconLayers, end: true },
  { to: 'captures', label: 'Captures', icon: IconCamera },
  { to: 'issues', label: 'Issues', icon: IconFlag },
  { to: 'drawings', label: 'Floor Plans', icon: IconMap },
  { to: 'buildlens', label: 'BuildLens', icon: IconTimeline },
  { to: 'rfis', label: 'RFIs', icon: IconQuestion },
  { to: 'snagging', label: 'Snagging', icon: IconTag },
  { to: 'submittals', label: 'Submittals', icon: IconInbox },
  { to: 'assistant', label: 'AI Assistant', icon: IconSpark },
  { to: 'risk', label: 'Risk', icon: IconShield },
  { to: 'progress-report', label: 'Progress Report', icon: IconTrending },
  { to: 'reports', label: 'Reports', icon: IconReport },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // A route change means the user picked a destination — close the drawer
  // so it doesn't stay covering the page it just navigated to.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    try {
      await apiLogout();
    } catch {
      // best-effort — clear local session regardless
    }
    clear();
    navigate('/login', { replace: true });
  }

  const inProject = Boolean(params.projectId);

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="h-14 flex md:hidden items-center gap-2 px-4 border-b border-base-600 bg-base-900 shrink-0">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation menu"
          className="p-2 -ml-2 text-ink-300 hover:text-ink-100"
        >
          <IconMenu className="w-5 h-5" />
        </button>
        <IconMark className="w-5 h-5" />
        <div className="text-sm font-semibold tracking-tight">EngineeringOS</div>
      </div>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-60 shrink-0 border-r border-base-600 bg-base-900 flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 flex items-center gap-2 px-5 border-b border-base-600">
          <IconMark />
          <div className="leading-tight flex-1 min-w-0">
            <div className="text-sm font-semibold tracking-tight">EngineeringOS</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">Reality Capture</div>
          </div>
          <NotificationBell />
          <MessagesBell />
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="md:hidden p-1 text-ink-300 hover:text-ink-100"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {!inProject &&
            NAV_ITEMS.map((item) => (
              <NavLink
                key={item.label}
                to={`/projects/${item.to}`}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${
                    isActive ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800 hover:text-ink-100'
                  }`
                }
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}

          {inProject && (
            <>
              <NavLink
                to="/projects"
                className="flex items-center gap-2 px-3 py-2 mb-2 text-xs text-ink-500 hover:text-ink-100"
              >
                <IconArrowLeft className="w-3.5 h-3.5" /> All projects
              </NavLink>
              {PROJECT_NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.label}
                  to={`/projects/${params.projectId}/${item.to}`}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${
                      isActive ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800 hover:text-ink-100'
                    }`
                  }
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="border-t border-base-600 p-3">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-7 h-7 rounded-full bg-blueprint/20 border border-blueprint/40 flex items-center justify-center text-xs font-mono text-blueprint shrink-0">
              {(user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-[10px] text-ink-500 truncate">{user?.email}</div>
            </div>
          </div>
          <button onClick={handleLogout} className="btn-ghost w-full mt-1 justify-start text-xs px-2">
            <IconLogout className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 bg-grid-fine bg-grid-fine">
        <Outlet />
      </main>

      <ChatWidget />
    </div>
  );
}

function IconMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <rect x="2" y="2" width="20" height="20" rx="2" stroke="#FF7A29" strokeWidth="1.5" />
      <path d="M2 8h20M8 2v20" stroke="#4FB6E8" strokeWidth="1" opacity="0.6" />
      <circle cx="8" cy="8" r="1.4" fill="#FF7A29" />
    </svg>
  );
}
function IconGrid({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  );
}
function IconLayers({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" strokeLinecap="round" />
    </svg>
  );
}
function IconCamera({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}
function IconFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 3v18" strokeLinecap="round" /><path d="M5 4h13l-3 4 3 4H5" strokeLinejoin="round" />
    </svg>
  );
}
function IconMap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 3L3 5v16l6-2 6 2 6-2V3l-6 2-6-2z" strokeLinejoin="round" />
      <path d="M9 3v16M15 5v16" />
    </svg>
  );
}
function IconTimeline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 12h4l2-6 4 12 2-6h6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconQuestion({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 014.9.8c0 1.7-2.4 2-2.4 3.7" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconTag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3h6a3 3 0 013 3v6l-9 9-9-9 9-9z" strokeLinejoin="round" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconInbox({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 12h4l2 3h4l2-3h4" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M4 12l1.5-6.5A1 1 0 016.47 4.7h11.06a1 1 0 01.97.8L20 12v6a1.6 1.6 0 01-1.6 1.6H5.6A1.6 1.6 0 014 18v-6z" strokeLinejoin="round" />
    </svg>
  );
}
function IconSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" strokeLinejoin="round" />
      <path d="M19 15l0.8 2.2L22 18l-2.2 0.8L19 21l-0.8-2.2L16 18l2.2-0.8L19 15z" strokeLinejoin="round" />
    </svg>
  );
}
function IconGauge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 20a8 8 0 1 1 8-8" strokeLinecap="round" />
      <path d="M12 12l4-4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" strokeLinejoin="round" />
      <path d="M12 8v5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconReport({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 3h7l4 4v14H7z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M9.5 13l2 2 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconTrending({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconMail({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconLogout({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" />
      <path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconMenu({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}
function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
