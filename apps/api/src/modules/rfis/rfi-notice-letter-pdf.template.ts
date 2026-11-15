import { createElement as h } from 'react';
import { INK, INK_MUTED, SIGNAL, BLUEPRINT, registerBrandFonts } from '../../common/pdf/brand';

// @react-pdf/renderer is ESM-only ("type": "module" in its package.json);
// this API compiles to CommonJS (see apps/api/.swcrc), so it must be loaded
// via dynamic import() rather than a static import; a static import would
// compile to require(), which cannot load an ESM package. Same reasoning as
// rfi-pdf.template.ts's own top-of-file comment; kept as the one place in
// this module that knows about @react-pdf/renderer at all.

// Brand colors and font registration: see common/pdf/brand.ts, the single
// source of truth every PDF template in this app shares.

export interface NoticeLetterPdfData {
  projectName: string;
  projectCode?: string;
  logoBuffer?: Buffer;
  body: string; // the letter's full freeform text: rendered as paragraphs
}

export async function renderNoticeLetterPdf(data: NoticeLetterPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } = await import('@react-pdf/renderer');
  registerBrandFonts(Font);

  const styles = StyleSheet.create({
    page: { padding: 40, fontSize: 10, fontFamily: 'Outfit', color: INK },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14, paddingBottom: 10, borderBottom: `2 solid ${SIGNAL}` },
    logo: { width: 44, height: 44, objectFit: 'contain' },
    projectEyebrow: { fontSize: 8, fontFamily: 'Outfit', fontWeight: 600, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
    title: { fontSize: 15, fontFamily: 'Outfit', fontWeight: 700, letterSpacing: 0.3, color: BLUEPRINT },
    bodyWrap: { marginTop: 4 },
    paragraph: { marginBottom: 10 },
    line: { fontSize: 10, lineHeight: 1.5, fontFamily: 'Outfit' },
  });

  const projectEyebrowText = data.projectCode ? `${data.projectName} · ${data.projectCode}` : data.projectName;

  // react-pdf's <Text> does not auto-preserve raw "\n" characters the way
  // HTML's white-space:pre-wrap does; a single <Text> containing embedded
  // newlines collapses onto one run-on line when rendered. The letter body
  // (per the frontend's default template) mixes short single-line-break
  // structure ("To: ...\nFrom: ...\nDate: ...") with blank-line-separated
  // paragraphs, so both structures need to be preserved explicitly:
  //   1. Split on blank lines ("\n\n", allowing surrounding whitespace) into
  //      paragraphs.
  //   2. Within each paragraph, split on single "\n" and render each line as
  //      its own <Text> block; this is what actually keeps "To:", "From:",
  //      "Date:" etc. on separate lines instead of collapsing them.
  const paragraphs = data.body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return renderToBuffer(
    h(Document, { title: 'Notice Letter' },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          data.logoBuffer ? h(Image, { style: styles.logo, src: data.logoBuffer }) : null,
          h(View, null,
            h(Text, { style: styles.projectEyebrow }, projectEyebrowText),
            h(Text, { style: styles.title }, 'NOTICE LETTER'),
          ),
        ),
        h(View, { style: styles.bodyWrap },
          ...paragraphs.map((paragraph, pi) =>
            h(View, { style: styles.paragraph, key: pi },
              ...paragraph.split('\n').map((line, li) =>
                h(Text, { style: styles.line, key: li }, line),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
