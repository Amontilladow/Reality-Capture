import { useQuery } from '@tanstack/react-query';
import type { CompanyRole } from '@engineeringos/types';
import { useNavigate } from 'react-router-dom';
import { AuthLayout } from './auth/AuthLayout';
import { fetchMe, logout as apiLogout } from '../lib/auth.api';
import { useAuthStore } from '../store/auth.store';
import { COMPANY_ROLE_LABELS } from '../lib/issue-constants';

// The only screen a pending-approval user can ever reach -- the backend's
// PendingApprovalGuard blocks everything except GET /auth/me and
// POST /auth/logout regardless of what route the frontend tries to render,
// so this is the real, enforced dead end, not just a UI convenience.
export default function PendingApproval() {
  const navigate = useNavigate();
  const { refreshToken, clear } = useAuthStore();

  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  async function handleLogout() {
    try {
      if (refreshToken) await apiLogout(refreshToken);
    } catch {
      // best-effort — clear local session regardless
    }
    clear();
    navigate('/login', { replace: true });
  }

  const requestedRole = meQuery.data?.requestedCompanyRole as CompanyRole | undefined;

  return (
    <AuthLayout title="Awaiting approval" subtitle="Your account is set up, but not active yet.">
      <div className="space-y-4 text-sm text-ink-300">
        <p>
          An administrator needs to review and approve your account before you can use the workspace.
        </p>
        {requestedRole && (
          <p className="text-ink-500">
            You requested: <span className="text-ink-100">{COMPANY_ROLE_LABELS[requestedRole] ?? requestedRole}</span>
          </p>
        )}
        <p className="text-xs text-ink-500">
          There's nothing to do here -- check back later, or contact whoever invited you.
        </p>
        <button onClick={handleLogout} className="btn-secondary w-full">
          Sign out
        </button>
      </div>
    </AuthLayout>
  );
}
