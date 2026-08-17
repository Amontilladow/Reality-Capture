import { createElement as h } from 'react';
import { RFI_DOCUMENT_TYPE_LABELS, RFI_IMPACT_LEVEL_LABELS, type RfiDocumentType, type RfiImpactLevel } from '@engineeringos/types';

// question/answer are stored as HTML from the RichTextEditor (Phase 3) --
// this is a static generated document, not a browser, so there's no HTML
// renderer to hand it to. Converts Tiptap's StarterKit output (paragraphs,
// headings, lists, bold/italic marks -- no tables, images, or anything else
// this editor doesn't produce) to plain text with real line breaks, rather
// than leaking raw tags like "<p>...</p>" into the PDF. Pre-Phase-3 rows
// with plain text (no tags at all) pass through unchanged.
// status/priority arrive as raw lowercase DB enum values ('critical',
// 'open') -- there's no shared label map for these outside apps/web's own
// rfi-constants.ts, so a plain capitalize is used here rather than either
// importing a frontend-only file into the API or duplicating its full
// label table for what's purely a display nicety.
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

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

// Real product fonts (IBM Plex Sans, self-hosted via @fontsource -- same
// family the live app loads from Google Fonts in index.html) rather than
// the PDF's own default Helvetica. Registered once per process, not per
// render -- Font.register on every request would just redundantly re-parse
// the same font files.
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
// the query/response attachment lists (rfi_attachments.kind, Phase 2).
export interface RfiPdfOrgLogo {
  slot: string;
  label: string;
  buffer?: Buffer;
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

export interface RfiPdfComment {
  userName?: string;
  organizationSlot?: string;
  body: string;
  createdAt: string;
}

export interface RfiPdfAuditEvent {
  action: string;
  userName?: string;
  occurredAt: string;
}

export interface RfiPdfData {
  logoBuffer?: Buffer;
  stampBuffer?: Buffer;
  organizations?: RfiPdfOrgLogo[];
  queryStamp?: RfiPdfUploadStamp;
  answerStamp?: RfiPdfUploadStamp;
  queryAttachments?: RfiPdfAttachmentItem[];
  responseAttachments?: RfiPdfAttachmentItem[];
  comments?: RfiPdfComment[];
  auditEvents?: RfiPdfAuditEvent[];
  rfiNumber: string;
  status: string;
  priority: string;
  subject: string;
  question: string;
  answer?: string;
  disciplineLabel: string;
  disciplineOther?: string;
  assignedToName?: string;
  dueDate?: string;
  costImpactLevel: string;
  costImpactAmount?: number;
  costImpactCurrency?: string;
  costImpactDescription?: string;
  timeImpactLevel: string;
  timeImpactDays?: number;
  timeImpactDescription?: string;
  projectName: string;
  projectCode?: string;
  createdByName?: string;
  createdAt: string;
  answeredByName?: string;
  answeredAt?: string;
}

export async function renderRfiPdf(data: RfiPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'IBM Plex Sans', color: INK },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    headerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    logo: { width: 44, height: 44, objectFit: 'contain' },
    stamp: { width: 70, height: 70, objectFit: 'contain', marginBottom: 4 },
    // Compact "TEST PROJECT"-style eyebrow line -- folds Project Name +
    // Project No. into the header instead of their own standalone section,
    // matching the live page's PageHeader eyebrow placed just above the
    // RFI number heading.
    projectEyebrow: { fontSize: 7.5, fontFamily: 'IBM Plex Sans', fontWeight: 600, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    title: { fontSize: 15, fontFamily: 'IBM Plex Sans', fontWeight: 700, letterSpacing: 0.3 },
    rfiNumber: { fontSize: 12, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: SIGNAL, marginTop: 3, letterSpacing: 0.2 },
    badge: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, padding: '3 8', borderRadius: 2, backgroundColor: SECTION_FILL, color: BLUEPRINT, textTransform: 'uppercase', letterSpacing: 0.4 },
    section: { border: `1 solid ${BORDER}`, borderRadius: 3, padding: 10, marginBottom: 10 },
    sectionTitle: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, textTransform: 'uppercase', color: BLUEPRINT, marginBottom: 6, letterSpacing: 0.6 },
    row: { flexDirection: 'row', marginBottom: 4 },
    col: { flex: 1, paddingRight: 8 },
    label: { fontSize: 8, color: INK_MUTED, marginBottom: 1 },
    value: { fontSize: 9.5 },
    impactRow: { flexDirection: 'row', gap: 24 },
    impactCol: { flex: 1 },
    impactLevelBadge: { fontSize: 7.5, fontFamily: 'IBM Plex Sans', fontWeight: 700, padding: '2 6', borderRadius: 2, alignSelf: 'flex-start', marginBottom: 3 },
    impactDetail: { fontSize: 8.5, color: INK_MUTED, marginBottom: 1 },
    bodyText: { fontSize: 9.5, lineHeight: 1.5 },
    footerRow: { flexDirection: 'row', marginTop: 16, paddingTop: 10, borderTop: `1 solid ${BORDER}` },
    footerCol: { flex: 1 },
    footerLabel: { fontSize: 8, color: INK_MUTED, marginBottom: 12 },
    signatureLine: { borderTop: `1 solid ${INK_MUTED}`, paddingTop: 3, fontSize: 8.5, width: 160 },
    // 5-organization header row (Phase 5) -- sits alongside the existing
    // single authoring-party logo, not in place of it. Always all 5 slots,
    // matching the live page's OrganizationSlotRow exactly -- an
    // unconfigured slot gets the same dashed placeholder box there does.
    orgRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    orgItem: { alignItems: 'center', width: 60 },
    orgLogo: { width: 34, height: 34, objectFit: 'contain', marginBottom: 2 },
    orgPlaceholder: { width: 34, height: 34, border: `1 dashed ${BORDER}`, borderRadius: 2, marginBottom: 2, alignItems: 'center', justifyContent: 'center' },
    orgPlaceholderText: { fontSize: 5, color: INK_MUTED },
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
    // Communication/Clarifications + Audit Trail (this section) -- both
    // shown live on RfiDetailPage but missing from the export until now.
    commentItem: { marginBottom: 6, paddingBottom: 6, borderBottom: `1 solid ${BORDER}` },
    commentMeta: { fontSize: 7.5, color: INK_MUTED, marginBottom: 2 },
    commentBody: { fontSize: 9, lineHeight: 1.4 },
    auditRow: { flexDirection: 'row', fontSize: 8, marginBottom: 3, gap: 8 },
    auditAction: { fontFamily: 'IBM Plex Sans', fontWeight: 600, color: INK, width: 160 },
    auditUser: { color: INK_MUTED, flex: 1 },
    auditTime: { color: INK_MUTED },
    // No italic registered above (avoids another font-resolution failure
    // like the Mono/space bug) -- muted color alone carries the "empty
    // state" distinction instead.
    emptyNote: { fontSize: 8.5, color: INK_MUTED },
  });

  const IMPACT_COLORS: Record<string, string> = { no: INK_MUTED, yes: SIGNAL, potential: '#B8860B', tbd: '#B8860B' };

  // Single discipline value (not the old hardcoded 9-item checkbox grid,
  // which didn't even match the real RFI_DISCIPLINE_LABELS enum) -- mirrors
  // RfiDetailPage's own InfoRow treatment of discipline exactly.
  const disciplineDisplay = data.disciplineLabel === 'Other' && data.disciplineOther
    ? `${data.disciplineLabel} — ${data.disciplineOther}`
    : data.disciplineLabel;

  // Compact "Name · Code" eyebrow, folded into the header -- replaces the
  // old standalone "Project" section (which also carried Location/Date;
  // both dropped, per the live page never showing either -- Date is
  // already covered by the footer's "Raised by ... createdAt" line).
  const projectEyebrowText = data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName;

  const field = (label: string, value?: string) =>
    h(View, { style: styles.col, key: label },
      h(Text, { style: styles.label }, label),
      h(Text, { style: styles.value }, value || '—'),
    );

  const impactCol = (title: string, level: string, amount?: number, currency?: string, days?: number, description?: string) =>
    h(View, { style: styles.impactCol },
      h(Text, { style: styles.label }, title),
      h(Text, { style: [styles.impactLevelBadge, { backgroundColor: SECTION_FILL, color: IMPACT_COLORS[level] ?? INK_MUTED }] },
        RFI_IMPACT_LEVEL_LABELS[level as RfiImpactLevel] ?? level,
      ),
      amount != null ? h(Text, { style: styles.impactDetail }, `${currency ? currency + ' ' : ''}${amount}`) : null,
      days != null ? h(Text, { style: styles.impactDetail }, `${days} day${days === 1 ? '' : 's'}`) : null,
      description ? h(Text, { style: styles.impactDetail }, description) : null,
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
              h(Text, { style: styles.projectEyebrow }, projectEyebrowText),
              h(Text, { style: styles.title }, 'REQUEST FOR INFORMATION'),
              h(Text, { style: styles.rfiNumber }, data.rfiNumber),
            ),
          ),
          h(Text, { style: styles.badge }, `${capitalize(data.status)} · ${capitalize(data.priority)}`),
        ),

        // Always all 5 organization slots (Phase 5), alongside the single
        // authoring-party logo above, not replacing it.
        data.organizations && data.organizations.length > 0
          ? h(View, { style: styles.orgRow },
              ...data.organizations.map((org) => h(View, { style: styles.orgItem, key: org.slot },
                org.buffer
                  ? h(Image, { style: styles.orgLogo, src: org.buffer })
                  : h(View, { style: styles.orgPlaceholder }, h(Text, { style: styles.orgPlaceholderText }, 'No logo')),
                h(Text, { style: styles.orgLabel }, org.label),
              )),
            )
          : null,

        // Consolidated RFI Information -- RFI Number, Discipline, Priority,
        // Assigned To, Due Date all in one panel, matching the live page's
        // own RFI Information panel exactly (no more separate Project /
        // Discipline sections splitting these across the document).
        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'RFI Information'),
          h(View, { style: styles.row },
            field('RFI Number', data.rfiNumber),
            field('Discipline', disciplineDisplay),
            field('Priority', capitalize(data.priority)),
          ),
          h(View, { style: styles.row },
            field('Assigned To', data.assignedToName),
            field('Due Date', data.dueDate),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'RFI Title'),
          h(Text, { style: styles.bodyText }, data.subject),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Impact of Reply'),
          h(View, { style: styles.impactRow },
            impactCol('Cost Impact', data.costImpactLevel, data.costImpactAmount, data.costImpactCurrency, undefined, data.costImpactDescription),
            impactCol('Time Impact', data.timeImpactLevel, undefined, undefined, data.timeImpactDays, data.timeImpactDescription),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Query'),
          h(Text, { style: styles.bodyText }, richTextToPlain(data.question)),
          attachmentsBlock('Query Attachments', data.queryAttachments),
        ),
        stampPanel('Query Upload Stamp', data.queryStamp),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Communication / Clarifications'),
          data.comments && data.comments.length > 0
            ? h(View, null, ...data.comments.map((c, i) => h(View, { style: styles.commentItem, key: i },
                h(Text, { style: styles.commentMeta }, `${c.userName ?? 'Someone'}${c.organizationSlot ? ` (${c.organizationSlot})` : ''}  ·  ${c.createdAt}`),
                h(Text, { style: styles.commentBody }, c.body),
              )))
            : h(Text, { style: styles.emptyNote }, 'No comments.'),
        ),

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

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Audit Trail'),
          data.auditEvents && data.auditEvents.length > 0
            ? h(View, null, ...data.auditEvents.map((a, i) => h(View, { style: styles.auditRow, key: i },
                h(Text, { style: styles.auditAction }, a.action),
                h(Text, { style: styles.auditUser }, a.userName ?? 'System'),
                h(Text, { style: styles.auditTime }, a.occurredAt),
              )))
            : h(Text, { style: styles.emptyNote }, 'No audit events recorded.'),
        ),

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
