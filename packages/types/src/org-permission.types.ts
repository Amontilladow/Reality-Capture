import type { OrgCategory } from './user.types';

// Declarative module x category permission matrix implementing the owner's
// RBAC sprint spec (sections 1-6 of their permission matrix). Checked by
// OrgCategoryPermissionService (apps/api/src/common/authorization/
// org-category-permission.service.ts) -- this file is pure data/types, kept
// in the shared package so both API and web can read it without duplicating
// the table.
//
// Section 7 (Risk Register/Reports/Snagging-reads/BuildLens/BuildLens
// Captures/AI Assistant) is NOT part of this matrix -- it isn't a C/V/E/A/X
// grant table, it's a single narrower restriction (3 specific company-wide
// titles get view-only, everyone else keeps today's existing, unchanged
// access) -- see SECTION_7_VIEW_ONLY_COMPANY_ROLES in user.types.ts instead.
//
// Subcontractor/"External" is also NOT a column here -- it's project-scoped,
// not company-wide (see OrgCategory's own header comment), and every module
// that grants it anything also requires an ownership check (their own
// company's/their own created records only) that a flat category table can't
// express. OrgCategoryPermissionService checks it as a separate path.
export const ORG_MODULES = [
  'rfis',
  'drawings',
  // Issues + Snagging share one line in the owner's matrix ("Issues/Snags")
  // -- both apps/api/src/modules/issues and apps/api/src/modules/snagging
  // are checked against this one module key.
  'issues_snags',
  'bim',
  // "QAQC Checklists / Inspections" -- confirmed with the owner to cover
  // both apps/api/src/modules/qa (qa_inspections, literally "inspections")
  // and apps/api/src/modules/qaqc (NCR/SOR/WIR/MIR records), since both are
  // QAQC-domain record types distinct from the issues_snags module above.
  'qaqc_checklists',
  // Submittals + Transmittals share the owner's "Document Approvals" line.
  'document_approvals',
] as const;

export type OrgModule = typeof ORG_MODULES[number];

export const ORG_ACTIONS = ['create', 'view', 'edit', 'approve', 'close'] as const;
export type OrgAction = typeof ORG_ACTIONS[number];

type ModuleCategoryMatrix = Record<OrgModule, Record<OrgCategory, readonly OrgAction[]>>;

// Transcribed directly from the owner's permission matrix (sections 1-6).
// Two deliberate, explicitly-flagged inferences beyond a literal transcript:
//
//  1. RFIs: the summary table doesn't list an 'approve'/'close' action for
//     Document Control, but the owner's own worked lifecycle example in the
//     same message ("Document Control logs and routes... Document Control
//     closes (X)") explicitly assigns RFI-closing to Document Control. The
//     narrative is more specific than the summary table, so 'close' is
//     included here for document_control on rfis; flagged for the owner to
//     correct if the table was in fact authoritative.
//  2. Document Approvals: Management's row reads only "A -- final sign-off
//     where required" with no explicit 'view'. Approving something you
//     cannot view isn't meaningful, so 'view' is included alongside
//     'approve' for management on document_approvals.
//
// engineering_manager holds every action on every module (the owner's
// explicit, named exception) -- OrgCategoryPermissionService actually
// bypasses the matrix lookup entirely for this category (so a future edit
// to this table can never accidentally narrow Engineering Manager's access),
// but the full row is still spelled out here so the table reads correctly
// as documentation on its own.
export const CATEGORY_PERMISSION_MATRIX: ModuleCategoryMatrix = {
  rfis: {
    management: ['view'],
    engineering_manager: ['create', 'view', 'edit', 'approve', 'close'],
    construction_team: ['create', 'view', 'edit'],
    engineering_team: ['view', 'approve'],
    qaqc_team: ['view'],
    document_control: ['create', 'view', 'close'],
    view_only: ['view'],
  },
  drawings: {
    management: ['view'],
    engineering_manager: ['create', 'view', 'edit', 'approve', 'close'],
    // Owner's conflict resolution: the new matrix wins over the pre-existing
    // SiteRoleRestrictionGuard full-access allowlist for construction_manager/
    // project_engineer company roles -- those two are narrowed to view-only
    // here. site_engineer (a ProjectRole, a separate axis) keeps its
    // existing Drawings access unchanged -- see drawings.controller.ts.
    construction_team: ['view'],
    engineering_team: ['create', 'view', 'edit', 'approve'],
    qaqc_team: ['view'],
    document_control: ['create', 'view', 'close'],
    view_only: ['view'],
  },
  issues_snags: {
    management: ['view'],
    engineering_manager: ['create', 'view', 'edit', 'approve', 'close'],
    construction_team: ['create', 'view', 'edit'],
    engineering_team: ['view', 'edit'],
    qaqc_team: ['create', 'view', 'edit', 'approve', 'close'],
    document_control: ['view'],
    view_only: ['view'],
  },
  bim: {
    management: ['view'],
    engineering_manager: ['create', 'view', 'edit', 'approve', 'close'],
    construction_team: ['view'],
    engineering_team: ['create', 'view', 'edit', 'approve'],
    qaqc_team: ['view'],
    document_control: ['create', 'view', 'close'],
    view_only: ['view'],
  },
  qaqc_checklists: {
    management: ['view'],
    engineering_manager: ['create', 'view', 'edit', 'approve', 'close'],
    // "only on close-out items assigned to them" is an item-level ownership
    // condition this flat category table can't express -- enforced as an
    // additional assigned-to check in qa.service.ts/qaqc.service.ts on top
    // of this category grant, not here.
    construction_team: ['view', 'edit'],
    engineering_team: ['view'],
    qaqc_team: ['create', 'view', 'edit', 'approve', 'close'],
    document_control: ['view'],
    view_only: ['view'],
  },
  document_approvals: {
    management: ['view', 'approve'],
    engineering_manager: ['create', 'view', 'edit', 'approve', 'close'],
    construction_team: ['create', 'view'],
    engineering_team: ['view', 'approve'],
    qaqc_team: ['view'],
    document_control: ['create', 'view', 'edit', 'close'],
    view_only: ['view'],
  },
};

export function categoryCan(category: OrgCategory, module: OrgModule, action: OrgAction): boolean {
  return CATEGORY_PERMISSION_MATRIX[module][category].includes(action);
}
