import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { logout as apiLogout } from '../../lib/auth.api';
import { NotificationBell } from './NotificationBell';

const NAV_ITEMS = [
  { to: '', label: 'Projects', icon: IconGrid, end: true },
];

const PROJECT_NAV_ITEMS = [
  { to: '', label: 'Overview', icon: IconLayers, end: true },
  { to: 'captures', label: 'Captures', icon: IconCamera },
  { to: 'issues', label: 'Issues', icon: IconFlag },
  { to: 'drawings', label: 'Floor Plans', icon: IconMap },
  { to: 'rfis', label: 'RFIs', icon: IconQuestion },
  { to: 'transmittals', label: 'Transmittals', icon: IconSend },
  { to: 'snagging', label: 'Snagging', icon: IconTag },
  { to: 'assistant', label: 'AI Assistant', icon: IconSpark },
  { to: 'reports', label: 'Reports', icon: IconReport },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();

  async function handleLogout() {
    try {
      if (refreshToken) await apiLogout(refreshToken);
    } catch {
      // best-effort — clear local session regardless
    }
    clear();
    navigate('/login', { replace: true });
  }

  const inProject = Boolean(params.projectId);

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-base-600 bg-base-900 flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-base-600">
          <IconMark />
          <div className="leading-tight flex-1 min-w-0">
            <div className="text-sm font-semibold tracking-tight">EngineeringOS</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">Reality Capture</div>
          </div>
          <NotificationBell />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
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
function IconQuestion({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 014.9.8c0 1.7-2.4 2-2.4 3.7" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconSend({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 11l16-7-6.5 16-3-6.5L4 11z" strokeLinecap="round" strokeLinejoin="round" />
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
function IconSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" strokeLinejoin="round" />
      <path d="M19 15l0.8 2.2L22 18l-2.2 0.8L19 21l-0.8-2.2L16 18l2.2-0.8L19 15z" strokeLinejoin="round" />
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
