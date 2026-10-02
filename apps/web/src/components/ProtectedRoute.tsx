import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  // The access token is memory-only now (see auth.store.ts) -- on a fresh
  // page load it's always null until bootstrapSession()'s silent refresh
  // against the httpOnly cookie resolves. Redirecting to /login before that
  // finishes would log out every user on every reload.
  if (!isHydrated) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-ink-500">
        Loading…
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Hard gate: a pending-approval user can only ever reach /pending-approval.
  // This is a UX convenience, not the real enforcement -- the backend's
  // PendingApprovalGuard is what actually blocks every API call except
  // /auth/me and /auth/logout regardless of what route renders here.
  if (user?.pendingApproval && location.pathname !== '/pending-approval') {
    return <Navigate to="/pending-approval" replace />;
  }

  return <Outlet />;
}
