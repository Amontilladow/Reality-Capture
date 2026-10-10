import type { HelpArticle } from './types';

// Verified directly against ProjectList.tsx, ProjectDashboard.tsx,
// CreateProjectModal.tsx, EditProjectModal.tsx, ProjectContextPanel.tsx,
// and projects.controller.ts/projects.service.ts. Two findings that
// don't match the intuitive assumption, confirmed by reading the
// controller/guard/service code directly rather than inferring from the
// UI alone:
// 1. There is no dedicated "Dashboard" page -- ProjectList ("Projects")
//    is the de-facto company-wide landing page.
// 2. Editing an existing project's details (including setting it to
//    "archived" -- there is no separate archive/delete endpoint) has no
//    role or project-permission gate at all: PATCH /projects/:id carries
//    neither a @Roles nor a @RequireProjectPermission decorator, and the
//    global guards (RolesGuard, ProjectPermissionGuard) both pass
//    through routes without their metadata. Any authenticated user in
//    the same company can edit any project. Documented exactly as
//    found, not smoothed over.
export const dashboardProjectsArticles: HelpArticle[] = [
  {
    slug: 'understanding-the-projects-page',
    category: 'dashboard-projects',
    title: 'Understanding the Projects Page',
    summary: 'The company-wide landing page listing every project.',
    whatItDoes: 'Opening the app takes you to "Projects" -- a company-wide list, not scoped to a single project. It shows four summary tiles (total projects, active projects, open issues, and captures across all of them), a card for each project, and your subscription usage.',
    whoCanUse: 'Any signed-in user. Every non-archived project in your company appears here for every user -- there is no "only my projects" filter, and viewing a project\'s own records once opened is not restricted by membership either. Formal project membership instead controls who can be assigned a project role, organization slot, or narrower permission grant -- see "Understanding Project Access."',
    steps: ['Sign in, or select "Projects" in the sidebar from anywhere in the app.'],
    relatedSlugs: ['creating-a-project', 'switching-between-projects', 'understanding-the-project-dashboard', 'understanding-project-access'],
    keywords: ['dashboard', 'projects page', 'home'],
  },
  {
    slug: 'understanding-the-project-dashboard',
    category: 'dashboard-projects',
    title: 'Understanding the Project Dashboard',
    summary: 'The overview shown when you open a specific project.',
    whatItDoes: 'Opening a project shows its own dashboard: issue counts (open, critical, overdue, and closed this week), BIM model processing status (ready/processing/pending/failed), and a recent-activity feed from that project\'s audit log.',
    whoCanUse: 'Any member of that project.',
    steps: ['Open a project from the Projects page.'],
    relatedSlugs: ['understanding-the-projects-page'],
    keywords: ['project dashboard', 'project overview'],
  },
  {
    slug: 'creating-a-project',
    category: 'dashboard-projects',
    title: 'Creating a Project',
    summary: 'Starting a new project for your company.',
    whenToUse: 'When your company is beginning a new project that needs its own issues, RFIs, drawings, and team.',
    whoCanUse: 'Company Admin or Super Admin only.',
    requiredPermissions: 'Company role Company Admin or Super Admin.',
    prerequisites: ['Your company\'s subscription must still have room under its project limit.'],
    infoToEnter: ['Name (required)', 'Project code (optional)', 'City (optional)', 'Description (optional)'],
    steps: [
      'On the Projects page, select "New project."',
      'Enter a name, and optionally a code, city, and description.',
      'Select "Create."',
    ],
    afterSubmission: 'The project is created and appears immediately on the Projects page; you\'re taken to its dashboard.',
    commonMistakes: ['Trying to create a project while not a Company Admin or Super Admin -- the option won\'t be available.'],
    troubleshootingSteps: [
      { problem: 'Creation fails with a subscription/limit error', likelyCause: 'Your company has reached its subscription\'s project limit.', fix: 'Contact whoever manages your company\'s subscription to increase the limit, or archive a project that\'s no longer active.' },
    ],
    relatedSlugs: ['understanding-the-projects-page', 'editing-project-details'],
    keywords: ['create project', 'new project'],
    roles: { companyRoles: ['super_admin', 'company_admin'] },
  },
  {
    slug: 'switching-between-projects',
    category: 'dashboard-projects',
    title: 'Switching Between Projects',
    summary: 'Moving to a different project without returning to the Projects page.',
    whatItDoes: 'While inside a project, the sidebar\'s project panel includes a dropdown listing every company project (the same list the Projects page shows) -- selecting one navigates straight there. It also shows your own role and organization badge for the current project.',
    whoCanUse: 'Any signed-in user.',
    steps: ['Open the project switcher in the sidebar and select a different project.'],
    relatedSlugs: ['understanding-the-projects-page'],
    keywords: ['switch project', 'change project'],
  },
  {
    slug: 'editing-project-details',
    category: 'dashboard-projects',
    title: 'Editing Project Details',
    summary: 'Changing a project\'s name, dates, status, or stakeholder information.',
    whatItDoes: 'Edits the project\'s name, code, status (Active/On Hold/Completed/Archived), phase, description, location, start/end dates, free-text stakeholder fields (client, lead designer, consultant, technical advisor, PMC, main contractor, subcontractor -- used to populate RFI documents), and branding images.',
    whoCanUse: 'Any signed-in member of your company. This is not restricted to a specific role or project permission.',
    infoToEnter: ['Any of: name, code, status, phase, description, location/city/country, start date, expected end date, stakeholder text fields, logo/stamp images.'],
    steps: ['Open the project and select "Edit."', 'Change the fields you need.', 'Select "Save."'],
    afterSubmission: 'The project\'s details update immediately for everyone who can see it.',
    commonMistakes: ['Confusing the free-text stakeholder fields here (used on RFI documents) with the separate, structured organization slots -- see "Understanding Organization Slots."'],
    relatedSlugs: ['understanding-organization-slots', 'archiving-a-project'],
    keywords: ['edit project', 'project settings'],
  },
  {
    slug: 'archiving-a-project',
    category: 'dashboard-projects',
    title: 'Archiving a Project',
    summary: 'Setting a project\'s status to Archived.',
    whatItDoes: 'There is no separate "archive" action or "delete project" feature -- archiving is simply setting the project\'s status to "Archived" through the same Edit form used for any other detail. An archived project no longer appears in the Projects list.',
    whoCanUse: 'Any signed-in member of your company, the same as any other project edit.',
    steps: ['Open the project, select "Edit," change Status to "Archived," and save.'],
    commonMistakes: ['Expecting a confirmation step or a separate "Archive" button -- it is the ordinary status field.'],
    relatedSlugs: ['editing-project-details'],
    keywords: ['archive project', 'delete project'],
  },
  {
    slug: 'understanding-organization-slots',
    category: 'dashboard-projects',
    title: 'Understanding Organization Slots',
    summary: 'Assigning Client/PMC/LDC/Main Contractor/Subcontractor roles on a project -- separate from project creation.',
    whatItDoes: 'Organization slots (Client, PMC, LDC, Main Contractor, Subcontractor) are a structured, separate layer from the project\'s free-text stakeholder fields: each slot can be configured with an organization name/logo, and existing project members can be assigned into a slot. This drives organization-based permissions elsewhere in the app, not just display text.',
    whenToUse: 'After a project is created and its team is being set up, to formally assign which company fills each organizational role.',
    whoCanUse: 'Viewing a project\'s organization slots is open to any project member.',
    requiredPermissions: 'Configuring a slot or assigning a member to it requires the "manage_team" project permission, or being the project\'s Project Lead.',
    steps: [
      'Open the project\'s "Team & Permissions" page.',
      'Select an organization slot and set its name/logo, or assign an existing project member to it.',
    ],
    relatedSlugs: ['editing-project-details', 'understanding-project-access'],
    keywords: ['organization slot', 'client', 'pmc', 'ldc', 'main contractor', 'subcontractor'],
  },
];
