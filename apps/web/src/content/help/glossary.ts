import type { HelpArticle } from './types';

// Each entry uses only slug/category/title/summary -- a glossary term has
// no steps, prerequisites, etc. Terms are the actual vocabulary used in
// this codebase (RFI_DISCIPLINE_LABELS, ProjectOrganizationSlot, etc.),
// not generic construction-industry definitions.
export const glossaryArticles: HelpArticle[] = [
  { slug: 'glossary-rfi', category: 'glossary', title: 'RFI', summary: 'Request for Information — a formal question raised against a project, routed to a recipient for a response, with its own review/approval workflow.', keywords: ['rfi', 'request for information'] },
  { slug: 'glossary-snag', category: 'glossary', title: 'Snag / Snagging', summary: 'A defect-tracking record with a two-step closure: marked "fixed" by whoever corrects it, then "verified" by someone with sign-off authority — distinct from a regular Issue, which closes in one step.', keywords: ['snag', 'snagging', 'defect'] },
  { slug: 'glossary-pinpoint', category: 'glossary', title: 'Pinpoint', summary: 'A marker placed at a specific location on a floor plan or 360° capture, used to link an issue or snag to exactly where it is on site.', keywords: ['pinpoint', 'pin'] },
  { slug: 'glossary-project-lead', category: 'glossary', title: 'Project Lead', summary: 'The project role with full permissions on that specific project by default, without needing an explicit grant for any individual permission.', keywords: ['project lead'] },
  { slug: 'glossary-organization-slot', category: 'glossary', title: 'Organization Slot', summary: 'Which party a project member represents on a specific project: Client, PMC, Lead Design Consultant (LDC), Main Contractor, or Subcontractor. Used for RFI routing and reporting.', keywords: ['organization slot', 'org slot'] },
  { slug: 'glossary-pmc', category: 'glossary', title: 'PMC', summary: 'Project Management Consultant — one of the five organization slots a project member can be assigned to.', keywords: ['pmc', 'project management consultant'] },
  { slug: 'glossary-ldc', category: 'glossary', title: 'LDC', summary: 'Lead Design Consultant — one of the five organization slots a project member can be assigned to.', keywords: ['ldc', 'lead design consultant'] },
  { slug: 'glossary-qa-qc', category: 'glossary', title: 'QA/QC', summary: 'Quality Assurance / Quality Control — tracked in this platform through QA Inspections, a separate record type from Issues and Snagging.', keywords: ['qa', 'qc', 'qa/qc', 'quality'] },
  { slug: 'glossary-bim', category: 'glossary', title: 'BIM', summary: 'Building Information Model — 3D models viewable under a project\'s BIM Models section.', keywords: ['bim', 'building information model'] },
  { slug: 'glossary-submittal', category: 'glossary', title: 'Submittal', summary: 'A formal document or sample submitted for review and approval against a specification section, tracked separately from RFIs and Transmittals.', keywords: ['submittal'] },
  { slug: 'glossary-transmittal', category: 'glossary', title: 'Transmittal', summary: 'A formal record of documents being sent from one party to another on a project, with its own status and purpose tracking.', keywords: ['transmittal'] },
  { slug: 'glossary-drawing-impact', category: 'glossary', title: 'Drawing/Model Impact', summary: 'A field on an RFI indicating whether its answer requires the drawing or model to be updated, and tracking whether that update has been applied and sent to site.', keywords: ['drawing impact', 'drawing update'] },
  { slug: 'glossary-risk-index', category: 'glossary', title: 'Project Risk Index', summary: 'A deterministic, AI-assisted score combining open issues, RFIs, snags, and their relationships into a single project-level risk measure, shown on the Risk page.', keywords: ['risk index', 'project risk'] },
  { slug: 'glossary-buildlens', category: 'glossary', title: 'BuildLens', summary: 'A photo-timeline feature for comparing captures of the same location over time.', keywords: ['buildlens', 'timeline'] },
  { slug: 'glossary-capture', category: 'glossary', title: 'Capture', summary: 'A photo, 360° panorama, or other reality-capture asset uploaded against a project location.', keywords: ['capture', 'reality capture', '360'] },
];
