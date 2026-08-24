import { createElement as h } from 'react';

// status/priority/discipline/trade arrive as raw lowercase DB enum values
// ('critical', 'in_progress') -- same reasoning as rfi-pdf.template.ts's own
// capitalize(): no shared label map exists for every one of these across
// Issues + Snagging, so a plain capitalize is used here for display.
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

// @react-pdf/renderer is ESM-only ("type": "module" in its package.json);
// this API compiles to CommonJS (see apps/api/.swcrc), so it must be loaded
// via dynamic import() rather than a static import -- a static import would
// compile to require(), which cannot load an ESM package. Mirrors
// rfi-pdf.template.ts's own dynamic-import structure exactly.

// ── Brand ────────────────────────────────────────────────────────────────
// Reused verbatim from rfi-pdf.template.ts so a printed Reports PDF reads as
// the same product as the RFI PDF, not a different-looking export.
const INK = '#0A141C';
const INK_MUTED = '#4A6178';
const BORDER = '#B9C6CE';
const SECTION_FILL = '#EAF0F4';
const SIGNAL = '#E56A1F';
const BLUEPRINT = '#1E6E93';

// Small fixed palette for chart categories -- SIGNAL/BLUEPRINT (the two
// brand accents) plus three more tones chosen to stay legible in a legend
// printed on white paper. Cycled by index, not semantically bound to any
// particular status/priority value (categories are open-ended enum values
// across two different tables, so a fixed status->color map isn't practical
// here the way rfi-pdf.template.ts's IMPACT_COLORS is for its 4-value enum).
const CHART_PALETTE = [SIGNAL, BLUEPRINT, '#2E8540', '#B8860B', '#8B3A62', INK_MUTED];

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
  // IBM Plex Mono deliberately NOT registered -- see rfi-pdf.template.ts's
  // comment on this exact same line for the fontkit crash this avoids.
  Font.registerHyphenationCallback((word) => [word]);
}

// ── Chart geometry (pie) ─────────────────────────────────────────────────
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function pieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

export interface ReportsPdfOpenItem {
  number: string;
  title: string;
  status: string;
  priority: string;
  category?: string;
  dueDate?: string;
  assignedToName?: string;
}

export interface ReportsPdfSectionData {
  title: string;
  summaryTiles: Array<{ label: string; value: number | string }>;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  categoryLabel: string;
  openItems: ReportsPdfOpenItem[];
}

export interface ReportsPdfData {
  projectName: string;
  projectCode?: string;
  generatedAt: string;
  issues: ReportsPdfSectionData;
  snagging: ReportsPdfSectionData;
}

export async function renderReportsPdf(data: ReportsPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, Svg, Path, Rect, Circle, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'IBM Plex Sans', color: INK },
    headerRow: { marginBottom: 14, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    projectEyebrow: { fontSize: 7.5, fontFamily: 'IBM Plex Sans', fontWeight: 600, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    title: { fontSize: 16, fontFamily: 'IBM Plex Sans', fontWeight: 700, letterSpacing: 0.3 },
    generatedAt: { fontSize: 8, color: INK_MUTED, marginTop: 3 },

    sectionHeading: { fontSize: 12, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: BLUEPRINT, marginBottom: 8, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },

    tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    tile: { border: `1 solid ${BORDER}`, borderRadius: 3, backgroundColor: SECTION_FILL, padding: '6 10', minWidth: 68 },
    tileValue: { fontSize: 15, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: INK },
    tileLabel: { fontSize: 7, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

    chartsRow: { flexDirection: 'row', gap: 14, marginBottom: 12 },
    chartCard: { flex: 1, border: `1 solid ${BORDER}`, borderRadius: 3, padding: 8 },
    chartTitle: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
    pieRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    legendCol: { flex: 1 },
    legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
    legendSwatch: { width: 7, height: 7, borderRadius: 1, marginRight: 4 },
    legendLabel: { fontSize: 7.5 },

    barValuesRow: { flexDirection: 'row' },
    barValueCell: { textAlign: 'center', fontSize: 6.5, color: INK },
    barLabelsRow: { flexDirection: 'row', marginTop: 2 },
    barLabelCell: { textAlign: 'center', fontSize: 6, color: INK_MUTED },

    emptyNote: { fontSize: 8, color: INK_MUTED },

    table: { marginTop: 4, marginBottom: 14 },
    tableHeaderRow: { flexDirection: 'row', backgroundColor: SECTION_FILL, borderBottom: `1 solid ${BORDER}`, paddingVertical: 3 },
    tableRow: { flexDirection: 'row', borderBottom: `1 solid ${BORDER}`, paddingVertical: 3 },
    tableHeaderCell: { fontSize: 7, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.3, paddingHorizontal: 3 },
    tableCell: { fontSize: 7.5, paddingHorizontal: 3 },
    colNumber: { width: '14%' },
    colTitle: { width: '30%' },
    colStatus: { width: '13%' },
    colPriority: { width: '13%' },
    colCategory: { width: '15%' },
    colAssignee: { width: '15%' },
  });

  const toEntries = (rec: Record<string, number>) => Object.entries(rec).filter(([, count]) => count > 0);

  // Pie chart: fixed-size Svg (Path per non-zero slice) plus a plain
  // flexbox legend -- SVG-nested <Text> labels were avoided deliberately
  // (@react-pdf/types' SVGPresentationAttributes has no fontSize field, so
  // precisely-sized in-SVG labels aren't practically typeable here); the
  // legend achieves the same "which slice is which" readout via ordinary
  // Text instead. Skips the arc entirely when total===0, per the spec, and
  // renders a full Circle for the degenerate single-100%-category case
  // (a 360-degree arc command is itself degenerate in the standard SVG arc
  // algorithm).
  const pieChart = (entries: Array<[string, number]>, size = 96) => {
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    if (total === 0) return h(Text, { style: styles.emptyNote }, 'No data');

    const r = size / 2 - 2;
    const cx = size / 2;
    const cy = size / 2;
    let angle = 0;
    const slices = entries.map(([, count], i) => {
      const sweep = (360 * count) / total;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      const color = CHART_PALETTE[i % CHART_PALETTE.length];
      if (sweep >= 359.99) return h(Circle, { key: i, cx, cy, r, fill: color });
      return h(Path, { key: i, d: pieSlicePath(cx, cy, r, start, end), fill: color });
    });
    const legend = entries.map(([label, count], i) =>
      h(View, { style: styles.legendRow, key: i },
        h(View, { style: [styles.legendSwatch, { backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }] }),
        h(Text, { style: styles.legendLabel }, `${capitalize(label)} (${count})`),
      ),
    );
    return h(View, { style: styles.pieRow },
      h(Svg, { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, ...slices),
      h(View, { style: styles.legendCol }, ...legend),
    );
  };

  // Bar chart: a fixed-height Svg of Rects only (same fontSize-typing
  // reasoning as pieChart() above), with the value/category labels rendered
  // as two ordinary flexbox rows immediately above/below it -- each cell in
  // those rows is given the exact same width as one bar+gap slot, so the
  // value sits above, and the label sits below, its own bar.
  const barChart = (entries: Array<[string, number]>, width = 200, height = 70) => {
    if (entries.length === 0) return h(Text, { style: styles.emptyNote }, 'No data');
    const max = Math.max(1, ...entries.map(([, count]) => count));
    const gap = 6;
    const barWidth = Math.max(12, (width - gap * (entries.length - 1)) / entries.length);
    const slotWidth = barWidth + gap;

    const bars = entries.map(([, count], i) => {
      const barHeight = Math.max(1, (count / max) * height);
      return h(Rect, {
        key: i,
        x: i * slotWidth,
        y: height - barHeight,
        width: barWidth,
        height: barHeight,
        fill: CHART_PALETTE[i % CHART_PALETTE.length],
      });
    });

    return h(View, null,
      h(View, { style: styles.barValuesRow },
        ...entries.map(([, count], i) => h(Text, { style: [styles.barValueCell, { width: slotWidth }], key: i }, String(count))),
      ),
      h(Svg, { width: entries.length * slotWidth, height, viewBox: `0 0 ${entries.length * slotWidth} ${height}` }, ...bars),
      h(View, { style: styles.barLabelsRow },
        ...entries.map(([label], i) => h(Text, { style: [styles.barLabelCell, { width: slotWidth }], key: i }, capitalize(label).slice(0, 10))),
      ),
    );
  };

  const statTiles = (tiles: Array<{ label: string; value: number | string }>) =>
    h(View, { style: styles.tileRow },
      ...tiles.map((t, i) => h(View, { style: styles.tile, key: i },
        h(Text, { style: styles.tileValue }, String(t.value)),
        h(Text, { style: styles.tileLabel }, t.label),
      )),
    );

  const openItemsTable = (items: ReportsPdfOpenItem[], categoryLabel: string) => {
    if (items.length === 0) return h(Text, { style: styles.emptyNote }, 'No open items.');
    return h(View, { style: styles.table },
      h(View, { style: styles.tableHeaderRow },
        h(Text, { style: [styles.tableHeaderCell, styles.colNumber] }, 'Number'),
        h(Text, { style: [styles.tableHeaderCell, styles.colTitle] }, 'Title'),
        h(Text, { style: [styles.tableHeaderCell, styles.colStatus] }, 'Status'),
        h(Text, { style: [styles.tableHeaderCell, styles.colPriority] }, 'Priority'),
        h(Text, { style: [styles.tableHeaderCell, styles.colCategory] }, categoryLabel),
        h(Text, { style: [styles.tableHeaderCell, styles.colAssignee] }, 'Assigned To'),
      ),
      ...items.map((item, i) => h(View, { style: styles.tableRow, key: i },
        h(Text, { style: [styles.tableCell, styles.colNumber] }, item.number),
        h(Text, { style: [styles.tableCell, styles.colTitle] }, item.title),
        h(Text, { style: [styles.tableCell, styles.colStatus] }, capitalize(item.status)),
        h(Text, { style: [styles.tableCell, styles.colPriority] }, capitalize(item.priority)),
        h(Text, { style: [styles.tableCell, styles.colCategory] }, item.category ? capitalize(item.category) : '—'),
        h(Text, { style: [styles.tableCell, styles.colAssignee] }, item.assignedToName ?? '—'),
      )),
    );
  };

  const section = (sectionData: ReportsPdfSectionData) =>
    h(View, { wrap: false },
      h(Text, { style: styles.sectionHeading }, sectionData.title),
      statTiles(sectionData.summaryTiles),
      h(View, { style: styles.chartsRow },
        h(View, { style: styles.chartCard },
          h(Text, { style: styles.chartTitle }, 'By Status'),
          pieChart(toEntries(sectionData.byStatus)),
        ),
        h(View, { style: styles.chartCard },
          h(Text, { style: styles.chartTitle }, 'By Priority'),
          barChart(toEntries(sectionData.byPriority)),
        ),
        h(View, { style: styles.chartCard },
          h(Text, { style: styles.chartTitle }, `By ${sectionData.categoryLabel}`),
          barChart(toEntries(sectionData.byCategory)),
        ),
      ),
      h(Text, { style: [styles.chartTitle, { marginTop: 4 }] }, `Currently Open ${sectionData.title}`),
      openItemsTable(sectionData.openItems, sectionData.categoryLabel),
    );

  const projectEyebrowText = data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName;

  return renderToBuffer(
    h(Document, { title: `${data.projectName} — Report` },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          h(Text, { style: styles.projectEyebrow }, projectEyebrowText),
          h(Text, { style: styles.title }, 'PROJECT REPORT'),
          h(Text, { style: styles.generatedAt }, `Generated ${data.generatedAt}`),
        ),
        section(data.issues),
        section(data.snagging),
      ),
    ),
  );
}
