import ExcelJS from 'exceljs';
import type { Rfi, Project } from '@engineeringos/types';
import { RFI_DISCIPLINE_LABELS } from '@engineeringos/types';
import { RFI_STATUS_LABELS, RFI_PRIORITY_LABELS, formatDate } from './rfi-constants';

// Mirrors rfi-pdf.template.ts's palette so the two exports read as the same
// document family, not two unrelated tools.
const INK = 'FF1A1A1A';
const MUTED = 'FF64748B';
const BORDER = 'FFCBD5E1';
const SECTION_FILL = 'FFF1F5F9';
const ACCENT = 'FF2563EB';

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const gridBorder = { top: thin, bottom: thin, left: thin, right: thin };

function sectionRow(sheet: ExcelJS.Worksheet, title: string) {
  const row = sheet.addRow([title, '']);
  sheet.mergeCells(row.number, 1, row.number, 2);
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
    cell.font = { bold: true, size: 9, color: { argb: MUTED }, name: 'Calibri' };
    cell.alignment = { vertical: 'middle' };
    cell.border = gridBorder;
  });
  return row;
}

function fieldRow(sheet: ExcelJS.Worksheet, label: string, value: string) {
  const row = sheet.addRow([label, value]);
  row.height = 18;
  const [labelCell, valueCell] = [row.getCell(1), row.getCell(2)];
  labelCell.font = { bold: true, size: 9.5, color: { argb: MUTED }, name: 'Calibri' };
  valueCell.font = { size: 10, color: { argb: INK }, name: 'Calibri' };
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
    cell.font = { size: 10, color: { argb: INK }, name: 'Calibri' };
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

// Split out from downloadRfiXls so the workbook itself (the part worth
// testing) doesn't depend on DOM globals (document, URL.createObjectURL).
export async function buildRfiWorkbookBuffer(rfi: Rfi, project?: Project): Promise<RfiWorkbookResult> {
  const discipline = rfi.discipline ? RFI_DISCIPLINE_LABELS[rfi.discipline] : '—';
  const disciplineDisplay = rfi.discipline === 'other' && rfi.disciplineOther
    ? `${discipline} — ${rfi.disciplineOther}`
    : discipline;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EngineeringOS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('RFI', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [{ width: 24 }, { width: 62 }];

  // Title bar
  const titleRow = sheet.addRow(['REQUEST FOR INFORMATION', rfi.rfiNumber ?? rfi.id]);
  titleRow.height = 28;
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: INK }, name: 'Calibri' };
  titleRow.getCell(2).font = { bold: true, size: 12, color: { argb: ACCENT }, name: 'Calibri' };
  titleRow.getCell(1).alignment = { vertical: 'middle' };
  titleRow.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
  titleRow.eachCell((cell) => {
    cell.border = { bottom: { style: 'medium', color: { argb: INK } } };
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

  sectionRow(sheet, 'RFI DETAILS');
  fieldRow(sheet, 'Status', RFI_STATUS_LABELS[rfi.status]);
  fieldRow(sheet, 'Priority', RFI_PRIORITY_LABELS[rfi.priority]);
  fieldRow(sheet, 'Discipline', disciplineDisplay);
  fieldRow(sheet, 'Cost Impact', rfi.costImpact ? 'Yes' : 'No');
  fieldRow(sheet, 'Time Impact', rfi.timeImpact ? 'Yes' : 'No');
  fieldRow(sheet, 'Due Date', formatDate(rfi.dueDate));
  spacerRow(sheet);

  sectionRow(sheet, 'RFI TITLE');
  textBlockRow(sheet, rfi.subject);
  spacerRow(sheet);

  sectionRow(sheet, 'QUERY');
  textBlockRow(sheet, rfi.question);
  spacerRow(sheet);

  sectionRow(sheet, 'RESPONSE');
  textBlockRow(sheet, rfi.answer ?? '(not yet answered)');

  // Logo/stamp are a nice-to-have -- a CORS hiccup or network blip never
  // blocks the export (same rule the PDF template follows), but unlike the
  // PDF path this failure is silent to the person clicking the button, so
  // it's worth telling them rather than just quietly shipping a file
  // that's missing branding they expected to see.
  const warnings: string[] = [];

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

export async function downloadRfiXls(rfi: Rfi, project?: Project): Promise<string[]> {
  const { buffer, warnings } = await buildRfiWorkbookBuffer(rfi, project);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rfi.rfiNumber ?? rfi.id}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return warnings;
}
