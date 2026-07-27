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
] as const;

export type CompanyRole = typeof COMPANY_ROLES[number];

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
};

export const PROJECT_ROLE_WEIGHT: Record<ProjectRole, number> = {
  project_lead: 100,
  site_engineer: 70,
  surveyor: 65,
  document_controller: 60,
  capture_operator: 40,
  viewer: 10,
};

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
