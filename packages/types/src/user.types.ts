// ── RBAC ─────────────────────────────────────────────────────────────────────

export const COMPANY_ROLES = [
  'super_admin',
  'company_admin',
  'technical_director',
  'engineering_manager',
  'bim_manager',
  'project_manager',
  'construction_manager',
  'qa_qc_manager',
  'commercial_manager',
  'consultant',
  'client_representative',
  'project_engineer',
] as const;

// construction_manager and project_engineer are site-facing, deliberately
// restricted operational roles (CTO spec): full working access to Floor
// Plans/Issues/Snagging, read-only everywhere else, no access to project
// settings/user management/billing -- enforced by SiteRoleRestrictionGuard
// (common/guards/site-role-restriction.guard.ts), not by weight. The
// restricted "Site Engineer" identity is a third, separate case: it reuses
// the existing PROJECT-level PROJECT_ROLES 'site_engineer' value below
// (project_members.role), not a company role, since it's a per-project
// identity rather than a company-wide one -- the same guard checks both
// dimensions.
export const SITE_RESTRICTED_COMPANY_ROLES: readonly CompanyRole[] = ['construction_manager', 'project_engineer'];

export type CompanyRole = typeof COMPANY_ROLES[number];

// What a newly-invited person can request for themselves at signup, before
// admin approval -- excludes super_admin, which must always be granted
// deliberately by an existing admin, never self-selected even as a request.
export const SELF_REQUESTABLE_COMPANY_ROLES = COMPANY_ROLES.filter(
  (r): r is Exclude<CompanyRole, 'super_admin'> => r !== 'super_admin',
);

export const PROJECT_ROLES = [
  'project_lead',
  'site_engineer',
  'surveyor',
  'document_controller',
  'capture_operator',
  'viewer',
] as const;

export type ProjectRole = typeof PROJECT_ROLES[number];

// Permission hierarchy — higher index = more access
export const COMPANY_ROLE_WEIGHT: Record<CompanyRole, number> = {
  super_admin: 100,
  company_admin: 90,
  technical_director: 80,
  engineering_manager: 70,
  bim_manager: 65,
  project_manager: 60,
  construction_manager: 55,
  qa_qc_manager: 50,
  commercial_manager: 45,
  consultant: 30,
  client_representative: 20,
  // Weight only matters here for the existing @Roles() minimum-weight
  // gates elsewhere in the app -- this sits below every one of them (the
  // lowest existing gate requires weight >= 60), so it never accidentally
  // passes an elevated-action check. The actual restriction (full working
  // access to Floor Plans/Issues/Snagging, read-only elsewhere) is
  // enforced separately by SiteRoleRestrictionGuard, not by this number.
  project_engineer: 35,
};

export const PROJECT_ROLE_WEIGHT: Record<ProjectRole, number> = {
  project_lead: 100,
  site_engineer: 70,
  surveyor: 65,
  document_controller: 60,
  capture_operator: 40,
  viewer: 10,
};

// A specific, named capability a super_admin can grant to a company_admin on
// one specific project (see project_permission_grants). Unlike CompanyRole,
// this is not a hierarchy -- each permission is independently granted, and
// holding one implies nothing about the others. super_admin bypasses these
// checks everywhere; a project's own project_lead has them by default on
// their own project without needing a grant.
export const PROJECT_PERMISSIONS = [
  'manage_team',
  'manage_issues',
  'manage_project_records',
  'manage_rfis',
  // Narrower than manage_rfis: only the PMC/client review-and-approval step
  // (submit-for-review, decide-review), not answering or closing an RFI
  // directly. manage_rfis still covers this transition too -- this is an
  // additional, more restricted grant an admin can hand to a pure reviewer,
  // not a replacement.
  'approve_rfis',
  // Segregation-of-duties counterpart for snag items: only the
  // fixed -> verified sign-off step, not marking a snag fixed, editing it,
  // or anything else manage_project_records already covers. Additive, same
  // as approve_rfis -- manage_project_records still verifies too, so
  // nobody who can verify today loses that; this just lets an admin also
  // grant *only* the verification step to someone who shouldn't also be
  // able to mark their own fix as fixed in the first place.
  'verify_snag_items',
] as const;

export type ProjectPermission = typeof PROJECT_PERMISSIONS[number];

// ── USER TYPES ────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  companyId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  fullName: string; // computed: firstName + lastName
  phone?: string;
  avatarUrl?: string;
  companyRole: CompanyRole;
  isActive: boolean;
  lastLoginAt?: string;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  timezone?: string;
  notificationsEnabled?: boolean;
  defaultProjectId?: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  companyId: string;
  role: ProjectRole;
  invitedBy?: string;
  joinedAt: string;
  user?: Pick<User, 'id' | 'firstName' | 'lastName' | 'fullName' | 'email' | 'avatarUrl' | 'companyRole'>;
}

// ── AUTH TYPES ────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface JwtPayload {
  sub: string;        // user id
  email: string;
  companyId: string;
  companyRole: CompanyRole;
  firstName: string;
  lastName: string;
  // True while requested_company_role is still set (self-selected role
  // awaiting admin approval) -- PendingApprovalGuard blocks everything
  // except @AllowPending() routes while this is true.
  pendingApproval: boolean;
  iat?: number;
  exp?: number;
}

// What gets attached to every request by the JWT guard
export interface AuthenticatedUser {
  id: string;
  email: string;
  companyId: string;
  companyRole: CompanyRole;
  firstName: string;
  lastName: string;
  pendingApproval: boolean;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  invitationToken: string; // all registrations are invitation-only
}
