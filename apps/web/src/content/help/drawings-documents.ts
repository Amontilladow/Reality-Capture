import type { HelpArticle } from './types';

// Covers the brief's "Drawings and Documents" category plus Transmittals
// and QA Inspections -- three separate, real modules (verified against
// documents.controller.ts, transmittals.controller.ts, qa.controller.ts)
// that don't fit neatly under any other category name in the brief's own
// list. Floor-plan-specific drawing navigation (opening a plan, zooming,
// pins) lives in the Floor Plans & Pinpoints category instead -- this one
// covers the underlying files and the separate Documents/Transmittals/QA
// record types.
export const drawingsDocumentsArticles: HelpArticle[] = [
  {
    slug: 'understanding-documents',
    category: 'drawings-documents',
    title: 'Understanding Documents',
    summary: 'A general-purpose library of project files and external links, separate from floor plans, RFI attachments, or capture photos.',
    whatItDoes: 'Documents is its own module for project paperwork: drawings, specifications, method statements, risk assessments, test reports, and more, each with a type, an optional document number and revision, and either an uploaded file or a link to somewhere external.',
    whoCanUse: 'Any project member can view the list. Uploading, linking, and attaching requires "manage_project_records" (or being Project Lead).',
    relatedSlugs: ['uploading-a-document', 'understanding-document-revisions'],
    keywords: ['documents', 'document library'],
  },
  {
    slug: 'uploading-a-document',
    category: 'drawings-documents',
    title: 'Uploading Documents',
    summary: 'Adding a file, or a link to one, to the Documents library.',
    requiredPermissions: '"manage_project_records" permission, or being that project\'s Project Lead.',
    infoToEnter: ['Title', 'Document type', 'Document number (optional)', 'Revision (optional)', 'Either a file to upload, or an external URL'],
    steps: [
      'Open the project\'s Documents page and select "+ Add document."',
      'Choose "Upload a file" or "Link an external document."',
      'Fill in the title, type, and optional number/revision.',
      'Select "Add."',
    ],
    afterSubmission: 'The document appears in the list. An uploaded file can be opened directly; a linked document opens the external URL in a new tab.',
    commonMistakes: ['Direct integration with external systems like Procore, Aconex, SharePoint, or BIM 360 is not implemented -- an "external" document here is always a manually entered link, not a live sync.'],
    relatedSlugs: ['understanding-documents'],
    keywords: ['upload document'],
  },
  {
    slug: 'understanding-document-revisions',
    category: 'drawings-documents',
    title: 'Understanding Revision Information',
    summary: 'The revision field is a free-text label, not an automatic version history.',
    whatItDoes: 'Each document has an optional "revision" text field (e.g. "Rev C") you set yourself when uploading. Uploading a newer version does not automatically supersede an older one -- both exist as separate entries unless you remove the old one.',
    notYetAvailable: true,
    relatedSlugs: ['uploading-a-document'],
    keywords: ['document revision', 'version'],
  },
  {
    slug: 'understanding-document-permissions',
    category: 'drawings-documents',
    title: 'Understanding Document Permissions',
    summary: 'Who can view versus add documents.',
    requiredPermissions: 'Viewing: open to any project member. Adding, linking to another record, or removing: "manage_project_records" (or Project Lead).',
    keywords: ['document permissions'],
  },
  {
    slug: 'troubleshooting-document-uploads',
    category: 'drawings-documents',
    title: 'Troubleshooting Uploads and Downloads',
    summary: 'A document upload or download isn\'t working.',
    troubleshootingSteps: [
      { problem: 'Upload fails', likelyCause: 'Unstable connection, or you lack "manage_project_records."', fix: 'Retry on a stable connection; confirm your permission with your project\'s admin if it still fails.' },
      { problem: 'Opening a document does nothing or errors', likelyCause: 'A download link has expired.', fix: 'Reload the page for a fresh link.' },
    ],
    keywords: ['document upload failed', 'document download'],
  },

  // ── Transmittals ─────────────────────────────────────────────────────────
  {
    slug: 'understanding-transmittals',
    category: 'drawings-documents',
    title: 'Understanding Transmittals',
    summary: 'A formal record of documents sent from one party to another.',
    whatItDoes: 'A Transmittal records that a set of items was sent to a named recipient, for a stated purpose (review, approval, record, construction, or as requested), with a status and optional due date.',
    whoCanUse: 'Any project member can create one. Editing or deleting requires "manage_project_records" (or Project Lead).',
    relatedSlugs: ['creating-a-transmittal'],
    keywords: ['transmittal'],
  },
  {
    slug: 'creating-a-transmittal',
    category: 'drawings-documents',
    title: 'Creating a Transmittal',
    summary: 'Recording a new transmittal.',
    whoCanUse: 'Any project member.',
    infoToEnter: ['Subject', 'Recipient name', 'Recipient company (optional)', 'Purpose (for review / for approval / for record / for construction / as requested)', 'Items (free text listing what was sent)', 'Notes (optional)', 'Due date (optional)'],
    steps: ['Open the project\'s Transmittals page, select "+ New transmittal," fill in the fields, and select "Create."'],
    relatedSlugs: ['understanding-transmittals'],
    keywords: ['create transmittal'],
  },

  // ── QA Inspections ───────────────────────────────────────────────────────
  {
    slug: 'understanding-qa-inspections',
    category: 'drawings-documents',
    title: 'Understanding QA Inspections',
    summary: 'A dedicated record type for quality assurance/control inspections, separate from Issues and Snagging.',
    whatItDoes: 'A QA Inspection records a quality check: a title, an inspection type, a location, a checklist (free text), an assignee, and an inspection date.',
    whoCanUse: 'Any project member can create one. Editing or deleting requires "manage_project_records" (or Project Lead).',
    relatedSlugs: ['creating-a-qa-inspection'],
    keywords: ['qa', 'qc', 'quality inspection'],
  },
  {
    slug: 'creating-a-qa-inspection',
    category: 'drawings-documents',
    title: 'Creating a QA Inspection',
    summary: 'Recording a new QA/QC inspection.',
    whoCanUse: 'Any project member.',
    infoToEnter: ['Title', 'Inspection type (optional)', 'Location (optional)', 'Checklist (free text)', 'Assignee (optional)', 'Inspection date (optional)'],
    steps: ['Open the project\'s QA Inspections page, select "+ New inspection," fill in the fields, and select "Create."'],
    relatedSlugs: ['understanding-qa-inspections'],
    keywords: ['create qa inspection'],
  },
];
