import ExcelJS from 'exceljs';

// Brief section 3: "Excel export" of the drawing register. A flat,
// one-row-per-drawing listing (unlike issue-xls.ts's one-sheet-per-record
// detail export): this is the register itself, not a per-record dossier.
const INK = 'FF0A141C';
const MUTED = 'FF4A6178';
const BORDER = 'FFB9C6CE';
const HEADER_FILL = 'FFEAF0F4';
const BLUEPRINT = 'FF1E6E93';
const FONT = 'IBM Plex Sans';

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const gridBorder = { top: thin, bottom: thin, left: thin, right: thin };

export interface SiteDrawingRegisterRow {
  drawingNumber: string;
  drawingTitle: string;
  discipline?: string;
  buildingOrZone?: string;
  floorOrLevel?: string;
  revisionNumber?: string;
  workflowStatus: string;
  documentClassification: string;
  isSuperseded: boolean;
  sourceProvider: string;
  issueDate?: string;
  lastVerifiedAt?: string;
  extractionStatus?: string;
  importBatchId?: string;
}

const COLUMNS: { header: string; key: keyof SiteDrawingRegisterRow; width: number }[] = [
  { header: 'Drawing No.', key: 'drawingNumber', width: 18 },
  { header: 'Title', key: 'drawingTitle', width: 40 },
  { header: 'Discipline', key: 'discipline', width: 16 },
  { header: 'Building / Zone', key: 'buildingOrZone', width: 18 },
  { header: 'Floor / Level', key: 'floorOrLevel', width: 16 },
  { header: 'Revision', key: 'revisionNumber', width: 10 },
  { header: 'Workflow Status', key: 'workflowStatus', width: 22 },
  { header: 'Document Classification', key: 'documentClassification', width: 20 },
  { header: 'Superseded', key: 'isSuperseded', width: 12 },
  { header: 'Source', key: 'sourceProvider', width: 14 },
  { header: 'Issue Date', key: 'issueDate', width: 14 },
  { header: 'Last Verified', key: 'lastVerifiedAt', width: 20 },
  { header: 'Extraction Status', key: 'extractionStatus', width: 16 },
  { header: 'Import Batch', key: 'importBatchId', width: 24 },
];

export async function buildSiteDrawingRegisterWorkbookBuffer(
  rows: SiteDrawingRegisterRow[],
  projectLabel: string,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Drawing Register');
  sheet.columns = COLUMNS.map((c) => ({ width: c.width }));

  const titleRow = sheet.addRow([`${projectLabel} — Drawing Register`]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, COLUMNS.length);
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: INK }, name: FONT };

  const generatedRow = sheet.addRow([`Generated ${new Date().toISOString().slice(0, 10)} — ${rows.length} drawing${rows.length === 1 ? '' : 's'}`]);
  sheet.mergeCells(generatedRow.number, 1, generatedRow.number, COLUMNS.length);
  generatedRow.getCell(1).font = { italic: true, size: 9, color: { argb: MUTED }, name: FONT };
  sheet.addRow([]);

  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.font = { bold: true, size: 9.5, color: { argb: BLUEPRINT }, name: FONT };
    cell.border = gridBorder;
    cell.alignment = { vertical: 'middle' };
  });
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];

  for (const row of rows) {
    const dataRow = sheet.addRow(COLUMNS.map((c) => {
      const value = row[c.key];
      if (c.key === 'isSuperseded') return value ? 'Yes' : 'No';
      return value ?? '—';
    }));
    dataRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 10, color: { argb: INK }, name: FONT };
      cell.border = gridBorder;
      cell.alignment = { vertical: 'middle' };
    });
  }

  return workbook.xlsx.writeBuffer();
}
