import type { CompanyRole } from '@engineeringos/types';

// Phase 4E: a short, curated set of already-written article slugs per
// company role -- not a new filter over the whole library (most
// articles are open to "any project member" and curating by role would
// just reproduce the full list), but a hand-picked quick-start pointing
// at what that role's own, verified permissions actually let them do.
// Every slug here must exist in ALL_HELP_ARTICLES -- checked by
// Phase 4I's link-integrity pass, same as relatedSlugs.
export const ROLE_GUIDE_SLUGS: Record<CompanyRole, string[]> = {
  super_admin: [
    'creating-a-project', 'inviting-users', 'managing-user-roles',
    'understanding-organization-access', 'archiving-a-project', 'sharing-a-progress-report',
  ],
  company_admin: [
    'creating-a-project', 'inviting-users', 'understanding-organization-access',
    'archiving-a-project', 'sharing-a-progress-report',
  ],
  technical_director: [
    'reviewing-and-closing-an-issue', 'opening-reports', 'understanding-available-kpis',
    'inviting-users', 'understanding-rfi-closure',
  ],
  engineering_manager: [
    'reviewing-and-closing-an-issue', 'inviting-users', 'creating-an-rfi',
    'responding-to-an-rfi', 'opening-reports',
  ],
  bim_manager: [
    'inviting-users', 'understanding-documents', 'uploading-a-document', 'opening-reports',
  ],
  project_manager: [
    'inviting-users', 'creating-an-rfi', 'opening-reports',
    'understanding-the-project-dashboard', 'creating-a-transmittal',
  ],
  construction_manager: [
    'understanding-site-role-restrictions', 'creating-an-issue', 'creating-a-pinpoint',
    'opening-a-floor-plan', 'creating-a-snag',
  ],
  qa_qc_manager: [
    'understanding-qa-inspections', 'creating-a-qa-inspection', 'marking-a-snag-fixed',
    'verifying-a-snag',
  ],
  commercial_manager: [
    'opening-reports', 'exporting-reports', 'understanding-transmittals', 'creating-a-transmittal',
  ],
  consultant: [
    'creating-an-rfi', 'opening-reports', 'asking-platform-related-questions',
  ],
  client_representative: [
    'opening-reports', 'opening-the-progress-report', 'asking-platform-related-questions',
  ],
  project_engineer: [
    'understanding-site-role-restrictions', 'creating-an-issue', 'creating-a-pinpoint',
    'opening-a-floor-plan',
  ],
};
