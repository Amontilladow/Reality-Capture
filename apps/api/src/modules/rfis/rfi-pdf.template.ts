import { createElement as h } from 'react';
import { RFI_DOCUMENT_TYPE_LABELS, type RfiDocumentType } from '@engineeringos/types';

// question/answer are stored as HTML from the RichTextEditor (Phase 3) --
// this is a static generated document, not a browser, so there's no HTML
// renderer to hand it to. Converts Tiptap's StarterKit output (paragraphs,
// headings, lists, bold/italic marks -- no tables, images, or anything else
// this editor doesn't produce) to plain text with real line breaks, rather
// than leaking raw tags like "<p>...</p>" into the PDF. Pre-Phase-3 rows
// with plain text (no tags at all) pass through unchanged.
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

// @react-pdf/renderer is ESM-only ("type": "module" in its package.json);
// this API compiles to CommonJS (see apps/api/.swcrc), so it must be loaded
// via dynamic import() rather than a static import -- a static import would
// compile to require(), which cannot load an ESM package. Kept as the one
// place in this module that knows about @react-pdf/renderer at all, so
// rfis.service.ts / rfis.controller.ts stay free of PDF-library specifics.

// ── Brand ────────────────────────────────────────────────────────────────
// Mirrors apps/web/tailwind.config.js exactly ("Blueprint-dark technical
// palette -- surveying/drafting instrument feel") so a printed RFI reads as
// the same product as the live app, not a generic slate-and-blue template.
// A generated document is printed on white paper, not the app's own dark
// background, so INK/BASE tones are used here as foreground text/border
// colors against white rather than as backgrounds -- the palette is the
// same, the ground it sits on is just inverted, same as any print
// letterhead vs. its parent app's on-screen theme.
const INK = '#0A141C';       // base-950 -- primary body text
const INK_MUTED = '#4A6178'; // base-500 -- secondary text/labels
const BORDER = '#B9C6CE';    // a lighter tint of base-500 -- print-legible hairline
const SECTION_FILL = '#EAF0F4'; // ink-100 -- the app's own light tone, reused as a tint
const SIGNAL = '#E56A1F';    // signal, darkened ~15% for print contrast on white
const BLUEPRINT = '#1E6E93'; // blueprint, darkened for print contrast on white

// Real product fonts (IBM Plex Sans/Mono, self-hosted via @fontsource --
// same family the live app loads from Google Fonts in index.html) rather
// than the PDF's own default Helvetica. Registered once per process, not
// per render -- Font.register on every request would just redundantly
// re-parse the same font files.
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
  // IBM Plex Mono deliberately NOT registered here -- @fontsource's current
  // "latin" WOFF build of it crashes fontkit's glyph-metrics parser on the
  // plain space character ("Offset is outside the bounds of the DataView"),
  // confirmed by isolating it: IBM Plex Sans (all 3 weights, special
  // characters, real content) renders cleanly, the exact same test with
  // Mono fails on any string containing a space. Since every real value
  // here (RFI numbers, stamps, filenames) contains spaces or is adjacent to
  // text that does, Mono is unusable as shipped. Sans is used everywhere
  // instead, with weight standing in for the monospace emphasis the live
  // app gives these fields.
  // react-pdf/yoga hyphenates justified text by default using a wordlist
  // this custom font doesn't need -- disabling avoids odd mid-word breaks.
  Font.registerHyphenationCallback((word) => [word]);
}

// Phase 5 additions -- the 5 named-organization logos (project_organizations,
// Phase 4), the two upload stamps (query_stamp/answer_stamp, Phase 1), and
// the query/response attachment lists (rfi_attachments.kind, Phase 2). All
// optional: an RFI with none of this configured/reached renders exactly as
// it did before this phase.
export interface RfiPdfOrgLogo {
  slot: string;
  label: string;
  buffer: Buffer;
}

export interface RfiPdfUploadStamp {
  uploadedBy?: string;
  dateTime?: string;
  stamp: string;
}

export interface RfiPdfAttachmentItem {
  filename: string;
  documentType?: RfiDocumentType;
  documentTypeOther?: string;
}

export interface RfiPdfData {
  logoBuffer?: Buffer;
  stampBuffer?: Buffer;
  organizations?: RfiPdfOrgLogo[];
  queryStamp?: RfiPdfUploadStamp;
  answerStamp?: RfiPdfUploadStamp;
  queryAttachments?: RfiPdfAttachmentItem[];
  responseAttachments?: RfiPdfAttachmentItem[];
  rfiNumber: string;
  status: string;
  priority: string;
  subject: string;
  question: string;
  answer?: string;
  disciplineLabel: string;
  disciplineOther?: string;
  costImpact: boolean;
  timeImpact: boolean;
  projectName: string;
  projectCode?: string;
  location?: string;
  date: string;
  clientName?: string;
  leadDesigner?: string;
  consultantName?: string;
  technicalAdvisor?: string;
  pmcName?: string;
  mainContractor?: string;
  subcontractor?: string;
  createdByName?: string;
  createdAt: string;
  answeredByName?: string;
  answeredAt?: string;
}

// prettier-ignore
const FIELD_ROWS: Array<[string, keyof RfiPdfData]> = [
  ['Client', 'clientName'],
  ['Lead Designer', 'leadDesigner'],
  ['Consultant', 'consultantName'],
  ['Technical Advisor', 'technicalAdvisor'],
  ['PMC', 'pmcName'],
  ['Main Contractor', 'mainContractor'],
  ['Subcontractor', 'subcontractor'],
];

export async function renderRfiPdf(data: RfiPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'IBM Plex Sans', color: INK },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    headerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    logo: { width: 44, height: 44, objectFit: 'contain' },
    stamp: { width: 70, height: 70, objectFit: 'contain', marginBottom: 4 },
    title: { fontSize: 15, fontFamily: 'IBM Plex Sans', fontWeight: 700, letterSpacing: 0.3 },
    rfiNumber: { fontSize: 12, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: SIGNAL, marginTop: 3, letterSpacing: 0.2 },
    badge: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, padding: '3 8', borderRadius: 2, backgroundColor: SECTION_FILL, color: BLUEPRINT, textTransform: 'uppercase', letterSpacing: 0.4 },
    section: { border: `1 solid ${BORDER}`, borderRadius: 3, padding: 10, marginBottom: 10 },
    sectionTitle: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, textTransform: 'uppercase', color: BLUEPRINT, marginBottom: 6, letterSpacing: 0.6 },
    row: { flexDirection: 'row', marginBottom: 4 },
    col: { flex: 1, paddingRight: 8 },
    label: { fontSize: 8, color: INK_MUTED, marginBottom: 1 },
    value: { fontSize: 9.5 },
    checkboxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    checkboxItem: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 12, marginBottom: 4 },
    checkbox: { width: 9, height: 9, border: `1 solid ${INK}` },
    checkboxChecked: { width: 9, height: 9, border: `1 solid ${SIGNAL}`, backgroundColor: SIGNAL },
    impactRow: { flexDirection: 'row', gap: 24 },
    bodyText: { fontSize: 9.5, lineHeight: 1.5 },
    footerRow: { flexDirection: 'row', marginTop: 16, paddingTop: 10, borderTop: `1 solid ${BORDER}` },
    footerCol: { flex: 1 },
    footerLabel: { fontSize: 8, color: INK_MUTED, marginBottom: 12 },
    signatureLine: { borderTop: `1 solid ${INK_MUTED}`, paddingTop: 3, fontSize: 8.5, width: 160 },
    // 5-organization header row (Phase 5) -- sits alongside the existing
    // single authoring-party logo, not in place of it.
    orgRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
    orgItem: { alignItems: 'center', width: 52 },
    orgLogo: { width: 34, height: 34, objectFit: 'contain', marginBottom: 2 },
    orgLabel: { fontSize: 6, fontFamily: 'IBM Plex Sans', color: INK_MUTED, textAlign: 'center' },
    // Upload-stamp panels -- visually distinct bordered/shaded box, tinted
    // with the app's own light "ink-100" tone rather than a generic gray,
    // so it reads as a stamp, not another content section.
    stampPanel: { border: `1 solid ${SIGNAL}`, borderRadius: 3, backgroundColor: SECTION_FILL, padding: 8, marginBottom: 10 },
    stampTitle: { fontSize: 7, fontFamily: 'IBM Plex Sans', fontWeight: 700, textTransform: 'uppercase', color: SIGNAL, marginBottom: 4, letterSpacing: 0.6 },
    stampRow: { flexDirection: 'row', gap: 16 },
    stampCol: { flex: 1 },
    stampLabel: { fontSize: 7, color: INK_MUTED, marginBottom: 1 },
    stampValue: { fontSize: 8.5, fontFamily: 'IBM Plex Sans', fontWeight: 700 },
    // Query/response attachment lists -- plain text lines, not clickable
    // (this is a static generated document, not the live detail page).
    attachmentsBlock: { marginTop: 4 },
    attachmentsHeading: { fontSize: 7, fontFamily: 'IBM Plex Sans', fontWeight: 700, textTransform: 'uppercase', color: INK_MUTED, marginBottom: 2, letterSpacing: 0.6 },
    attachmentItem: { fontSize: 8.5, fontFamily: 'IBM Plex Sans', marginBottom: 1.5 },
  });

  const checkbox = (label: string, checked: boolean) =>
    h(View, { style: styles.checkboxItem, key: label },
      h(View, { style: checked ? styles.checkboxChecked : styles.checkbox }),
      h(Text, null, label),
    );

  const field = (label: string, value?: string) =>
    h(View, { style: styles.col, key: label },
      h(Text, { style: styles.label }, label),
      h(Text, { style: styles.value }, value || '—'),
    );

  const stampPanel = (title: string, s?: RfiPdfUploadStamp) =>
    s
      ? h(View, { style: styles.stampPanel },
          h(Text, { style: styles.stampTitle }, title),
          h(View, { style: styles.stampRow },
            h(View, { style: styles.stampCol },
              h(Text, { style: styles.stampLabel }, 'Uploaded By'),
              h(Text, { style: styles.stampValue }, s.uploadedBy || '—'),
            ),
            h(View, { style: styles.stampCol },
              h(Text, { style: styles.stampLabel }, 'Date-Time'),
              h(Text, { style: styles.stampValue }, s.dateTime || '—'),
            ),
            h(View, { style: styles.stampCol },
              h(Text, { style: styles.stampLabel }, 'Stamp'),
              h(Text, { style: styles.stampValue }, s.stamp),
            ),
          ),
        )
      : null;

  const attachmentLabel = (item: RfiPdfAttachmentItem) => {
    const typeLabel = item.documentType ? RFI_DOCUMENT_TYPE_LABELS[item.documentType] : 'Other';
    const otherSuffix = item.documentType === 'other' && item.documentTypeOther ? ` — ${item.documentTypeOther}` : '';
    return `• ${item.filename}  (${typeLabel}${otherSuffix})`;
  };

  const attachmentsBlock = (heading: string, items?: RfiPdfAttachmentItem[]) =>
    items && items.length > 0
      ? h(View, { style: styles.attachmentsBlock },
          h(Text, { style: styles.attachmentsHeading }, heading),
          ...items.map((item, i) => h(Text, { style: styles.attachmentItem, key: i }, attachmentLabel(item))),
        )
      : null;

  return renderToBuffer(
    h(Document, { title: data.rfiNumber },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          h(View, { style: styles.headerLeft },
            data.logoBuffer ? h(Image, { style: styles.logo, src: data.logoBuffer }) : null,
            h(View, null,
              h(Text, { style: styles.title }, 'REQUEST FOR INFORMATION'),
              h(Text, { style: styles.rfiNumber }, data.rfiNumber),
            ),
          ),
          h(Text, { style: styles.badge }, `${data.status} · ${data.priority}`),
        ),

        // 5-organization row (Phase 5) -- alongside, not replacing, the
        // single authoring-party logo above. Slots with no logo configured
        // are skipped entirely rather than rendering an empty placeholder
        // box (a generated PDF should look clean, not show interactive-UI
        // chrome meant for an empty state on screen).
        data.organizations && data.organizations.length > 0
          ? h(View, { style: styles.orgRow },
              ...data.organizations.map((org) => h(View, { style: styles.orgItem, key: org.slot },
                h(Image, { style: styles.orgLogo, src: org.buffer }),
                h(Text, { style: styles.orgLabel }, org.label),
              )),
            )
          : null,

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Project'),
          h(View, { style: styles.row },
            field('Project Name', data.projectName),
            field('Project No.', data.projectCode),
          ),
          h(View, { style: styles.row },
            field('Location', data.location),
            field('Date', data.date),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Stakeholders'),
          h(View, { style: styles.row }, ...FIELD_ROWS.slice(0, 3).map(([label, key]) => field(label, data[key] as string | undefined))),
          h(View, { style: styles.row }, ...FIELD_ROWS.slice(3, 6).map(([label, key]) => field(label, data[key] as string | undefined))),
          h(View, { style: styles.row }, field(FIELD_ROWS[6][0], data[FIELD_ROWS[6][1]] as string | undefined)),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'RFI Title'),
          h(Text, { style: styles.bodyText }, data.subject),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Discipline'),
          h(View, { style: styles.checkboxRow },
            ...['Civil', 'Structural', 'Architectural', 'Interior Design', 'Mechanical', 'Electrical', 'Plumbing', 'HVAC', 'Other']
              .map((label) => checkbox(label, data.disciplineLabel === label)),
          ),
          data.disciplineLabel === 'Other' && data.disciplineOther
            ? h(Text, { style: [styles.bodyText, { marginTop: 4 }] }, `Specified: ${data.disciplineOther}`)
            : null,
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Impact of Reply'),
          h(View, { style: styles.impactRow },
            checkbox('Cost Impact', data.costImpact),
            checkbox('Time Impact', data.timeImpact),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Query'),
          h(Text, { style: styles.bodyText }, richTextToPlain(data.question)),
          attachmentsBlock('Query Attachments', data.queryAttachments),
        ),
        stampPanel('Query Upload Stamp', data.queryStamp),

        data.answer
          ? h(View, { style: styles.section },
              h(Text, { style: styles.sectionTitle }, 'Response'),
              h(Text, { style: styles.bodyText }, richTextToPlain(data.answer)),
              attachmentsBlock('Response Attachments', data.responseAttachments),
            )
          : null,
        // Response attachments/stamp can exist even before the formal answer
        // text is submitted (a reviewer may pre-upload response documents
        // while still drafting) -- rendered unconditionally here so they
        // aren't hidden behind the data.answer gate above, but only when
        // there's actually something to show.
        !data.answer ? attachmentsBlock('Response Attachments', data.responseAttachments) : null,
        stampPanel('Answer Upload Stamp', data.answerStamp),

        h(View, { style: styles.footerRow },
          h(View, { style: styles.footerCol },
            h(Text, { style: styles.footerLabel }, `Raised by: ${data.createdByName ?? '—'}  ·  ${data.createdAt}`),
            h(Text, { style: styles.signatureLine }, 'Signature'),
          ),
          h(View, { style: styles.footerCol },
            h(Text, { style: styles.footerLabel },
              data.answeredByName ? `Answered by: ${data.answeredByName}  ·  ${data.answeredAt ?? ''}` : 'Answered by: —',
            ),
            data.stampBuffer ? h(Image, { style: styles.stamp, src: data.stampBuffer }) : null,
            h(Text, { style: styles.signatureLine }, 'Signature'),
          ),
        ),
      ),
    ),
  );
}
