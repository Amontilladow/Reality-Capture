import { createElement as h } from 'react';

// status/priority/type/discipline/category arrive as raw lowercase DB
// values -- there's no shared label map for these outside apps/web's own
// issue-constants.ts, so a plain capitalize is used here rather than either
// importing a frontend-only file into the API or duplicating its full label
// tables for what's purely a display nicety. Caller passes already-resolved
// display labels where a real Record<Enum, string> exists (issueTypeLabel,
// disciplineLabel, categoryLabel); this is only used for status/priority.
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

// @react-pdf/renderer is ESM-only; this API compiles to CommonJS, so it must
// be loaded via dynamic import() -- see rfi-pdf.template.ts's identical
// comment for the full explanation. Kept as the one place in this module
// that knows about @react-pdf/renderer at all.

// ── Brand ────────────────────────────────────────────────────────────────
// Same palette/font choices as rfi-pdf.template.ts (kept as a separate copy
// rather than a shared module -- this codebase's existing convention is one
// private copy per feature, not a cross-module PDF-styling library).
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
  // identical comment (crashes on any string containing a space).
  Font.registerHyphenationCallback((word) => [word]);
}

export interface IssuePdfAttachmentItem {
  filename: string;
  // Set only for raster-image attachments whose download+resize succeeded
  // server-side -- undefined means either a non-image attachment or an
  // image whose fetch failed, both fall back to a plain text line.
  imageBuffer?: Buffer;
}

export interface IssuePdfComment {
  userName?: string;
  body: string;
  createdAt: string;
}

export interface IssuePdfStatusEvent {
  action: string;
  userName?: string;
  occurredAt: string;
}

export interface IssuePdfData {
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
  attachments?: IssuePdfAttachmentItem[];
  // Photos/videos from the pin (floor-plan location) this issue was
  // raised from, if any -- a distinct set from `attachments` above (those
  // come from issue_activities, these from captures.location_id), shown
  // in their own section so the two aren't conflated.
  pinPhotos?: IssuePdfAttachmentItem[];
  comments?: IssuePdfComment[];
  statusEvents?: IssuePdfStatusEvent[];
  projectName: string;
  projectCode?: string;
}

export async function renderIssuePdf(data: IssuePdfData): Promise<Buffer> {
  const { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'IBM Plex Sans', color: INK },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    projectEyebrow: { fontSize: 7.5, fontFamily: 'IBM Plex Sans', fontWeight: 600, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    title: { fontSize: 15, fontFamily: 'IBM Plex Sans', fontWeight: 700, letterSpacing: 0.3 },
    issueNumber: { fontSize: 12, fontFamily: 'IBM Plex Sans', fontWeight: 700, color: SIGNAL, marginTop: 3, letterSpacing: 0.2 },
    badge: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, padding: '3 8', borderRadius: 2, backgroundColor: SECTION_FILL, color: BLUEPRINT, textTransform: 'uppercase', letterSpacing: 0.4 },
    section: { border: `1 solid ${BORDER}`, borderRadius: 3, padding: 10, marginBottom: 10 },
    sectionTitle: { fontSize: 8, fontFamily: 'IBM Plex Sans', fontWeight: 700, textTransform: 'uppercase', color: BLUEPRINT, marginBottom: 6, letterSpacing: 0.6 },
    row: { flexDirection: 'row', marginBottom: 4 },
    col: { flex: 1, paddingRight: 8 },
    label: { fontSize: 8, color: INK_MUTED, marginBottom: 1 },
    value: { fontSize: 9.5 },
    bodyText: { fontSize: 9.5, lineHeight: 1.5 },
    attachmentsBlock: { marginTop: 4 },
    attachmentsHeading: { fontSize: 7, fontFamily: 'IBM Plex Sans', fontWeight: 700, textTransform: 'uppercase', color: INK_MUTED, marginBottom: 2, letterSpacing: 0.6 },
    attachmentItem: { fontSize: 8.5, fontFamily: 'IBM Plex Sans', marginBottom: 1.5 },
    attachmentImageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2, marginBottom: 4 },
    attachmentImageCard: { width: 150, marginBottom: 4 },
    attachmentImage: { width: 150, height: 110, objectFit: 'contain', border: `1 solid ${BORDER}`, borderRadius: 2, backgroundColor: SECTION_FILL },
    attachmentImageCaption: { fontSize: 7, fontFamily: 'IBM Plex Sans', color: INK_MUTED, marginTop: 2 },
    commentItem: { marginBottom: 6, paddingBottom: 6, borderBottom: `1 solid ${BORDER}` },
    commentMeta: { fontSize: 7.5, color: INK_MUTED, marginBottom: 2 },
    commentBody: { fontSize: 9, lineHeight: 1.4 },
    activityRow: { flexDirection: 'row', fontSize: 8, marginBottom: 3, gap: 8 },
    activityAction: { fontFamily: 'IBM Plex Sans', fontWeight: 600, color: INK, width: 220 },
    activityUser: { color: INK_MUTED, flex: 1 },
    activityTime: { color: INK_MUTED },
    emptyNote: { fontSize: 8.5, color: INK_MUTED },
    footerRow: { flexDirection: 'row', marginTop: 16, paddingTop: 10, borderTop: `1 solid ${BORDER}` },
    footerCol: { flex: 1 },
    footerLabel: { fontSize: 8, color: INK_MUTED, marginBottom: 12 },
    signatureLine: { borderTop: `1 solid ${INK_MUTED}`, paddingTop: 3, fontSize: 8.5, width: 160 },
  });

  const projectEyebrowText = data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName;

  const field = (label: string, value?: string) =>
    h(View, { style: styles.col, key: label },
      h(Text, { style: styles.label }, label),
      h(Text, { style: styles.value }, value || '—'),
    );

  const attachmentLabel = (item: IssuePdfAttachmentItem) => `• ${item.filename}`;

  const attachmentsBlock = (items?: IssuePdfAttachmentItem[]) => {
    if (!items || items.length === 0) return h(Text, { style: styles.emptyNote }, 'No attachments.');
    const imageItems = items.filter((item) => item.imageBuffer);
    const textItems = items.filter((item) => !item.imageBuffer);
    return h(View, { style: styles.attachmentsBlock },
      ...textItems.map((item, i) => h(Text, { style: styles.attachmentItem, key: `t${i}` }, attachmentLabel(item))),
      imageItems.length > 0
        ? h(View, { style: styles.attachmentImageGrid },
            ...imageItems.map((item, i) => h(View, { style: styles.attachmentImageCard, key: `i${i}` },
              h(Image, { style: styles.attachmentImage, src: item.imageBuffer }),
              h(Text, { style: styles.attachmentImageCaption }, attachmentLabel(item)),
            )),
          )
        : null,
    );
  };

  return renderToBuffer(
    h(Document, { title: data.issueNumber },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          h(View, null,
            h(Text, { style: styles.projectEyebrow }, projectEyebrowText),
            h(Text, { style: styles.title }, 'ISSUE'),
            h(Text, { style: styles.issueNumber }, data.issueNumber),
          ),
          h(Text, { style: styles.badge }, `${capitalize(data.status)} · ${capitalize(data.priority)}`),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Issue Information'),
          h(View, { style: styles.row },
            field('Type', data.issueTypeLabel),
            field('Discipline', data.disciplineLabel),
            field('Category', data.categoryLabel),
          ),
          h(View, { style: styles.row },
            field('Assigned To', data.assignedToName),
            field('Location', data.locationName),
            field('Due Date', data.deadline),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Title'),
          h(Text, { style: styles.bodyText }, data.title),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Description'),
          h(Text, { style: styles.bodyText }, data.description || '—'),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Attachments'),
          attachmentsBlock(data.attachments),
        ),

        data.pinPhotos && data.pinPhotos.length > 0
          ? h(View, { style: styles.section },
              h(Text, { style: styles.sectionTitle }, 'Photos from Pin'),
              attachmentsBlock(data.pinPhotos),
            )
          : null,

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Comments'),
          data.comments && data.comments.length > 0
            ? h(View, null, ...data.comments.map((c, i) => h(View, { style: styles.commentItem, key: i },
                h(Text, { style: styles.commentMeta }, `${c.userName ?? 'Someone'}  ·  ${c.createdAt}`),
                h(Text, { style: styles.commentBody }, c.body),
              )))
            : h(Text, { style: styles.emptyNote }, 'No comments.'),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Activity Log'),
          data.statusEvents && data.statusEvents.length > 0
            ? h(View, null, ...data.statusEvents.map((a, i) => h(View, { style: styles.activityRow, key: i },
                h(Text, { style: styles.activityAction }, a.action),
                h(Text, { style: styles.activityUser }, a.userName ?? 'System'),
                h(Text, { style: styles.activityTime }, a.occurredAt),
              )))
            : h(Text, { style: styles.emptyNote }, 'No activity recorded.'),
        ),

        h(View, { style: styles.footerRow },
          h(View, { style: styles.footerCol },
            h(Text, { style: styles.footerLabel }, `Raised by: ${data.createdByName ?? '—'}  ·  ${data.createdAt}`),
            h(Text, { style: styles.signatureLine }, 'Signature'),
          ),
          h(View, { style: styles.footerCol },
            h(Text, { style: styles.footerLabel }, data.closedAt ? `Closed: ${data.closedAt}` : 'Closed: —'),
            h(Text, { style: styles.signatureLine }, 'Signature'),
          ),
        ),
      ),
    ),
  );
}
