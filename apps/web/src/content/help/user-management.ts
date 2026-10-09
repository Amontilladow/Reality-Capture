import type { HelpArticle } from './types';

// Verified against users.controller.ts/users.service.ts (company-level)
// and projects.controller.ts (project-level) directly -- these are two
// separate permission layers inside one UI component (ManageMembersModal),
// and it's easy to conflate them. Company-level user management
// (inviting, approving/changing a company role, deactivating, resetting
// a password) is gated by company ROLE (@Roles()); project-level team
// management (adding someone to a project, setting their project role or
// organization slot, granting a narrower permission) is gated by the
// "manage_team" project PERMISSION instead.
export const userManagementArticles: HelpArticle[] = [
  {
    slug: 'understanding-user-permissions',
    category: 'user-management',
    title: 'Understanding User Permissions',
    summary: 'Two separate layers: company role, and project-level permissions.',
    whatItDoes: 'Your company role (set once, company-wide) decides company-level authority like inviting users. Separately, on each project, your project role and any permission grants decide what you can do on that specific project -- see "Understanding Your Role" in Getting Started for the full picture.',
    relatedSlugs: ['understanding-your-role', 'understanding-organization-access', 'understanding-project-access'],
    keywords: ['user permissions'],
  },
  {
    slug: 'understanding-organization-access',
    category: 'user-management',
    title: 'Understanding Organization Access',
    summary: 'Company-wide user management: inviting, approving roles, deactivating.',
    whatItDoes: 'Inviting a new user requires a company role at or above Project Manager\'s seniority -- in practice: Super Admin, Company Admin, Technical Director, Engineering Manager, BIM Manager, or Project Manager. Changing an existing user\'s company role, or deactivating their account, requires Super Admin specifically -- no other role, however senior, can do either.',
    requiredPermissions: 'Invite: Super Admin, Company Admin, Technical Director, Engineering Manager, BIM Manager, or Project Manager. Change role / deactivate: Super Admin only.',
    relatedSlugs: ['inviting-users', 'managing-user-roles'],
    keywords: ['organization access', 'company admin'],
  },
  {
    slug: 'understanding-project-access',
    category: 'user-management',
    title: 'Understanding Project Access',
    summary: 'Viewing a project\'s records is open company-wide; changing its team is not.',
    whatItDoes: 'Any signed-in user in your company can open any of your company\'s non-archived projects and view its issues, RFIs, snagging, drawings, and documents -- there is no membership restriction on reading a project\'s own records. What differs by membership is formal standing on that project: adding someone as a project member, changing their project role, assigning their organization slot, or granting a narrower permission (like approve_rfis or verify_snag_items) all require the "manage_team" permission on that project (or being its Project Lead).',
    requiredPermissions: 'Viewing: any company user. Adding/changing a project member or their role: "manage_team" project permission, or Project Lead.',
    relatedSlugs: ['inviting-users', 'understanding-user-permissions'],
    keywords: ['project access', 'project members'],
  },
  {
    slug: 'inviting-users',
    category: 'user-management',
    title: 'Inviting Users',
    summary: 'Bringing a new person into your company account.',
    requiredPermissions: 'Super Admin, Company Admin, Technical Director, Engineering Manager, BIM Manager, or Project Manager.',
    steps: [
      'Open "Team & Permissions" from a project (or the company-wide user list) and select "Invite."',
      'Enter the person\'s email address.',
      'Share the generated invitation link with them -- email delivery is not wired up, so you hand it to them directly.',
    ],
    afterSubmission: 'They create their account via the invitation link; a self-registered account additionally needs its requested role approved (see "Managing User Roles").',
    relatedSlugs: ['understanding-organization-access', 'managing-user-roles'],
    keywords: ['invite user', 'add user'],
  },
  {
    slug: 'managing-user-roles',
    category: 'user-management',
    title: 'Managing User Roles',
    summary: 'Approving or changing a user\'s company role.',
    requiredPermissions: 'Super Admin only.',
    whatItDoes: 'Sets or changes a user\'s company role. For a self-registered user awaiting approval, setting their role also clears the "pending approval" state, letting them into the app.',
    steps: ['Open the company\'s user list and select a role for the user.'],
    relatedSlugs: ['understanding-organization-access'],
    keywords: ['user role', 'approve role'],
  },
  {
    slug: 'reporting-unauthorized-access',
    category: 'user-management',
    title: 'Reporting Unauthorized Access',
    summary: 'There is no in-app report-abuse flow -- raise it directly with your company admin.',
    whatItDoes: 'If you believe someone has access they shouldn\'t, there is no dedicated in-app reporting form -- contact your company\'s Super Admin or Company Admin directly so they can review and adjust access.',
    notYetAvailable: true,
    keywords: ['unauthorized access', 'security concern'],
  },
  {
    slug: 'account-security-best-practices',
    category: 'user-management',
    title: 'Account Security Best Practices',
    summary: 'Basic precautions every user should take.',
    whatItDoes: 'Use a password you don\'t reuse elsewhere, and report a suspected compromised account to your company admin immediately -- they can deactivate the account and generate a reset link.',
    relatedSlugs: ['resetting-your-password'],
    keywords: ['security', 'account safety'],
  },
];
