import { createElement as h } from 'react';

// Same brand/font setup as reports-pdf.template.ts / rfi-pdf.template.ts --
// a printed Progress Report should read as the same product as every other
// PDF export in this app, not a one-off design.
const INK = '#0A141C';
const INK_MUTED = '#4A6178';
const BORDER = '#B9C6CE';
const SECTION_FILL = '#EAF0F4';
const SIGNAL = '#E56A1F';
const BLUEPRINT = '#1E6E93';
const DANGER = '#C0392B';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

let fontsRegistered = false;
function registerFonts(Font: typeof import('@react-pdf/renderer').Font) {
  if (fontsRegistered) return;
  fontsRegistered = true;
  Font.register({
    family: 'IBM Plex Sans',
    fonts: [
      { src: require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff'), fontWeight: 400 },
      { src: require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff'), fontWeight: 600 },
      { src: require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff'), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
}

export interface ProgressReportPdfIssueRow {
  issueNumber: string;
  title: string;
  status: string;
  priority: string;
  locationName?: string;
  assignedToName?: string;
  deadline?: string;
}

export interface ProgressReportPdfCapture {
  title?: string;
  locationName?: string;
  capturedAt: string;
  imageBuffer?: Buffer;
}

export interface ProgressReportPdfData {
  projectName: string;
  projectCode?: string;
  buildingName?: string;
  levelName?: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  captures: ProgressReportPdfCapture[];
  newIssues: ProgressReportPdfIssueRow[];
  closedIssues: ProgressReportPdfIssueRow[];
  overdueIssues: ProgressReportPdfIssueRow[];
  blockers: ProgressReportPdfIssueRow[];
}

export async function renderProgressReportPdf(data: ProgressReportPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'IBM Plex Sans', color: INK },
    headerRow: { marginBottom: 14, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    projectEyebrow: { fontSize: 7.5, fontWeight: 600, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    title: { fontSize: 16, fontWeight: 700, letterSpacing: 0.3 },
    subtitle: { fontSize: 9, color: INK_MUTED, marginTop: 2 },
    generatedAt: { fontSize: 8, color: INK_MUTED, marginTop: 3 },

    sectionHeading: { fontSize: 12, fontWeight: 700, color: BLUEPRINT, marginBottom: 8, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

    tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    tile: { border: `1 solid ${BORDER}`, borderRadius: 3, backgroundColor: SECTION_FILL, padding: '6 10', minWidth: 76 },
    tileValue: { fontSize: 15, fontWeight: 700, color: INK },
    tileLabel: { fontSize: 7, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },
    tileDanger: { color: DANGER },

    captureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
    captureCard: { width: 108 },
    captureImage: { width: 108, height: 80, objectFit: 'cover', borderRadius: 2, border: `1 solid ${BORDER}` },
    captureImagePlaceholder: { width: 108, height: 80, borderRadius: 2, border: `1 solid ${BORDER}`, backgroundColor: SECTION_FILL },
    captureCaption: { fontSize: 6.5, color: INK_MUTED, marginTop: 2 },

    emptyNote: { fontSize: 8, color: INK_MUTED, marginBottom: 6 },

    table: { marginTop: 2, marginBottom: 10 },
    tableHeaderRow: { flexDirection: 'row', backgroundColor: SECTION_FILL, borderBottom: `1 solid ${BORDER}`, paddingVertical: 3 },
    tableRow: { flexDirection: 'row', borderBottom: `1 solid ${BORDER}`, paddingVertical: 3 },
    tableHeaderCell: { fontSize: 7, fontWeight: 700, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.3, paddingHorizontal: 3 },
    tableCell: { fontSize: 7.5, paddingHorizontal: 3 },
    colNumber: { width: '15%' },
    colTitle: { width: '30%' },
    colStatus: { width: '13%' },
    colPriority: { width: '12%' },
    colLocation: { width: '15%' },
    colAssignee: { width: '15%' },
  });

  const statTiles = (tiles: Array<{ label: string; value: number; danger?: boolean }>) =>
    h(View, { style: styles.tileRow },
      ...tiles.map((t, i) => h(View, { style: styles.tile, key: i },
        h(Text, { style: [styles.tileValue, t.danger && t.value > 0 ? styles.tileDanger : {}] }, String(t.value)),
        h(Text, { style: styles.tileLabel }, t.label),
      )),
    );

  const issuesTable = (items: ProgressReportPdfIssueRow[], emptyLabel: string) => {
    if (items.length === 0) return h(Text, { style: styles.emptyNote }, emptyLabel);
    return h(View, { style: styles.table },
      h(View, { style: styles.tableHeaderRow },
        h(Text, { style: [styles.tableHeaderCell, styles.colNumber] }, 'Number'),
        h(Text, { style: [styles.tableHeaderCell, styles.colTitle] }, 'Title'),
        h(Text, { style: [styles.tableHeaderCell, styles.colStatus] }, 'Status'),
        h(Text, { style: [styles.tableHeaderCell, styles.colPriority] }, 'Priority'),
        h(Text, { style: [styles.tableHeaderCell, styles.colLocation] }, 'Location'),
        h(Text, { style: [styles.tableHeaderCell, styles.colAssignee] }, 'Assigned To'),
      ),
      ...items.map((item, i) => h(View, { style: styles.tableRow, key: i },
        h(Text, { style: [styles.tableCell, styles.colNumber] }, item.issueNumber),
        h(Text, { style: [styles.tableCell, styles.colTitle] }, item.title),
        h(Text, { style: [styles.tableCell, styles.colStatus] }, capitalize(item.status)),
        h(Text, { style: [styles.tableCell, styles.colPriority] }, capitalize(item.priority)),
        h(Text, { style: [styles.tableCell, styles.colLocation] }, item.locationName ?? '—'),
        h(Text, { style: [styles.tableCell, styles.colAssignee] }, item.assignedToName ?? '—'),
      )),
    );
  };

  const captureGrid = () => {
    if (data.captures.length === 0) return h(Text, { style: styles.emptyNote }, 'No captures in this date range.');
    return h(View, { style: styles.captureGrid },
      ...data.captures.map((c, i) => h(View, { style: styles.captureCard, key: i },
        c.imageBuffer
          ? h(Image, { style: styles.captureImage, src: c.imageBuffer })
          : h(View, { style: styles.captureImagePlaceholder }),
        h(Text, { style: styles.captureCaption }, `${c.locationName ?? c.title ?? 'Capture'} · ${new Date(c.capturedAt).toLocaleDateString('en-GB')}`),
      )),
    );
  };

  const projectEyebrowText = data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName;
  const scopeParts = [data.buildingName, data.levelName].filter(Boolean);
  const dateRangeText = `${new Date(data.dateFrom).toLocaleDateString('en-GB')} – ${new Date(data.dateTo).toLocaleDateString('en-GB')}`;
  const subtitleText = scopeParts.length > 0 ? `${scopeParts.join(' · ')} · ${dateRangeText}` : dateRangeText;

  return renderToBuffer(
    h(Document, { title: `${data.projectName} — Progress Report` },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          h(Text, { style: styles.projectEyebrow }, projectEyebrowText),
          h(Text, { style: styles.title }, 'PROGRESS REPORT'),
          h(Text, { style: styles.subtitle }, subtitleText),
          h(Text, { style: styles.generatedAt }, `Generated ${data.generatedAt}`),
        ),

        statTiles([
          { label: 'Captures', value: data.captures.length },
          { label: 'New Issues', value: data.newIssues.length },
          { label: 'Closed Issues', value: data.closedIssues.length },
          { label: 'Overdue Issues', value: data.overdueIssues.length, danger: true },
          { label: 'Blockers', value: data.blockers.length, danger: true },
        ]),

        h(Text, { style: styles.sectionHeading }, 'Captures'),
        captureGrid(),

        h(Text, { style: styles.sectionHeading }, 'New Issues'),
        issuesTable(data.newIssues, 'No new issues in this date range.'),

        h(Text, { style: styles.sectionHeading }, 'Closed Issues'),
        issuesTable(data.closedIssues, 'No issues closed in this date range.'),

        h(Text, { style: styles.sectionHeading }, 'Overdue Issues'),
        issuesTable(data.overdueIssues, 'No overdue issues.'),

        h(Text, { style: styles.sectionHeading }, 'Blockers'),
        issuesTable(data.blockers, 'No critical/high-priority open issues.'),
      ),
    ),
  );
}
