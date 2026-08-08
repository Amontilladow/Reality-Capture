import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

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
