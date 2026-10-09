import type { HelpArticle } from './types';

// FAQ entries use title as the question and summary as the answer --
// kept short and direct, no steps/permissions sections (those belong in
// the full feature articles these link to via relatedSlugs).
export const faqArticles: HelpArticle[] = [
  {
    slug: 'faq-which-projects-can-i-see',
    category: 'faq',
    title: 'Why can\'t I see a project I expect to see?',
    summary: 'You only see projects you\'ve been added to as a member. Ask that project\'s Project Lead or your company admin to add you.',
    relatedSlugs: ['selecting-a-project'],
    keywords: ['missing project', 'project not visible'],
  },
  {
    slug: 'faq-difference-issue-snag',
    category: 'faq',
    title: 'What\'s the difference between an Issue and a Snag?',
    summary: 'Both track problems found on site, but a Snag closes in two steps (fixed, then verified by someone with sign-off authority) while an Issue closes in one. Use Snagging for defect walk-downs that need independent sign-off; use Issues for everything else.',
    relatedSlugs: ['glossary-snag'],
    keywords: ['issue vs snag', 'snagging'],
  },
  {
    slug: 'faq-why-cant-i-create-something',
    category: 'faq',
    title: 'Why can\'t I create or edit a record?',
    summary: 'Most create/edit actions on RFIs, Submittals, Transmittals, QA Inspections, Documents, Captures, Floor Plans, and BIM Models require the "manage_project_records" permission (or being that project\'s Project Lead). Issues can be created by any project member. If you believe you should have access, ask your project\'s Project Lead or your company admin.',
    relatedSlugs: ['understanding-your-role'],
    keywords: ['permission denied', 'cannot create', 'access denied'],
  },
  {
    slug: 'faq-what-is-ai-assistant',
    category: 'faq',
    title: 'What can the AI Assistant actually do?',
    summary: 'It answers questions about your project\'s RFIs, issues, snagging, risk, progress, and documents, and can draft (not submit) an RFI, issue, or snag item for you to review. It has a daily usage limit shown at the top of the Assistant page.',
    relatedSlugs: ['understanding-supported-ai-capabilities'],
    keywords: ['ai assistant', 'chatbot'],
  },
  {
    slug: 'faq-email-integration',
    category: 'faq',
    title: 'Can I send email from EngineeringOS?',
    summary: 'Yes — connect your own Outlook or Gmail account under "Email Integration" in the sidebar, then use the "Email" button on a project, RFI, Issue, Submittal, or Snag page to compose and send from your own address.',
    relatedSlugs: ['connecting-outlook', 'connecting-gmail'],
    keywords: ['email', 'outlook', 'gmail'],
  },
];
