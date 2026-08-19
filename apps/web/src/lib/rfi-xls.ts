import ExcelJS from 'exceljs';
import type { Rfi, Project, RfiImpactLevel } from '@engineeringos/types';
import {
  RFI_DISCIPLINE_LABELS, RFI_DOCUMENT_TYPE_LABELS, RFI_IMPACT_LEVEL_LABELS,
  PROJECT_ORGANIZATION_SLOTS, PROJECT_ORGANIZATION_SLOT_LABELS,
  type RfiDocumentType, type ProjectOrganizationSlot,
} from '@engineeringos/types';
import { RFI_STATUS_LABELS, RFI_PRIORITY_LABELS, formatDate } from './rfi-constants';
import { apiGet } from './api';

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
  id: string;
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

// Full row width is 8 columns (A, then 5 narrow org-logo columns B-F, then
// the wide value column G, then a trailing thumbnail column H) -- see the
// sheet.columns comment below for why the org columns sit right after A
// instead of after the value column. Section headers and free-text blocks
// span the whole thing (1-8); ordinary field rows merge everything from
// column 2 onward into one value cell, so "Status | High" still reads as
// two adjacent cells with no dead space in between, exactly as before --
// only the org-strip rows (built separately, below) deliberately leave
// columns 2-6 unmerged so each of the 5 slots gets its own real cell.
const FULL_WIDTH_END = 8;

function sectionRow(sheet: ExcelJS.Worksheet, title: string) {
  const row = sheet.addRow([title]);
  sheet.mergeCells(row.number, 1, row.number, FULL_WIDTH_END);
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
  const row = sheet.addRow([label]);
  sheet.mergeCells(row.number, 2, row.number, FULL_WIDTH_END);
  row.height = 18;
  const labelCell = row.getCell(1);
  labelCell.font = { bold: true, size: 9.5, color: { argb: MUTED }, name: FONT };
  labelCell.alignment = { vertical: 'middle' };
  labelCell.border = gridBorder;
  row.getCell(2).value = value;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber === 1) return;
    cell.font = { size: 10, color: { argb: INK }, name: FONT };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = gridBorder;
  });
  return row;
}

// A merged full-width block for long free text (RFI title, query, response) --
// same "one big cell" treatment the PDF gives these sections.
function textBlockRow(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text]);
  sheet.mergeCells(row.number, 1, row.number, FULL_WIDTH_END);
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

// Project logo/stamp and each organization's logo used to be fetched with a
// plain browser fetch() straight against their S3 presigned GET URLs. That
// works for an <img src> (no CORS needed just to paint pixels) and works in
// Node (fetch() there doesn't enforce CORS), but reading the response body
// in a real browser strictly requires the bucket to send CORS headers for
// this app's origin -- easy to be missing in production even when local
// MinIO's permissive default masks it in dev. Routed through this
// same-origin backend endpoint instead (mirrors rfis.service.ts's
// generatePdf(), which has never had this problem since it downloads via
// the S3 SDK server-side, no browser/CORS involved at all).
interface RfiExportImageAsset {
  base64: string;
  mimeType: string;
}
interface RfiExportAssets {
  logo?: RfiExportImageAsset;
  stamp?: RfiExportImageAsset;
  organizations: Array<{ slot: ProjectOrganizationSlot; base64?: string; mimeType?: string }>;
  attachments: Array<{ id: string; base64?: string; mimeType?: string }>;
}

// Same raster-extension set rfis.service.ts's isImageFilename() uses server-
// side to decide which attachments are even worth a thumbnail round trip --
// kept in sync manually (small, stable list) rather than threaded through
// the API response, since every other attachment already renders correctly
// via attachmentLabel() with no image at all.
const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

function isImageAttachment(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_ATTACHMENT_EXTENSIONS.has(ext);
}

async function fetchExportAssets(projectId: string, rfiId: string): Promise<RfiExportAssets | undefined> {
  try {
    return await apiGet<RfiExportAssets>(`/projects/${projectId}/rfis/${rfiId}/export-assets`);
  } catch {
    // A network blip or auth hiccup shouldn't take down the whole export --
    // the caller decides whether/how to surface this as a warning (same
    // rule the old per-image tryFetchImage() followed).
    return undefined;
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function extensionFromMimeType(mimeType?: string): 'png' | 'jpeg' {
  return mimeType?.includes('png') ? 'png' : 'jpeg';
}

// Places a small square image at an exact pixel position/size within a
// single cell, via `twoCellAnchor` with explicit native (EMU) offsets on
// both corners -- deliberately NOT exceljs's `{tl: {col, row}, ext}`
// shorthand this file used before. That shorthand computes the small
// in-cell offset via `Anchor#col`'s setter (`nativeColOff = fraction *
// colWidth`), and `colWidth` (lib/doc/anchor.js) falls back to a hardcoded
// value whenever the target column's width matches exceljs's own
// DEFAULT_COLUMN_WIDTH (see the sheet.columns comment below for the
// concrete bug that caused) -- one nine-only symptom already found and
// fixed, but the same fallback machinery is still in the loop for the
// offset math even now, and its shorthand also writes `oneCellAnchor`
// with an `editAs` attribute that isn't actually part of that element's
// OOXML schema (only `twoCellAnchor` defines `editAs`; confirmed against
// exceljs's own xform source, lib/xlsx/xform/drawing/one-cell-anchor-xform.js).
// Passing raw `nativeCol`/`nativeColOff` (EMU, 9525 per px) bypasses the
// width-dependent setter entirely for both corners, and forces the more
// common, better-tested twoCellAnchor code path (the same one Excel's own
// "Insert Picture" UI produces) since `br` is present.
function addPixelImage(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
  buffer: ArrayBuffer,
  extension: 'png' | 'jpeg',
  col: number,
  row: number,
  sizePx: number,
  padPx = 3,
) {
  const EMU_PER_PX = 9525;
  const imageId = workbook.addImage({ buffer, extension });
  const tl = { nativeCol: col, nativeColOff: padPx * EMU_PER_PX, nativeRow: row, nativeRowOff: padPx * EMU_PER_PX };
  const br = { nativeCol: col, nativeColOff: (padPx + sizePx) * EMU_PER_PX, nativeRow: row, nativeRowOff: (padPx + sizePx) * EMU_PER_PX };
  // exceljs's public TS types only describe the fractional {col, row} shape
  // this deliberately avoids; the native-offset shape is a real, internally
  // -supported input (lib/doc/anchor.js's Anchor constructor branches on
  // `address.nativeCol !== undefined`), just not reflected in the .d.ts.
  sheet.addImage(imageId, { tl, br, editAs: 'oneCell' } as unknown as { tl: ExcelJS.Anchor; br: ExcelJS.Anchor });
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

// One row per attachment (previously a single row with every filename
// joined by "; ") so an image-type attachment can carry its own thumbnail,
// matching the small inline preview the PDF export already gives photos --
// same underlying export-assets thumbnails, just anchored into a
// spreadsheet cell instead of a react-pdf <Image>. Non-image attachments
// (pdf/doc/xls/zip) render exactly as before, just one per row instead of
// semicolon-joined. Thumbnail anchored at column H (index 7, the dedicated
// trailing thumbnail column -- see the sheet.columns comment) -- an integer
// column index, not a fraction of the value column -- for the same reason
// the organization logo strip above uses one dedicated column per icon: a
// fractional column offset in exceljs does not scale against that column's
// declared width, confirmed directly against its own anchor output.
function attachmentListRows(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
  heading: string,
  items: RfiXlsAttachmentItem[] | undefined,
  assetsById: Map<string, { base64?: string; mimeType?: string }>,
  warnings: string[],
) {
  if (!items || items.length === 0) return;
  fieldRow(sheet, heading, '');
  const THUMB_PX = 20;
  for (const item of items) {
    const asset = assetsById.get(item.id);
    const row = fieldRow(sheet, '', attachmentLabel(item));
    if (asset?.base64) {
      row.height = 24;
      addPixelImage(sheet, workbook, base64ToArrayBuffer(asset.base64), extensionFromMimeType(asset.mimeType), 7, row.number - 1, THUMB_PX);
    } else if (isImageAttachment(item.filename)) {
      // A raster-image attachment whose thumbnail didn't resolve -- either
      // this one attachment's own S3 download failed, or the whole
      // export-assets request failed. Worth telling the person who clicked
      // the button, same as the logo/stamp warnings above.
      warnings.push(`Could not load a preview for ${item.filename}, so it was listed as text only.`);
    }
  }
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
  // nice-to-have -- a network blip never blocks the export (same rule the
  // PDF template follows), but unlike the PDF path this failure is silent
  // to the person clicking the button, so it's worth telling them rather
  // than just quietly shipping a file that's missing branding they expected
  // to see. Declared up front since organization logos (below) are
  // referenced before the project logo/stamp at the bottom.
  const warnings: string[] = [];

  // Single same-origin call for every image this export needs (project
  // logo/stamp + all 5 org logos), instead of one direct browser fetch()
  // per image against S3 presigned URLs -- see the comment on
  // fetchExportAssets() above for why. `undefined` here means the whole
  // request failed (network/auth); the per-image fallbacks below already
  // treat "no asset for a slot/field that was actually configured" as a
  // failure regardless of which of the two happened, so no separate
  // whole-request branch is needed.
  const exportAssets = await fetchExportAssets(rfi.projectId, rfi.id);
  const exportAssetsBySlot = new Map((exportAssets?.organizations ?? []).map((o) => [o.slot, o]));
  const exportAssetsByAttachmentId = new Map((exportAssets?.attachments ?? []).map((a) => [a.id, a]));

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
  //
  // B-F (5 narrow columns) hold the organization logo strip; G is the wide
  // "value" column every fieldRow/textBlockRow/sectionRow merges into; H is
  // a dedicated trailing column for per-attachment thumbnails. Deliberately
  // in THIS order -- org columns before the value column, not after it --
  // because Excel lays columns out strictly left to right: putting the org
  // strip after the wide value column (the layout this file used to have)
  // meant it only ever appeared past however much dead space that column's
  // own width added, regardless of how little text actually filled it,
  // reported directly as the logo strip reading as a disconnected block far
  // to the right of the header instead of tucked in next to it. Moving the
  // org columns to sit immediately after A removes that gap outright.
  // fieldRow merges columns 2 through H into one value cell so ordinary
  // rows ("Status | High") still read as two directly-adjacent cells with
  // no gap, exactly as before -- only the org-strip rows (built separately,
  // below) deliberately leave columns B-F unmerged, since each of the 5
  // slots needs its own real cell for its own image and label.
  //
  // A floating image's fractional column offset (e.g. col: 1.55) does NOT
  // scale against that column's own declared width -- verified directly
  // against exceljs's own anchor output, it consistently uses a fixed
  // ~65px unit regardless of the column's real width, so packing icons
  // into fractional offsets within one column would place them almost
  // entirely on top of each other. One real column per icon sidesteps
  // that: an integer `col` value is unambiguous no matter how that scaling
  // quirk works.
  //
  // Narrow-column width is 10, not 9: exceljs's own `DEFAULT_COLUMN_WIDTH`
  // constant (lib/doc/column.js) is *exactly* 9, and a column whose
  // declared width equals that constant is treated as "not custom" and
  // silently omitted from the file's <cols> XML entirely -- confirmed by
  // writing a real file and inspecting the raw XML directly (unzipped, not
  // re-parsed by exceljs itself, since that would just as consistently
  // misread its own bug). With no <col> entry at all, real Excel falls
  // back to its own undefined-column default instead of the width this
  // file actually needs, throwing the floating images anchored in those
  // columns visibly out of position -- reported directly against
  // Microsoft Excel desktop, not a third-party-viewer quirk. Any value
  // other than precisely 9 avoids this; 10 was picked for headroom, not
  // because 9.01 wouldn't also work.
  sheet.columns = [{ width: 30 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 62 }, { width: 10 }];

  // Title bar. RFI number lives in the merged value+thumbnail columns
  // (G:H) rather than column B now that B is the first org-logo column --
  // right-aligned to the sheet's actual right edge either way.
  const titleRow = sheet.addRow(['REQUEST FOR INFORMATION']);
  sheet.mergeCells(titleRow.number, 7, titleRow.number, FULL_WIDTH_END);
  titleRow.getCell(7).value = rfi.rfiNumber ?? rfi.id;

  // exceljs's own <dimension> element for the file (its calculated "used
  // range") only ever covers cells that actually hold data -- floating
  // images (sheet.addImage()) never count. This sheet's own pageSetup
  // below sets fitToWidth: 1, and real Excel computes that print/page-
  // layout scale factor from the sheet's dimension, so any column entirely
  // outside it (where a floating image might still visually sit) wouldn't
  // scale in lockstep with the rest of the table when printed. Merging the
  // RFI number into column H above already pulls the dimension out to the
  // sheet's full 8-column width on every file, so no separate empty-string
  // touch is needed here anymore (previously required when column G was
  // never otherwise written to).
  titleRow.height = 28;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: INK }, name: FONT };
  titleRow.getCell(7).font = { bold: true, size: 12, color: { argb: ACCENT }, name: FONT };
  titleRow.getCell(1).alignment = { vertical: 'middle' };
  titleRow.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
  titleRow.eachCell({ includeEmpty: true }, (cell) => {
    // Matches rfi-pdf.template.ts's header rule exactly -- a signal-orange
    // underline, not a plain black one. includeEmpty so the underline
    // spans the full row (columns B-F would otherwise be skipped, since
    // they're never explicitly touched on this row).
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
  });
  spacerRow(sheet);

  // Compact "Name · No." line, folded into the header area instead of a
  // standalone "PROJECT" section -- matches the live page's PageHeader
  // eyebrow shown just above the RFI number heading. Location/Date dropped
  // entirely (the live page never shows either; Date is already covered by
  // the RFI DETAILS section's own creation-adjacent fields below).
  if (project?.name || project?.code) {
    const projectLineRow = sheet.addRow([[project?.name, project?.code].filter(Boolean).join(' · ')]);
    sheet.mergeCells(projectLineRow.number, 1, projectLineRow.number, FULL_WIDTH_END);
    projectLineRow.height = 16;
    projectLineRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 9, color: { argb: MUTED }, name: FONT };
      cell.alignment = { vertical: 'middle' };
    });
    spacerRow(sheet);
  }

  // Organization logos -- one image, its name (or slot label if
  // unconfigured) directly underneath, nothing else. Matches the PDF's own
  // orgRow exactly (image + `org.name || slotLabel`, no separate text
  // table listing the same 5 organizations again below it) -- an earlier
  // version here had both a floating logo strip AND a full ORGANIZATIONS
  // table repeating the same names, which read as two disconnected things
  // rather than one. Always all 5 slots (an unconfigured slot still gets
  // its label, just no image), matching the live page's OrganizationSlotRow.
  // Each slot gets its own column (B-F, immediately after the label column
  // -- see the sheet.columns comment) for both the image row and the label
  // row, so the label is real cell content sitting directly under its own
  // image, not a separate table. Deliberately positioned right after A
  // (not after the wide value column, which now lives at G) so the strip
  // reads as part of the header block instead of a disconnected block off
  // to the right past a wide empty column.
  const orgsBySlot = new Map((extras?.organizations ?? []).map((o) => [o.slot, o]));
  const LOGO_STRIP_COLS = [1, 2, 3, 4, 5]; // 0-indexed: B, C, D, E, F
  const ICON_PX = 26;
  const logoImageRow = sheet.addRow(['']);
  logoImageRow.height = 28;
  const logoLabelRow = sheet.addRow(['']);
  logoLabelRow.height = 26;
  PROJECT_ORGANIZATION_SLOTS.forEach((slot, i) => {
    const col0 = LOGO_STRIP_COLS[i];
    const org = orgsBySlot.get(slot);
    const asset = exportAssetsBySlot.get(slot);
    if (asset?.base64) {
      addPixelImage(sheet, workbook, base64ToArrayBuffer(asset.base64), extensionFromMimeType(asset.mimeType), col0, logoImageRow.number - 1, ICON_PX);
    } else if (org?.logoUrl) {
      // A logo was configured (RfiDetailPage's OrganizationSlotRow shows
      // one on screen) but the backend couldn't resolve it -- either this
      // slot's own S3 download failed, or the whole export-assets request
      // failed. Either way, worth telling the person who clicked the
      // button, same as the old per-image tryFetchImage() did.
      warnings.push(`Could not load the ${PROJECT_ORGANIZATION_SLOT_LABELS[slot]} logo, so it was left out of this export.`);
    }
    const labelCell = logoLabelRow.getCell(col0 + 1);
    labelCell.value = org?.name || PROJECT_ORGANIZATION_SLOT_LABELS[slot];
    labelCell.font = { size: 7, color: { argb: MUTED }, name: FONT };
    labelCell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
  });
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
  attachmentListRows(sheet, workbook, 'Query Attachments', extras?.queryAttachments, exportAssetsByAttachmentId, warnings);
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

  // Communication/Clarifications before Response -- matches the live page's
  // own top-to-bottom order (comment thread renders above the Response
  // panel on RfiDetailPage).
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

  sectionRow(sheet, 'RESPONSE');
  textBlockRow(sheet, rfi.answer ? richTextToPlain(rfi.answer) : '(not yet answered)');
  attachmentListRows(sheet, workbook, 'Response Attachments', extras?.responseAttachments, exportAssetsByAttachmentId, warnings);

  if (extras?.answerStamp) {
    spacerRow(sheet);
    sectionRow(sheet, 'ANSWER UPLOAD STAMP');
    fieldRow(sheet, 'Uploaded By', extras.answerStamp.uploadedBy ?? '—');
    fieldRow(sheet, 'Date-Time', extras.answerStamp.dateTime ?? '—');
    fieldRow(sheet, 'Stamp', extras.answerStamp.stamp);
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

  // Anchored at column G (index 6, the value column) via the same
  // addPixelImage native-offset technique as everything else in this file
  // -- the old fractional `{tl: {col: 1.55, row}}` shorthand this used to
  // use pointed at column B, which now holds the first org-logo slot
  // instead of the wide value column, and fractional offsets don't scale
  // against a column's real declared width regardless (see addPixelImage's
  // own comment).
  if (exportAssets?.logo?.base64) {
    addPixelImage(sheet, workbook, base64ToArrayBuffer(exportAssets.logo.base64), extensionFromMimeType(exportAssets.logo.mimeType), 6, 0, 36, 4);
  } else if (project?.logoUrl) {
    warnings.push('Could not load the project logo, so it was left out of this export.');
  }

  if (exportAssets?.stamp?.base64) {
    const anchorRow = sheet.lastRow ? sheet.lastRow.number - 1 : 0;
    addPixelImage(sheet, workbook, base64ToArrayBuffer(exportAssets.stamp.base64), extensionFromMimeType(exportAssets.stamp.mimeType), 6, anchorRow, 60, 4);
  } else if (project?.stampUrl) {
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
