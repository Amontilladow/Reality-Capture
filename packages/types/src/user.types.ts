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
  // ── Org-category sprint additions (see ORG_CATEGORIES/getOrgCategory below) ──
  // Exact title matches from the owner's organizational chart, category
  // "Management" (1.1-1.3; 1.4 is engineering_manager above, already existed).
  // Nobody holds these until explicitly assigned via the existing company-role
  // admin UI (ManageMembersModal) -- purely additive, same non-breaking
  // ALTER TYPE ADD VALUE pattern already used for project_engineer (063) and
  // subcontractor (070).
  'chairman',
  'general_manager',
  'operations_manager',
  // Category "Document Control" (5.1-5.2) had NO company-wide title at all
  // before this -- 'document_controller' only existed as a per-project
  // ProjectRole (project_members.role), a different axis entirely (see
  // ProjectRole below). These are the company-wide equivalents.
  'project_document_controller',
  'document_control_assistant',
  // Interim, deliberately generic stand-ins for the 8 individual-contributor
  // titles the org chart lists under Engineering Team (Architect, Structural/
  // Mechanical/Electrical Engineer, Draftsman, BIM Coordinator, BIM Modeler,
  // Materials Engineer) and QAQC Team (QAQC Engineer, QAQC Inspector) that
  // have no company-wide role today beyond the *_manager titles. This sprint
  // is scoped to category-level enforcement only (see ORG_CATEGORIES) -- full
  // per-title granularity for these 8 is an explicit future extension point
  // (see ORG_TITLES), not built here. Until then, anyone hired into one of
  // those 8 titles is assigned one of these two so they're at least correctly
  // categorized.
  'engineering_team_member',
  'qaqc_team_member',
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
  // An outside subcontractor-company user invited onto this one project,
  // not a same-company employee like every role above. Enforced by
  // SubcontractorRfiAccessGuard (common/guards/subcontractor-rfi-access.guard.ts):
  // every request outside the RFI module is blocked outright (not just
  // writes, unlike SiteRoleRestrictionGuard's read-everywhere/write-nowhere
  // shape -- a subcontractor shouldn't see Issues/Documents/financials/etc.
  // at all), reviewer-only RFI workflow transitions (respond/close/etc.)
  // are blocked outright, and writes to any RFI's own record/attachments
  // are ownership-checked (must be raised_by_organization_slot =
  // 'subcontractor' AND created by this user). Still a plain `users` row
  // under the project owner's own company_id (no cross-tenant RLS change --
  // see that guard's own header comment) invited the same way any other
  // project member is.
  'subcontractor',
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
  // New Management-category titles (org chart 1.1-1.3) -- despite sitting
  // above company_admin on the org chart, these are DELIBERATELY LOW
  // weight, below every existing @Roles()-gated action in the app (the
  // lowest existing gate requires weight >= 60; see project_engineer's own
  // comment above). A first attempt gave them a weight reflecting their
  // org-chart seniority (90+) -- that silently passed every existing
  // @Roles('company_admin', 'engineering_manager')-gated route elsewhere in
  // the codebase (RolesGuard's check is userWeight >= MIN of the named
  // roles' weights, i.e. >= engineering_manager's 70), since these titles
  // are view-only everywhere per OrgCategoryPermissionService's matrix, not
  // broadly privileged. Weight here must stay low; their actual, correct
  // access comes entirely from the category matrix (view-only on most
  // modules, plus the section-7 restriction -- see
  // SECTION_7_VIEW_ONLY_COMPANY_ROLES), never from this number.
  chairman: 15,
  general_manager: 14,
  operations_manager: 13,
  // New Document Control company-wide titles (org chart 5.1-5.2).
  project_document_controller: 55,
  document_control_assistant: 25,
  // Interim individual-contributor placeholders (see COMPANY_ROLES comment).
  engineering_team_member: 25,
  qaqc_team_member: 25,
};

// ── Organizational categories (owner's RBAC sprint) ─────────────────────────
//
// A second, coarser classification layered on top of CompanyRole: "which of
// the owner's 6 organizational categories does this company-wide title
// belong to" (ORG_TITLES below documents the full 24-title chart those
// categories come from). Checked by OrgCategoryPermissionService
// (apps/api/src/common/authorization/org-category-permission.service.ts)
// against a declarative module x category permission matrix -- see
// CATEGORY_PERMISSION_MATRIX in org-permission.types.ts.
//
// 'engineering_manager' is its own category, not a member of 'management',
// because its access profile is categorically different (full C/V/E/A/X
// everywhere) rather than a variation on Management's (mostly view-only) --
// modeling it as a distinct category lets the permission matrix stay a
// plain per-category lookup table with no special-cased boolean bolted on.
//
// 'view_only' covers company-wide titles the org chart doesn't place in any
// of the 6 real categories at all (today: client_representative, which is
// also the signup default -- see SELF_REQUESTABLE_COMPANY_ROLES) -- view
// access everywhere in the matrix, never create/edit/approve/close.
//
// Subcontractor/"External" (org chart category 6) is deliberately NOT a
// member of this enum: unlike the other 5 categories, it's inherently
// project-scoped, not company-wide (see ProjectRole's own 'subcontractor'
// value and its header comment) -- a user could in principle hold any
// CompanyRole/OrgCategory and separately be a 'subcontractor' project member
// on one specific project they were invited to. It stays on that existing,
// separate axis; OrgCategoryPermissionService checks ProjectRole directly
// for it rather than folding it in here.
export const ORG_CATEGORIES = [
  'management',
  'engineering_manager',
  'construction_team',
  'engineering_team',
  'qaqc_team',
  'document_control',
  'view_only',
] as const;

export type OrgCategory = typeof ORG_CATEGORIES[number];

// CompanyRole -> OrgCategory. Every current and new CompanyRole value is
// listed explicitly (no fallthrough default) so adding a future CompanyRole
// value without updating this map is a compile error, not a silent gap.
//
// Reconciliation notes for values with no exact title match in the owner's
// org chart (flagged explicitly rather than guessed silently, per the
// owner's own sprint instructions -- see this sprint's session report for
// the full writeup):
//  - commercial_manager, consultant, company_admin: no corresponding title
//    anywhere in the chart -> mapped to 'management' (owner's decision:
//    "map conservatively").
//  - technical_director: no exact title match either, but "Technical
//    Manager" (org chart 3.1) is a close real-world synonym and sits under
//    Engineering Team -> mapped there rather than folded into 'management'.
//  - client_representative: no match anywhere, and is the signup default
//    for every new self-registered user -> 'view_only' (owner's decision).
export const COMPANY_ROLE_TO_ORG_CATEGORY: Record<CompanyRole, OrgCategory> = {
  super_admin: 'management', // moot in practice -- super_admin bypasses the category matrix entirely, see OrgCategoryPermissionService
  company_admin: 'management',
  technical_director: 'engineering_team',
  engineering_manager: 'engineering_manager',
  bim_manager: 'engineering_team',
  project_manager: 'construction_team',
  construction_manager: 'construction_team',
  qa_qc_manager: 'qaqc_team',
  commercial_manager: 'management',
  consultant: 'management',
  client_representative: 'view_only',
  project_engineer: 'construction_team',
  chairman: 'management',
  general_manager: 'management',
  operations_manager: 'management',
  project_document_controller: 'document_control',
  document_control_assistant: 'document_control',
  engineering_team_member: 'engineering_team',
  qaqc_team_member: 'qaqc_team',
};

// Defensive against a runtime value that isn't actually a valid CompanyRole
// -- some existing call sites (e.g. IssuesService.isPermittedApprover())
// take a loosely-typed `userRole: string`, not CompanyRole, so a cast at
// the call site doesn't guarantee the lookup below will find a key. Falls
// back to the most restrictive category (view_only) rather than throwing
// or returning undefined, so an unrecognized role fails closed instead of
// crashing or silently granting access.
export function getOrgCategory(companyRole: CompanyRole): OrgCategory {
  return COMPANY_ROLE_TO_ORG_CATEGORY[companyRole] ?? 'view_only';
}

// Company roles that get the narrower "view only" restriction on Risk
// Register/Reports/Snagging-reads/BuildLens/BuildLens Captures/AI Assistant
// (owner's matrix section 7) -- deliberately NARROWER than
// COMPANY_ROLE_TO_ORG_CATEGORY['management'], which also includes
// company_admin/technical_director/commercial_manager/consultant: the
// owner's section 7 rule names only Chairman/General Manager/Operations
// Manager, not the whole Management category, so those other roles keep
// their existing (unrestricted) access to this module set unchanged.
export const SECTION_7_VIEW_ONLY_COMPANY_ROLES: readonly CompanyRole[] = [
  'chairman',
  'general_manager',
  'operations_manager',
];

// Reference list of the owner's full 24-title organizational chart, grouped
// by the 6 categories it defines. NOT an enforced type -- this sprint
// enforces permissions at the ORG_CATEGORIES level only (see that type's own
// comment). Titles already backed by their own CompanyRole value are noted;
// the rest are documented here as a future extension point for per-title
// permission granularity, deliberately not built this sprint.
export const ORG_TITLES: Record<OrgCategory | 'external', readonly string[]> = {
  management: ['Chairman', 'General Manager', 'Operations Manager'],
  engineering_manager: ['Engineering Manager'],
  construction_team: ['Project Director', 'Project Manager', 'Construction Manager', 'Project Engineer'],
  engineering_team: [
    'Technical Manager', 'Architect', 'Structural Engineer', 'Mechanical Engineer',
    'Electrical Engineer', 'Draftsman', 'BIM Coordinator', 'BIM Modeler', 'Materials Engineer',
  ],
  qaqc_team: ['QAQC Manager', 'QAQC Engineer', 'QAQC Inspector'],
  document_control: ['Project Document Controller', 'Document Control Assistant'],
  view_only: [],
  external: ['Subcontractor (guest account)'],
};

export const PROJECT_ROLE_WEIGHT: Record<ProjectRole, number> = {
  project_lead: 100,
  site_engineer: 70,
  surveyor: 65,
  document_controller: 60,
  capture_operator: 40,
  viewer: 10,
  // Below viewer -- this number only matters for @Roles()-style minimum-
  // weight gates elsewhere; the actual restriction (RFI module only,
  // ownership-scoped writes) is enforced separately by
  // SubcontractorRfiAccessGuard, not by this number, same convention as
  // project_engineer's COMPANY_ROLE_WEIGHT entry above.
  subcontractor: 5,
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
  // Much narrower than manage_project_records: lets its holder attach
  // supporting files to an RFI they raised themselves, without the full
  // manage_project_records grant (edit/delete any RFI, drawing-update
  // marks, etc.). The 'subcontractor' project role (see PROJECT_ROLES)
  // holds this automatically on its own project -- no manual grant needed,
  // see ProjectAuthorizationService.hasProjectPermission(). Can still be
  // granted explicitly to anyone else the same way as any other permission.
  // SubcontractorRfiAccessGuard enforces the "their own RFI only"
  // ownership check this permission alone doesn't express.
  'raise_rfis',
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
  // Phase 4F onboarding -- optional and absent from the JWT payload itself
  // (not worth the token bloat/staleness): only ever set from a fresh DB
  // read (login/accept-invitation/self-signup), never derived from the
  // token on its own.
  onboardingCompleted?: boolean;
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
