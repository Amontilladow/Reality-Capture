import ExcelJS from 'exceljs';
import { STATUS_LABELS, PRIORITY_LABELS, DISCIPLINE_LABELS, formatDeadline } from './issue-constants';
import { SNAG_STATUS_LABELS, SNAG_PRIORITY_LABELS, formatDate } from './snagging-constants';
import type { ReportKpis } from './reports.api';

// Mirrors rfi-xls.ts's palette/helper conventions exactly (same "Blueprint-
// dark technical palette" ARGB constants, same sectionRow/fieldRow shape) --
// deliberately without that file's image-embedding machinery (addPixelImage,
// fetchExportAssets), since a Reports export has no per-row images, just two
// sheets of breakdown counts + open-item tables.
const INK = 'FF0A141C';          // base-950
const MUTED = 'FF4A6178';        // base-500
const BORDER = 'FFB9C6CE';       // lighter tint of base-500, print-legible
const SECTION_FILL = 'FFEAF0F4'; // ink-100, reused as a light section tint
const BLUEPRINT = 'FF1E6E93';    // blueprint, darkened for contrast on white
const FONT = 'IBM Plex Sans';    // matches index.html's Google Fonts load

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const gridBorder = { top: thin, bottom: thin, left: thin, right: thin };

function sectionRow(sheet: ExcelJS.Worksheet, title: string, span: number) {
  const row = sheet.addRow([title]);
  sheet.mergeCells(row.number, 1, row.number, span);
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
    cell.font = { bold: true, size: 9, color: { argb: BLUEPRINT }, name: FONT };
    cell.alignment = { vertical: 'middle' };
    cell.border = gridBorder;
  });
  return row;
}

function spacerRow(sheet: ExcelJS.Worksheet) {
  const row = sheet.addRow(['']);
  row.height = 6;
  return row;
}

// A simple breakdown table: label column + right-aligned count column.
function breakdownTable(sheet: ExcelJS.Worksheet, heading: string, counts: Record<string, number>, labelFor: (key: string) => string) {
  sectionRow(sheet, heading, 2);
  const headerRow = sheet.addRow(['Label', 'Count']);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9.5, color: { argb: MUTED }, name: FONT };
    cell.border = gridBorder;
  });
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    const row = sheet.addRow(['No data', '']);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 10, color: { argb: MUTED }, name: FONT };
      cell.border = gridBorder;
    });
  }
  for (const [key, count] of entries) {
    const row = sheet.addRow([labelFor(key), count]);
    row.getCell(1).font = { size: 10, color: { argb: INK }, name: FONT };
    row.getCell(2).font = { size: 10, color: { argb: INK }, name: FONT };
    row.getCell(2).alignment = { horizontal: 'right' };
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = gridBorder; });
  }
  spacerRow(sheet);
}

function statusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status;
}
function priorityLabel(priority: string): string {
  return (PRIORITY_LABELS as Record<string, string>)[priority] ?? priority;
}
function disciplineLabel(discipline: string): string {
  return (DISCIPLINE_LABELS as Record<string, string>)[discipline] ?? discipline;
}
function snagStatusLabel(status: string): string {
  return (SNAG_STATUS_LABELS as Record<string, string>)[status] ?? status;
}
function snagPriorityLabel(priority: string): string {
  return (SNAG_PRIORITY_LABELS as Record<string, string>)[priority] ?? priority;
}

function buildIssuesSheet(workbook: ExcelJS.Workbook, kpis: ReportKpis) {
  const sheet = workbook.addWorksheet('Issues', { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 30 }, { width: 16 }];

  const titleRow = sheet.addRow(['ISSUES REPORT']);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 2);
  titleRow.height = 24;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: INK }, name: FONT };
  spacerRow(sheet);

  breakdownTable(sheet, 'BY STATUS', kpis.issues.byStatus, statusLabel);
  breakdownTable(sheet, 'BY PRIORITY', kpis.issues.byPriority, priorityLabel);
  breakdownTable(sheet, 'BY DISCIPLINE', kpis.issues.byDiscipline, disciplineLabel);

  // Open issues list — wider sheet section, 7 columns.
  sectionRow(sheet, 'OPEN ISSUES', 2);
  const listColumns = ['Number', 'Title', 'Status', 'Priority', 'Discipline', 'Deadline', 'Assigned To'];
  // Re-declare the columns for this wider table -- exceljs columns are
  // sheet-wide, so widen the sheet to fit this section (matches rfi-xls.ts's
  // approach of one fixed set of column widths sized for the widest section).
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 34;
  const headerRow = sheet.addRow(listColumns);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9.5, color: { argb: MUTED }, name: FONT };
    cell.border = gridBorder;
  });
  if (kpis.issues.openList.length === 0) {
    const row = sheet.addRow(['No open issues.']);
    sheet.mergeCells(row.number, 1, row.number, listColumns.length);
    row.getCell(1).font = { size: 10, color: { argb: MUTED }, name: FONT };
  }
  for (const item of kpis.issues.openList) {
    const row = sheet.addRow([
      item.issueNumber ?? item.id,
      item.title,
      statusLabel(item.status),
      priorityLabel(item.priority),
      item.discipline ? disciplineLabel(item.discipline) : '—',
      formatDeadline(item.deadline),
      item.assignedToName ?? 'Unassigned',
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 10, color: { argb: INK }, name: FONT };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = gridBorder;
    });
  }
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 20;
}

function buildSnaggingSheet(workbook: ExcelJS.Workbook, kpis: ReportKpis) {
  const sheet = workbook.addWorksheet('Snagging', { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 30 }, { width: 16 }];

  const titleRow = sheet.addRow(['SNAGGING REPORT']);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 2);
  titleRow.height = 24;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: INK }, name: FONT };
  spacerRow(sheet);

  breakdownTable(sheet, 'BY STATUS', kpis.snagging.byStatus, snagStatusLabel);
  breakdownTable(sheet, 'BY PRIORITY', kpis.snagging.byPriority, snagPriorityLabel);
  breakdownTable(sheet, 'BY TRADE', kpis.snagging.byTrade, (t) => t);

  sectionRow(sheet, 'OPEN SNAG ITEMS', 2);
  const listColumns = ['Number', 'Title', 'Status', 'Priority', 'Trade', 'Location', 'Due Date', 'Assigned To'];
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 34;
  const headerRow = sheet.addRow(listColumns);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9.5, color: { argb: MUTED }, name: FONT };
    cell.border = gridBorder;
  });
  if (kpis.snagging.openList.length === 0) {
    const row = sheet.addRow(['No open snag items.']);
    sheet.mergeCells(row.number, 1, row.number, listColumns.length);
    row.getCell(1).font = { size: 10, color: { argb: MUTED }, name: FONT };
  }
  for (const item of kpis.snagging.openList) {
    const row = sheet.addRow([
      item.snagNumber ?? item.id,
      item.title,
      snagStatusLabel(item.status),
      snagPriorityLabel(item.priority),
      item.trade ?? '—',
      item.location ?? '—',
      formatDate(item.dueDate),
      item.assignedToName ?? 'Unassigned',
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 10, color: { argb: INK }, name: FONT };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = gridBorder;
    });
  }
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 16;
  sheet.getColumn(6).width = 18;
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 20;
}

export async function buildReportsWorkbookBuffer(kpis: ReportKpis): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EngineeringOS';
  workbook.created = new Date();

  buildIssuesSheet(workbook, kpis);
  buildSnaggingSheet(workbook, kpis);

  return workbook.xlsx.writeBuffer();
}

export async function downloadReportsXls(kpis: ReportKpis, filenameBase: string): Promise<void> {
  const buffer = await buildReportsWorkbookBuffer(kpis);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}-report.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
