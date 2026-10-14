import { createElement as h } from 'react';

// @react-pdf/renderer is ESM-only; this API compiles to CommonJS, so it is
// loaded via dynamic import() inside renderQaqcPdf() -- same convention as
// rfi-pdf.template.ts, so qaqc.service.ts/qaqc.controller.ts stay free of
// PDF-library specifics.

// ── Brand ────────────────────────────────────────────────────────────────
// Identical palette/font-registration to rfi-pdf.template.ts, for visual
// consistency across every generated PDF in this app (see that file's own
// comment for the full rationale -- mirrors apps/web/tailwind.config.js's
// "Blueprint-dark technical palette").
const INK = '#0A141C';
const INK_MUTED = '#4A6178';
const BORDER = '#B9C6CE';
const SECTION_FILL = '#EAF0F4';
const SIGNAL = '#E56A1F';
const BLUEPRINT = '#1E6E93';

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
  // IBM Plex Mono deliberately not registered -- see rfi-pdf.template.ts's
  // own comment: its current "latin" WOFF build crashes on a bare space.
  Font.registerHyphenationCallback((word) => [word]);
}

const RECORD_TYPE_TITLE: Record<'ncr' | 'sor', string> = {
  ncr: 'NON-CONFORMANCE REPORT',
  sor: 'SITE OBSERVATION REPORT',
};

const STATUS_COLOR: Record<string, string> = {
  open: SIGNAL,
  responded: BLUEPRINT,
  closed: '#3A7D44',
  void: INK_MUTED,
};

export interface QaqcPdfData {
  recordNumber: string;
  recordType: 'ncr' | 'sor';
  status: string;
  priority: string;
  subject: string;
  description: string;
  response?: string;
  disciplineLabel: string;
  disciplineOther?: string;
  projectName: string;
  projectCode?: string;
  issuedByName?: string;
  createdAt: string;
  assignedToName?: string;
  dueDate?: string;
  closedByName?: string;
  closedAt?: string;
}

export async function renderQaqcPdf(data: QaqcPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'IBM Plex Sans', color: INK },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    projectEyebrow: { fontSize: 7.5, fontFamily: 'IBM Plex Sans', fontWeight: 600, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    title: { fontSize: 15, fontFamily: 'IBM Plex Sans', fontWeight: 700, letterSpacing: 0.3 },
    recordNumber: { fontSize: 12, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: SIGNAL, marginTop: 3, letterSpacing: 0.2 },
    badge: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, padding: '3 8', borderRadius: 2, backgroundColor: SECTION_FILL, textTransform: 'uppercase', letterSpacing: 0.4 },
    section: { border: `1 solid ${BORDER}`, borderRadius: 3, padding: 10, marginBottom: 10 },
    sectionTitle: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, textTransform: 'uppercase', color: BLUEPRINT, marginBottom: 6, letterSpacing: 0.6 },
    row: { flexDirection: 'row', marginBottom: 4 },
    col: { flex: 1, paddingRight: 8 },
    label: { fontSize: 8, color: INK_MUTED, marginBottom: 1 },
    value: { fontSize: 9.5 },
    bodyText: { fontSize: 9.5, lineHeight: 1.5 },
    footerRow: { flexDirection: 'row', marginTop: 16, paddingTop: 10, borderTop: `1 solid ${BORDER}` },
    footerCol: { flex: 1 },
    footerLabel: { fontSize: 8, color: INK_MUTED, marginBottom: 2 },
    footerValue: { fontSize: 9, fontFamily: 'IBM Plex Sans', fontWeight: 600 },
  });

  const field = (label: string, value?: string) =>
    h(View, { style: styles.col, key: label },
      h(Text, { style: styles.label }, label),
      h(Text, { style: styles.value }, value || '—'),
    );

  const disciplineDisplay = data.disciplineOther
    ? `${data.disciplineLabel} — ${data.disciplineOther}`
    : data.disciplineLabel;

  const projectEyebrowText = data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName;

  return renderToBuffer(
    h(Document, { title: data.recordNumber },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          h(View, null,
            h(Text, { style: styles.projectEyebrow }, projectEyebrowText),
            h(Text, { style: styles.title }, RECORD_TYPE_TITLE[data.recordType]),
            h(Text, { style: styles.recordNumber }, data.recordNumber),
          ),
          h(Text, { style: [styles.badge, { color: STATUS_COLOR[data.status] ?? INK_MUTED }] }, data.status.toUpperCase()),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Details'),
          h(View, { style: styles.row },
            field('Subject', data.subject),
          ),
          h(View, { style: styles.row },
            field('Discipline', disciplineDisplay),
            field('Priority', data.priority.charAt(0).toUpperCase() + data.priority.slice(1)),
          ),
          h(View, { style: styles.row },
            field('Assigned To', data.assignedToName),
            field('Due Date', data.dueDate),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Description'),
          h(Text, { style: styles.bodyText }, data.description),
        ),

        data.response
          ? h(View, { style: styles.section },
              h(Text, { style: styles.sectionTitle }, 'Response'),
              h(Text, { style: styles.bodyText }, data.response),
            )
          : null,

        h(View, { style: styles.footerRow },
          h(View, { style: styles.footerCol },
            h(Text, { style: styles.footerLabel }, 'Raised By'),
            h(Text, { style: styles.footerValue }, `${data.issuedByName || '—'}  ·  ${data.createdAt}`),
          ),
          data.closedByName
            ? h(View, { style: styles.footerCol },
                h(Text, { style: styles.footerLabel }, 'Closed By'),
                h(Text, { style: styles.footerValue }, `${data.closedByName}  ·  ${data.closedAt || '—'}`),
              )
            : null,
        ),
      ),
    ),
  );
}
