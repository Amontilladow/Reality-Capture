import { createElement as h } from 'react';

// Same brand tokens as reports-pdf.template.ts -- kept as its own copy here
// rather than shared/exported, same convention that file's own header
// documents for its relationship to rfi-pdf.template.ts: RiskModule has no
// dependency on ReportsModule, and this is a small, self-contained
// renderer, not a shared component library.
const INK = '#0A141C';
const INK_MUTED = '#4A6178';
const BORDER = '#B9C6CE';
const SECTION_FILL = '#EAF0F4';
const SIGNAL = '#E56A1F';
const BLUEPRINT = '#1E6E93';
const AI_FILL = '#EEF3F8';

const LEVEL_COLORS: Record<string, string> = {
  LOW: '#2E8540', MODERATE: '#B8860B', HIGH: SIGNAL, CRITICAL: '#B3261E',
};

const CHART_PALETTE = [SIGNAL, BLUEPRINT, '#2E8540', '#B8860B', '#8B3A62', INK_MUTED];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

// @react-pdf/renderer is ESM-only; dynamic import() mirrors
// reports-pdf.template.ts's own reasoning exactly (this compiles to
// CommonJS via apps/api/.swcrc).
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

export interface RiskPdfTopRisk {
  title: string;
  category: string;
  discipline?: string;
  score: number;
  level: string;
  status: string;
  trend: string;
}

export interface RiskPdfByGroup {
  label: string;
  count: number;
}

export interface RiskPdfCluster {
  location: string;
  connectedRiskCount: number;
  averageScore: number;
}

export interface RiskPdfData {
  projectName: string;
  projectCode?: string;
  generatedAt: string;
  overallScore: number;
  overallLevel: string;
  overallScoreTrendPct: number | null;
  criticalCount: number;
  highCount: number;
  increasingCount: number;
  overdueCount: number;
  totalOpenRisks: number;
  byDiscipline: RiskPdfByGroup[];
  clusters: RiskPdfCluster[];
  topRisks: RiskPdfTopRisk[];
  register: RiskPdfTopRisk[];
  // Verbatim text of the AI briefing the user already generated on the
  // Risk tab (never re-generated here) -- omitted entirely, not replaced
  // with a placeholder, when no briefing was ever generated.
  aiBriefing?: string;
  // Honest per-source availability, straight from
  // RiskService.getDataAvailability() -- never summarized or reworded, so
  // an unconnected module (Programme, Procurement) reads exactly as
  // "Not connected" here too, never omitted or implied to exist.
  dataAvailabilityNotes: string[];
}

export async function renderRiskPdf(data: RiskPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, Svg, Rect, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'IBM Plex Sans', color: INK },
    headerRow: { marginBottom: 14, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    projectEyebrow: { fontSize: 7.5, fontFamily: 'IBM Plex Sans', fontWeight: 600, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    title: { fontSize: 16, fontFamily: 'IBM Plex Sans', fontWeight: 700, letterSpacing: 0.3 },
    generatedAt: { fontSize: 8, color: INK_MUTED, marginTop: 3 },

    sectionHeading: { fontSize: 12, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: BLUEPRINT, marginBottom: 8, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

    tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
    tile: { border: `1 solid ${BORDER}`, borderRadius: 3, backgroundColor: SECTION_FILL, padding: '6 10', minWidth: 74 },
    tileValue: { fontSize: 15, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: INK },
    tileLabel: { fontSize: 7, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },

    aiCard: { border: `1 solid ${BLUEPRINT}`, borderRadius: 3, backgroundColor: AI_FILL, padding: 10, marginBottom: 4 },
    aiCardLabel: { fontSize: 7, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: BLUEPRINT, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
    aiCardDisclaimer: { fontSize: 6.5, color: INK_MUTED, marginBottom: 6 },
    aiCardBody: { fontSize: 8.5, lineHeight: 1.4 },

    chartCard: { border: `1 solid ${BORDER}`, borderRadius: 3, padding: 8, marginBottom: 4 },
    chartTitle: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
    barValuesRow: { flexDirection: 'row' },
    barValueCell: { textAlign: 'center', fontSize: 6.5, color: INK },
    barLabelsRow: { flexDirection: 'row', marginTop: 2 },
    barLabelCell: { textAlign: 'center', fontSize: 6, color: INK_MUTED },

    emptyNote: { fontSize: 8, color: INK_MUTED },

    table: { marginTop: 4, marginBottom: 8 },
    tableHeaderRow: { flexDirection: 'row', backgroundColor: SECTION_FILL, borderBottom: `1 solid ${BORDER}`, paddingVertical: 3 },
    tableRow: { flexDirection: 'row', borderBottom: `1 solid ${BORDER}`, paddingVertical: 3 },
    tableHeaderCell: { fontSize: 7, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.3, paddingHorizontal: 3 },
    tableCell: { fontSize: 7.5, paddingHorizontal: 3 },
    colTitle: { width: '34%' },
    colCategory: { width: '20%' },
    colScore: { width: '10%', textAlign: 'center' },
    colLevel: { width: '13%' },
    colStatus: { width: '13%' },
    colTrend: { width: '10%' },

    clusterRow: { flexDirection: 'row', borderBottom: `1 solid ${BORDER}`, paddingVertical: 3 },
    clusterLocation: { width: '50%', fontSize: 7.5 },
    clusterCount: { width: '25%', fontSize: 7.5, textAlign: 'center' },
    clusterScore: { width: '25%', fontSize: 7.5, textAlign: 'center' },

    availabilityLine: { fontSize: 7.5, color: INK_MUTED, marginBottom: 2 },
  });

  const statTiles = (tiles: Array<{ label: string; value: string | number; color?: string }>) =>
    h(View, { style: styles.tileRow },
      ...tiles.map((t, i) => h(View, { style: styles.tile, key: i },
        h(Text, { style: [styles.tileValue, t.color ? { color: t.color } : {}] }, String(t.value)),
        h(Text, { style: styles.tileLabel }, t.label),
      )),
    );

  const barChart = (entries: Array<[string, number]>, width = 460, height = 60) => {
    if (entries.length === 0) return h(Text, { style: styles.emptyNote }, 'No data');
    const max = Math.max(1, ...entries.map(([, count]) => count));
    const gap = 8;
    const barWidth = Math.max(14, (width - gap * (entries.length - 1)) / entries.length);
    const slotWidth = barWidth + gap;

    const bars = entries.map(([, count], i) => {
      const barHeight = Math.max(1, (count / max) * height);
      return h(Rect, {
        key: i, x: i * slotWidth, y: height - barHeight, width: barWidth, height: barHeight,
        fill: CHART_PALETTE[i % CHART_PALETTE.length],
      });
    });

    return h(View, null,
      h(View, { style: styles.barValuesRow },
        ...entries.map(([, count], i) => h(Text, { style: [styles.barValueCell, { width: slotWidth }], key: i }, String(count))),
      ),
      h(Svg, { width: entries.length * slotWidth, height, viewBox: `0 0 ${entries.length * slotWidth} ${height}` }, ...bars),
      h(View, { style: styles.barLabelsRow },
        ...entries.map(([label], i) => h(Text, { style: [styles.barLabelCell, { width: slotWidth }], key: i }, capitalize(label).slice(0, 14))),
      ),
    );
  };

  const risksTable = (rows: RiskPdfTopRisk[], emptyLabel: string) => {
    if (rows.length === 0) return h(Text, { style: styles.emptyNote }, emptyLabel);
    return h(View, { style: styles.table },
      h(View, { style: styles.tableHeaderRow },
        h(Text, { style: [styles.tableHeaderCell, styles.colTitle] }, 'Risk'),
        h(Text, { style: [styles.tableHeaderCell, styles.colCategory] }, 'Category'),
        h(Text, { style: [styles.tableHeaderCell, styles.colScore] }, 'Score'),
        h(Text, { style: [styles.tableHeaderCell, styles.colLevel] }, 'Level'),
        h(Text, { style: [styles.tableHeaderCell, styles.colStatus] }, 'Status'),
        h(Text, { style: [styles.tableHeaderCell, styles.colTrend] }, 'Trend'),
      ),
      ...rows.map((r, i) => h(View, { style: styles.tableRow, key: i },
        h(Text, { style: [styles.tableCell, styles.colTitle] }, r.title),
        h(Text, { style: [styles.tableCell, styles.colCategory] }, r.discipline ? `${r.category} (${r.discipline})` : r.category),
        h(Text, { style: [styles.tableCell, styles.colScore] }, String(r.score)),
        h(Text, { style: [styles.tableCell, styles.colLevel, { color: LEVEL_COLORS[r.level] ?? INK, fontFamily: 'IBM Plex Sans', fontWeight: 700 }] }, capitalize(r.level)),
        h(Text, { style: [styles.tableCell, styles.colStatus] }, capitalize(r.status)),
        h(Text, { style: [styles.tableCell, styles.colTrend] }, capitalize(r.trend)),
      )),
    );
  };

  const clustersList = (clusters: RiskPdfCluster[]) => {
    if (clusters.length === 0) return h(Text, { style: styles.emptyNote }, 'No risk clusters detected.');
    return h(View, { style: styles.table },
      h(View, { style: styles.tableHeaderRow },
        h(Text, { style: [styles.tableHeaderCell, styles.clusterLocation] }, 'Location'),
        h(Text, { style: [styles.tableHeaderCell, styles.clusterCount] }, 'Connected Risks'),
        h(Text, { style: [styles.tableHeaderCell, styles.clusterScore] }, 'Avg. Score'),
      ),
      ...clusters.map((c, i) => h(View, { style: styles.clusterRow, key: i },
        h(Text, { style: styles.clusterLocation }, c.location),
        h(Text, { style: styles.clusterCount }, String(c.connectedRiskCount)),
        h(Text, { style: styles.clusterScore }, String(c.averageScore)),
      )),
    );
  };

  const trendTile = data.overallScoreTrendPct !== null
    ? { label: '7-Day Trend', value: `${data.overallScoreTrendPct > 0 ? '+' : ''}${data.overallScoreTrendPct}%`, color: data.overallScoreTrendPct > 0 ? SIGNAL : '#2E8540' }
    : { label: '7-Day Trend', value: 'N/A' };

  const projectEyebrowText = data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName;

  return renderToBuffer(
    h(Document, { title: `${data.projectName} — Project Risk Intelligence Report` },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          h(Text, { style: styles.projectEyebrow }, projectEyebrowText),
          h(Text, { style: styles.title }, 'PROJECT RISK INTELLIGENCE REPORT'),
          h(Text, { style: styles.generatedAt }, `Generated ${data.generatedAt}`),
        ),

        h(Text, { style: [styles.sectionHeading, { marginTop: 0 }] }, 'Executive Summary'),
        statTiles([
          { label: 'Overall Score', value: `${data.overallScore}/100` },
          { label: 'Overall Level', value: capitalize(data.overallLevel), color: LEVEL_COLORS[data.overallLevel] },
          trendTile,
          { label: 'Open Risks', value: data.totalOpenRisks },
          { label: 'Critical', value: data.criticalCount, color: data.criticalCount > 0 ? LEVEL_COLORS.CRITICAL : undefined },
          { label: 'High', value: data.highCount, color: data.highCount > 0 ? LEVEL_COLORS.HIGH : undefined },
          { label: 'Increasing', value: data.increasingCount },
          { label: 'Overdue', value: data.overdueCount, color: data.overdueCount > 0 ? LEVEL_COLORS.CRITICAL : undefined },
        ]),

        data.aiBriefing
          ? h(View, { style: styles.aiCard, wrap: false },
              h(Text, { style: styles.aiCardLabel }, 'AI-Generated Briefing'),
              h(Text, { style: styles.aiCardDisclaimer }, 'Grounded entirely in the deterministic data above and the risks/clusters listed in this report — generated once, on request, and reproduced here verbatim.'),
              h(Text, { style: styles.aiCardBody }, data.aiBriefing),
            )
          : null,

        h(Text, { style: styles.sectionHeading }, 'Risk by Discipline'),
        h(View, { style: styles.chartCard },
          barChart(data.byDiscipline.map((g) => [g.label, g.count] as [string, number])),
        ),

        h(Text, { style: styles.sectionHeading }, 'Risk Clusters'),
        clustersList(data.clusters),

        h(Text, { style: styles.sectionHeading }, 'Top Risks'),
        risksTable(data.topRisks, 'No open risks currently recorded.'),

        h(Text, { style: styles.sectionHeading }, 'Full Risk Register (Open)'),
        risksTable(data.register, 'No open risks currently recorded.'),

        h(Text, { style: styles.sectionHeading }, 'Data Sources'),
        ...data.dataAvailabilityNotes.map((line, i) => h(Text, { style: styles.availabilityLine, key: i }, line)),
      ),
    ),
  );
}
