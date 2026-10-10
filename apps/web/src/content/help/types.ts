import type { CompanyRole, ProjectRole } from '@engineeringos/types';

// Phase 4: Help Centre content model. Deliberately static, versioned
// TypeScript data (reviewed through the normal PR process) rather than a
// new database table + admin-authoring API -- see docs/phase4-help-centre.md
// Phase 4I's "Administrative capabilities" section for why, and what the
// recommended next phase looks like if non-engineers need to self-edit
// content later. This keeps the brief's own fallback ("implement the
// user-facing Help Centre first... document the recommended
// administration phase separately") exactly as written, and avoids a
// second, parallel authentication/authorization surface for article
// editing that the brief explicitly warns against.
//
// Every field below is optional except the five that make an entry
// findable and openable (slug/category/title/summary/kind) -- per the
// brief's own rule ("where a field... is not supported by the actual
// implementation, omit it"), an article for a feature with no
// attachments, no notification, or no review step just leaves those
// fields out; ArticleView renders only what is present.

export const HELP_CATEGORIES = [
  'getting-started',
  'dashboard-projects',
  'floor-plans-pinpoints',
  'issues-snagging',
  'rfi',
  'drawings-documents',
  'reports-progress',
  'notifications-email',
  'ai-assistant',
  'user-management',
  'faq',
  'troubleshooting',
  'glossary',
] as const;

export type HelpCategoryKey = typeof HELP_CATEGORIES[number];

export const HELP_CATEGORY_LABELS: Record<HelpCategoryKey, string> = {
  'getting-started': 'Getting Started',
  'dashboard-projects': 'Dashboard & Projects',
  'floor-plans-pinpoints': 'Floor Plans & Pinpoints',
  'issues-snagging': 'Issues & Snagging',
  rfi: 'RFI',
  'drawings-documents': 'Drawings & Documents',
  'reports-progress': 'Reports & Progress',
  'notifications-email': 'Notifications & Email',
  'ai-assistant': 'AI Assistant',
  'user-management': 'User Management & Security',
  faq: 'FAQ',
  troubleshooting: 'Troubleshooting',
  glossary: 'Glossary',
};

// Which roles a guide is written for. Omitted entirely = relevant to
// everyone regardless of role (most "how do I use this feature"
// articles). Only role-specific guides (Phase 4E) set this -- it never
// hides a feature a role genuinely can't use, it only lets the Help
// Centre's "For your role" view surface the subset most relevant to a
// given role without duplicating content per role.
export interface HelpArticleRoles {
  companyRoles?: CompanyRole[];
  projectRoles?: ProjectRole[];
}

export interface TroubleshootingStep {
  problem: string;
  likelyCause?: string;
  fix: string;
}

export interface HelpArticle {
  slug: string;
  category: HelpCategoryKey;
  title: string;
  // Short description shown in search results and category listings.
  summary: string;

  // ── Full article structure (brief's 16-field template) ──────────────
  // All optional: a short FAQ/glossary/troubleshooting entry uses only
  // title/summary/category (+ troubleshootingSteps for K-category
  // entries); a full feature walkthrough uses most or all of the rest.
  whatItDoes?: string;
  whenToUse?: string;
  whoCanUse?: string;
  requiredPermissions?: string;
  prerequisites?: string[];
  steps?: string[];
  infoToEnter?: string[];
  attachments?: string;
  afterSubmission?: string;
  whoIsNotified?: string;
  reviewEditApproveClose?: string;
  howToTrackProgress?: string;
  commonMistakes?: string[];
  troubleshootingSteps?: TroubleshootingStep[];
  relatedSlugs?: string[];

  // Search + role-relevance metadata.
  keywords?: string[];
  roles?: HelpArticleRoles;

  // Explicitly marks a described capability that does not exist yet --
  // rendered as a visible "Not Yet Available" notice rather than silently
  // included as if operational (brief: "label it clearly... or keep it
  // out of the published Help Centre"). Used sparingly, only where the
  // brief's own suggested article list names something this audit
  // confirmed is not implemented (e.g. notification preferences).
  notYetAvailable?: boolean;
}
