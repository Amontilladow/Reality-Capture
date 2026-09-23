import ExcelJS from 'exceljs';

// Mirrors apps/web/src/lib/rfi-xls.ts's palette/row-builder conventions
// exactly, adapted for a much simpler 3-column layout (Issues has no
// organizations/stamps concept, so no dedicated org-logo columns are
// needed) -- kept as its own copy since this one runs server-side
// (apps/api) against real Buffers, not the browser/base64 round trip
// rfi-xls.ts needs to dodge S3 CORS.
const INK = 'FF0A141C';
const MUTED = 'FF4A6178';
const BORDER = 'FFB9C6CE';
const SECTION_FILL = 'FFEAF0F4';
const BLUEPRINT = 'FF1E6E93';
const FONT = 'IBM Plex Sans';

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const gridBorder = { top: thin, bottom: thin, left: thin, right: thin };

// 3 columns: A (label), B (value), C (reserved for attachment thumbnails
// only -- kept separate so an image never overlaps a text value, same
// reasoning as rfi-xls.ts's dedicated trailing thumbnail column).
const FULL_WIDTH_END = 3;

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
  sheet.mergeCells(row.number, 2, row.number, 2);
  row.height = 18;
  const labelCell = row.getCell(1);
  labelCell.font = { bold: true, size: 9.5, color: { argb: MUTED }, name: FONT };
  labelCell.alignment = { vertical: 'middle' };
  labelCell.border = gridBorder;
  row.getCell(2).value = value;
  row.getCell(2).font = { size: 10, color: { argb: INK }, name: FONT };
  row.getCell(2).alignment = { vertical: 'middle', wrapText: true };
  row.getCell(2).border = gridBorder;
  row.getCell(3).border = gridBorder;
  return row;
}

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
  const row = sheet.addRow(['']);
  row.height = 6;
  return row;
}

// Same native-EMU-offset approach as rfi-xls.ts's addPixelImage() -- see
// that file's own long comment for why the fractional {col, row} shorthand
// is avoided. Ported here since it runs server-side with a real Buffer,
// not an ArrayBuffer from a base64 round trip.
function addPixelImage(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
  buffer: Buffer,
  extension: 'png' | 'jpeg',
  col: number,
  row: number,
  sizePx: number,
  padPx = 3,
) {
  const EMU_PER_PX = 9525;
  // exceljs's own .d.ts pulls in a slightly different Buffer generic than
  // this project's @types/node resolves to (a pnpm multiple-copies-of-
  // @types/node friction, not a real type mismatch) -- cast at the
  // boundary rather than fighting the version skew.
  const imageId = workbook.addImage({ buffer: buffer as unknown as ExcelJS.Buffer, extension });
  const tl = { nativeCol: col, nativeColOff: padPx * EMU_PER_PX, nativeRow: row, nativeRowOff: padPx * EMU_PER_PX };
  const br = { nativeCol: col, nativeColOff: (padPx + sizePx) * EMU_PER_PX, nativeRow: row, nativeRowOff: (padPx + sizePx) * EMU_PER_PX };
  sheet.addImage(imageId, { tl, br, editAs: 'oneCell' } as unknown as { tl: ExcelJS.Anchor; br: ExcelJS.Anchor });
}

export interface IssueXlsAttachmentItem {
  filename: string;
  imageBuffer?: Buffer;
  imageExtension?: 'png' | 'jpeg';
}

export interface IssueXlsComment {
  userName?: string;
  body: string;
  createdAt: string;
}

export interface IssueXlsActivityEvent {
  action: string;
  userName?: string;
  occurredAt: string;
}

export interface IssueXlsData {
  issueNumber: string;
  title: string;
  status: string;
  priority: string;
  issueTypeLabel: string;
  disciplineLabel?: string;
  categoryLabel?: string;
  description?: string;
  createdByName?: string;
  createdAt: string;
  assignedToName?: string;
  deadline?: string;
  locationName?: string;
  closedAt?: string;
  attachments?: IssueXlsAttachmentItem[];
  // Distinct from `attachments` -- see issue-pdf.template.ts's identical
  // field for why these are kept separate rather than merged into one list.
  pinPhotos?: IssueXlsAttachmentItem[];
  comments?: IssueXlsComment[];
  activityEvents?: IssueXlsActivityEvent[];
  projectName: string;
  projectCode?: string;
}

export async function buildIssueWorkbookBuffer(data: IssueXlsData): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Issue');
  sheet.columns = [{ width: 26 }, { width: 74 }, { width: 14 }];

  const titleRow = sheet.addRow([data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, FULL_WIDTH_END);
  titleRow.getCell(1).font = { bold: true, size: 11, color: { argb: MUTED }, name: FONT };

  const headingRow = sheet.addRow([`ISSUE ${data.issueNumber}`]);
  sheet.mergeCells(headingRow.number, 1, headingRow.number, FULL_WIDTH_END);
  headingRow.getCell(1).font = { bold: true, size: 14, color: { argb: INK }, name: FONT };
  spacerRow(sheet);

  sectionRow(sheet, 'ISSUE DETAILS');
  fieldRow(sheet, 'Status', data.status);
  fieldRow(sheet, 'Priority', data.priority);
  fieldRow(sheet, 'Type', data.issueTypeLabel);
  fieldRow(sheet, 'Discipline', data.disciplineLabel ?? '—');
  fieldRow(sheet, 'Category', data.categoryLabel ?? '—');
  fieldRow(sheet, 'Assigned To', data.assignedToName ?? 'Unassigned');
  fieldRow(sheet, 'Location', data.locationName ?? '—');
  fieldRow(sheet, 'Due Date', data.deadline ?? '—');
  fieldRow(sheet, 'Created', `${data.createdByName ?? '—'} · ${data.createdAt}`);
  if (data.closedAt) fieldRow(sheet, 'Closed', data.closedAt);
  spacerRow(sheet);

  sectionRow(sheet, 'TITLE');
  textBlockRow(sheet, data.title);
  spacerRow(sheet);

  sectionRow(sheet, 'DESCRIPTION');
  textBlockRow(sheet, data.description || '—');
  spacerRow(sheet);

  sectionRow(sheet, 'ATTACHMENTS');
  if (data.attachments && data.attachments.length > 0) {
    for (const item of data.attachments) {
      const row = fieldRow(sheet, '', item.filename);
      if (item.imageBuffer && item.imageExtension) {
        row.height = 24;
        addPixelImage(sheet, workbook, item.imageBuffer, item.imageExtension, 2, row.number - 1, 20);
      }
    }
  } else {
    textBlockRow(sheet, 'No attachments.');
  }
  spacerRow(sheet);

  if (data.pinPhotos && data.pinPhotos.length > 0) {
    sectionRow(sheet, 'PHOTOS FROM PIN');
    for (const item of data.pinPhotos) {
      const row = fieldRow(sheet, '', item.filename);
      if (item.imageBuffer && item.imageExtension) {
        row.height = 24;
        addPixelImage(sheet, workbook, item.imageBuffer, item.imageExtension, 2, row.number - 1, 20);
      }
    }
    spacerRow(sheet);
  }

  sectionRow(sheet, 'COMMENTS');
  if (data.comments && data.comments.length > 0) {
    for (const c of data.comments) {
      textBlockRow(sheet, `${c.userName ?? 'Someone'} · ${c.createdAt}\n${c.body}`);
    }
  } else {
    textBlockRow(sheet, 'No comments.');
  }
  spacerRow(sheet);

  sectionRow(sheet, 'ACTIVITY LOG');
  if (data.activityEvents && data.activityEvents.length > 0) {
    for (const a of data.activityEvents) {
      fieldRow(sheet, a.occurredAt, `${a.userName ?? 'System'} — ${a.action}`);
    }
  } else {
    textBlockRow(sheet, 'No activity recorded.');
  }

  return workbook.xlsx.writeBuffer();
}
