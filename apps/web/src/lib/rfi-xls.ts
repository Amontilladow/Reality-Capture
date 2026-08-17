import ExcelJS from 'exceljs';
import type { Rfi, Project, RfiImpactLevel } from '@engineeringos/types';
import {
  RFI_DISCIPLINE_LABELS, RFI_DOCUMENT_TYPE_LABELS, RFI_IMPACT_LEVEL_LABELS,
  PROJECT_ORGANIZATION_SLOTS, PROJECT_ORGANIZATION_SLOT_LABELS,
  type RfiDocumentType, type ProjectOrganizationSlot,
} from '@engineeringos/types';
import { RFI_STATUS_LABELS, RFI_PRIORITY_LABELS, formatDate } from './rfi-constants';

// question/answer are stored as HTML from the RichTextEditor (Phase 3) --
// converts Tiptap's StarterKit output (paragraphs, headings, lists,
// bold/italic marks) to plain text with real line breaks for a static
// spreadsheet cell, rather than leaking raw tags like "<p>...</p>". Mirrors
// rfi-pdf.template.ts's richTextToPlain() exactly, duplicated rather than
// shared since one lives in apps/api and the other in apps/web.
function richTextToPlain(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Phase 5 additions -- organizations, upload stamps, and query/response
// attachment lists, threaded in as optional parameters so every existing
// caller (and every existing test) keeps working unchanged.
export interface RfiXlsOrganization {
  slot: ProjectOrganizationSlot;
  name?: string;
  orgRef?: string;
  logoUrl?: string;
}

export interface RfiXlsUploadStamp {
  uploadedBy?: string;
  dateTime?: string;
  stamp: string;
}

export interface RfiXlsAttachmentItem {
  filename: string;
  documentType?: RfiDocumentType;
  documentTypeOther?: string;
}

export interface RfiXlsComment {
  userName?: string;
  organizationSlot?: string;
  body: string;
  createdAt: string;
}

export interface RfiXlsAuditEvent {
  action: string;
  userName?: string;
  occurredAt: string;
}

// Mirrors rfi-pdf.template.ts's palette exactly -- both apps/web/tailwind
// config.js's real "blueprint-dark technical" tokens, not generic slate/blue
// -- so the two exports read as the same document family, and that family
// reads as the same product as the live app, not an unrelated template.
const INK = 'FF0A141C';          // base-950
const MUTED = 'FF4A6178';        // base-500
const BORDER = 'FFB9C6CE';       // lighter tint of base-500, print-legible
const SECTION_FILL = 'FFEAF0F4'; // ink-100, reused as a light section tint
const ACCENT = 'FFE56A1F';       // signal, darkened for contrast on white
const BLUEPRINT = 'FF1E6E93';    // blueprint, darkened for contrast on white
const FONT = 'IBM Plex Sans';    // matches index.html's Google Fonts load --
// Excel has no font-embedding concept (unlike the PDF, which does embed
// this via @fontsource); if a viewer's system doesn't have it installed,
// Excel silently substitutes its own default, same as any other font name
// specified in a spreadsheet. Correct either way, no crash risk.

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const gridBorder = { top: thin, bottom: thin, left: thin, right: thin };

function sectionRow(sheet: ExcelJS.Worksheet, title: string) {
  const row = sheet.addRow([title, '']);
  sheet.mergeCells(row.number, 1, row.number, 2);
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
    cell.font = { bold: true, size: 9, color: { argb: BLUEPRINT }, name: FONT };
    cell.alignment = { vertical: 'middle' };
    cell.border = gridBorder;
  });
  return row;
}

function fieldRow(sheet: ExcelJS.Worksheet, label: string, value: string) {
  const row = sheet.addRow([label, value]);
  row.height = 18;
  const [labelCell, valueCell] = [row.getCell(1), row.getCell(2)];
  labelCell.font = { bold: true, size: 9.5, color: { argb: MUTED }, name: FONT };
  valueCell.font = { size: 10, color: { argb: INK }, name: FONT };
  labelCell.alignment = { vertical: 'middle' };
  valueCell.alignment = { vertical: 'middle', wrapText: true };
  labelCell.border = gridBorder;
  valueCell.border = gridBorder;
  return row;
}

// A merged full-width block for long free text (RFI title, query, response) --
// same "one big cell" treatment the PDF gives these sections.
function textBlockRow(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text, '']);
  sheet.mergeCells(row.number, 1, row.number, 2);
  const lines = Math.max(1, Math.ceil(text.length / 95));
  row.height = Math.max(20, lines * 14);
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { size: 10, color: { argb: INK }, name: FONT };
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = gridBorder;
  });
  return row;
}

function spacerRow(sheet: ExcelJS.Worksheet) {
  const row = sheet.addRow(['', '']);
  row.height = 6;
  return row;
}

type ImageFetchResult =
  | { status: 'absent' }
  | { status: 'ok'; buffer: ArrayBuffer; extension: 'png' | 'jpeg' }
  | { status: 'failed' };

async function tryFetchImage(url?: string): Promise<ImageFetchResult> {
  if (!url) return { status: 'absent' };
  try {
    const res = await fetch(url);
    if (!res.ok) return { status: 'failed' };
    const contentType = res.headers.get('content-type') ?? '';
    const extension = contentType.includes('png') ? 'png' : 'jpeg';
    return { status: 'ok', buffer: await res.arrayBuffer(), extension };
  } catch {
    // A CORS hiccup or network blip shouldn't take down the whole export --
    // the caller decides whether/how to surface this as a warning.
    return { status: 'failed' };
  }
}

export interface RfiWorkbookResult {
  buffer: ExcelJS.Buffer;
  warnings: string[];
}

function attachmentLabel(item: RfiXlsAttachmentItem): string {
  const typeLabel = item.documentType ? RFI_DOCUMENT_TYPE_LABELS[item.documentType] : 'Other';
  const otherSuffix = item.documentType === 'other' && item.documentTypeOther ? ` — ${item.documentTypeOther}` : '';
  return `${item.filename} (${typeLabel}${otherSuffix})`;
}

export interface RfiWorkbookExtras {
  organizations?: RfiXlsOrganization[];
  queryStamp?: RfiXlsUploadStamp;
  answerStamp?: RfiXlsUploadStamp;
  queryAttachments?: RfiXlsAttachmentItem[];
  responseAttachments?: RfiXlsAttachmentItem[];
  comments?: RfiXlsComment[];
  auditEvents?: RfiXlsAuditEvent[];
}

// Split out from downloadRfiXls so the workbook itself (the part worth
// testing) doesn't depend on DOM globals (document, URL.createObjectURL).
// `extras` (Phase 5) is optional so every pre-Phase-5 caller/test keeps
// working with the same two-argument call unchanged.
export async function buildRfiWorkbookBuffer(rfi: Rfi, project?: Project, extras?: RfiWorkbookExtras): Promise<RfiWorkbookResult> {
  const discipline = rfi.discipline ? RFI_DISCIPLINE_LABELS[rfi.discipline] : '—';
  const disciplineDisplay = rfi.discipline === 'other' && rfi.disciplineOther
    ? `${discipline} — ${rfi.disciplineOther}`
    : discipline;

  // Image fetches (project logo/stamp, organization logos) are all a
  // nice-to-have -- a CORS hiccup or network blip never blocks the export
  // (same rule the PDF template follows), but unlike the PDF path this
  // failure is silent to the person clicking the button, so it's worth
  // telling them rather than just quietly shipping a file that's missing
  // branding they expected to see. Declared up front since organization
  // logos (below) are fetched before the project logo/stamp at the bottom.
  const warnings: string[] = [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EngineeringOS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('RFI', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  // Column A widened from 24 to 30 -- at 24, "REQUEST FOR INFORMATION" (24
  // characters) in bold 14pt visually overflowed and got clipped at the
  // column boundary instead of spilling into the adjacent (non-empty)
  // cell, which Excel only does for genuinely empty neighbors.
  sheet.columns = [{ width: 30 }, { width: 62 }];

  // Title bar
  const titleRow = sheet.addRow(['REQUEST FOR INFORMATION', rfi.rfiNumber ?? rfi.id]);
  titleRow.height = 28;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: INK }, name: FONT };
  titleRow.getCell(2).font = { bold: true, size: 12, color: { argb: ACCENT }, name: FONT };
  titleRow.getCell(1).alignment = { vertical: 'middle' };
  titleRow.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
  titleRow.eachCell((cell) => {
    // Matches rfi-pdf.template.ts's header rule exactly -- a signal-orange
    // underline, not a plain black one.
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
  });
  spacerRow(sheet);

  sectionRow(sheet, 'PROJECT');
  fieldRow(sheet, 'Project Name', project?.name ?? '—');
  fieldRow(sheet, 'Project No.', project?.code ?? '—');
  fieldRow(sheet, 'Location', project?.location ?? '—');
  fieldRow(sheet, 'Date', formatDate(rfi.createdAt));
  spacerRow(sheet);

  sectionRow(sheet, 'STAKEHOLDERS');
  fieldRow(sheet, 'Client', project?.clientName ?? '—');
  fieldRow(sheet, 'Lead Designer', project?.leadDesigner ?? '—');
  fieldRow(sheet, 'Consultant', project?.consultantName ?? '—');
  fieldRow(sheet, 'Technical Advisor', project?.technicalAdvisor ?? '—');
  fieldRow(sheet, 'PMC', project?.pmcName ?? '—');
  fieldRow(sheet, 'Main Contractor', project?.mainContractor ?? '—');
  fieldRow(sheet, 'Subcontractor', project?.subcontractor ?? '—');
  spacerRow(sheet);

  // Always all 5 named-organization slots (Phase 4/5) -- distinct from the
  // free-text stakeholder fields above. Matches RfiDetailPage's own
  // OrganizationSlotRow, which shows a row for every slot whether or not
  // it's configured yet, rather than only the ones somebody filled in.
  sectionRow(sheet, 'ORGANIZATIONS');
  const orgsBySlot = new Map((extras?.organizations ?? []).map((o) => [o.slot, o]));
  for (const slot of PROJECT_ORGANIZATION_SLOTS) {
    const org = orgsBySlot.get(slot);
    const row = fieldRow(
      sheet,
      PROJECT_ORGANIZATION_SLOT_LABELS[slot],
      [org?.name, org?.orgRef].filter(Boolean).join(' — ') || '—',
    );
    const orgLogo = await tryFetchImage(org?.logoUrl);
    if (orgLogo.status === 'ok') {
      const imageId = workbook.addImage({ buffer: orgLogo.buffer, extension: orgLogo.extension });
      sheet.addImage(imageId, { tl: { col: 1.55, row: row.number - 1 }, ext: { width: 20, height: 20 } });
    } else if (orgLogo.status === 'failed') {
      warnings.push(`Could not load the ${PROJECT_ORGANIZATION_SLOT_LABELS[slot]} logo, so it was left out of this export.`);
    }
  }
  spacerRow(sheet);

  sectionRow(sheet, 'RFI DETAILS');
  fieldRow(sheet, 'Status', RFI_STATUS_LABELS[rfi.status]);
  fieldRow(sheet, 'Priority', RFI_PRIORITY_LABELS[rfi.priority]);
  fieldRow(sheet, 'Discipline', disciplineDisplay);
  fieldRow(sheet, 'Assigned To', rfi.assignedToName ?? 'Unassigned');
  fieldRow(sheet, 'Due Date', formatDate(rfi.dueDate));
  spacerRow(sheet);

  // Full 4-state impact detail (level + amount/currency or days +
  // description), not just a Yes/No boolean -- matches RfiDetailPage's own
  // ImpactSummary/ImpactEditor exactly. Falls back to the legacy boolean
  // for RFIs created before the level field existed, same precedence
  // rfis.service.ts itself uses server-side.
  const costLevel: RfiImpactLevel = rfi.costImpactLevel ?? (rfi.costImpact ? 'yes' : 'no');
  const timeLevel: RfiImpactLevel = rfi.timeImpactLevel ?? (rfi.timeImpact ? 'yes' : 'no');
  sectionRow(sheet, 'IMPACT OF REPLY');
  fieldRow(sheet, 'Cost Impact', RFI_IMPACT_LEVEL_LABELS[costLevel]);
  if (rfi.costImpactAmount != null) {
    fieldRow(sheet, 'Estimated Amount', `${rfi.costImpactCurrency ? rfi.costImpactCurrency + ' ' : ''}${rfi.costImpactAmount}`);
  }
  if (rfi.costImpactDescription) fieldRow(sheet, 'Cost Impact Notes', rfi.costImpactDescription);
  fieldRow(sheet, 'Time Impact', RFI_IMPACT_LEVEL_LABELS[timeLevel]);
  if (rfi.timeImpactDays != null) fieldRow(sheet, 'Estimated Days', String(rfi.timeImpactDays));
  if (rfi.timeImpactDescription) fieldRow(sheet, 'Time Impact Notes', rfi.timeImpactDescription);
  spacerRow(sheet);

  sectionRow(sheet, 'RFI TITLE');
  textBlockRow(sheet, rfi.subject);
  spacerRow(sheet);

  sectionRow(sheet, 'QUERY');
  textBlockRow(sheet, richTextToPlain(rfi.question));
  if (extras?.queryAttachments && extras.queryAttachments.length > 0) {
    fieldRow(sheet, 'Query Attachments', extras.queryAttachments.map(attachmentLabel).join('; '));
  }
  spacerRow(sheet);

  // Only rendered when set -- an unsubmitted/legacy RFI has no query_stamp
  // yet. Same field choice as the PDF template and RfiDetailPage's own
  // on-screen StampPanel (createdByName/updatedAt) so all three never
  // disagree with each other.
  if (extras?.queryStamp) {
    sectionRow(sheet, 'QUERY UPLOAD STAMP');
    fieldRow(sheet, 'Uploaded By', extras.queryStamp.uploadedBy ?? '—');
    fieldRow(sheet, 'Date-Time', extras.queryStamp.dateTime ?? '—');
    fieldRow(sheet, 'Stamp', extras.queryStamp.stamp);
    spacerRow(sheet);
  }

  sectionRow(sheet, 'RESPONSE');
  textBlockRow(sheet, rfi.answer ? richTextToPlain(rfi.answer) : '(not yet answered)');
  if (extras?.responseAttachments && extras.responseAttachments.length > 0) {
    fieldRow(sheet, 'Response Attachments', extras.responseAttachments.map(attachmentLabel).join('; '));
  }

  if (extras?.answerStamp) {
    spacerRow(sheet);
    sectionRow(sheet, 'ANSWER UPLOAD STAMP');
    fieldRow(sheet, 'Uploaded By', extras.answerStamp.uploadedBy ?? '—');
    fieldRow(sheet, 'Date-Time', extras.answerStamp.dateTime ?? '—');
    fieldRow(sheet, 'Stamp', extras.answerStamp.stamp);
  }
  spacerRow(sheet);

  sectionRow(sheet, 'COMMUNICATION / CLARIFICATIONS');
  if (extras?.comments && extras.comments.length > 0) {
    for (const c of extras.comments) {
      const who = `${c.userName ?? 'Someone'}${c.organizationSlot ? ` (${c.organizationSlot})` : ''}  ·  ${c.createdAt}`;
      textBlockRow(sheet, `${who}\n${c.body}`);
    }
  } else {
    fieldRow(sheet, 'Comments', 'No comments.');
  }
  spacerRow(sheet);

  sectionRow(sheet, 'AUDIT TRAIL');
  if (extras?.auditEvents && extras.auditEvents.length > 0) {
    for (const a of extras.auditEvents) {
      fieldRow(sheet, a.action, `${a.userName ?? 'System'}  ·  ${a.occurredAt}`);
    }
  } else {
    fieldRow(sheet, 'Events', 'No audit events recorded.');
  }

  const logo = await tryFetchImage(project?.logoUrl);
  if (logo.status === 'ok') {
    const imageId = workbook.addImage({ buffer: logo.buffer, extension: logo.extension });
    sheet.addImage(imageId, { tl: { col: 1.55, row: 0.05 }, ext: { width: 36, height: 36 } });
  } else if (logo.status === 'failed') {
    warnings.push('Could not load the project logo, so it was left out of this export.');
  }

  const stamp = await tryFetchImage(project?.stampUrl);
  if (stamp.status === 'ok') {
    const stampId = workbook.addImage({ buffer: stamp.buffer, extension: stamp.extension });
    const anchorRow = sheet.lastRow ? sheet.lastRow.number - 1 : 0;
    sheet.addImage(stampId, { tl: { col: 1.55, row: anchorRow }, ext: { width: 60, height: 60 } });
  } else if (stamp.status === 'failed') {
    warnings.push('Could not load the project stamp, so it was left out of this export.');
  }

  return { buffer: await workbook.xlsx.writeBuffer(), warnings };
}

export async function downloadRfiXls(rfi: Rfi, project?: Project, extras?: RfiWorkbookExtras): Promise<string[]> {
  const { buffer, warnings } = await buildRfiWorkbookBuffer(rfi, project, extras);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rfi.rfiNumber ?? rfi.id}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return warnings;
}
