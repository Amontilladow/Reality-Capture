import { PDFParse } from 'pdf-parse';

// Below this, a page is treated as having no usable embedded text layer at
// all (a scanned drawing with no OCR'd text baked in, or a vector-only CAD
// export with no real text objects) -- the OCR fallback path, not a
// guess from a handful of stray characters some PDF viewers/printers
// leave behind (page numbers, a watermark).
export const MIN_USABLE_TEXT_LENGTH = 20;

export interface PdfTextResult {
  text: string;
  pageCount: number;
}

// pdf-parse's getText() always appends a "-- N of M --" page-separator
// marker to the returned text, REGARDLESS of how much (or how little)
// real content the page actually has -- confirmed by hand against a
// real pdf-lib-built fixture. Left in, that boilerplate alone is enough
// to clear MIN_USABLE_TEXT_LENGTH for a page with NO real text at all
// (exactly the case this threshold exists to catch), which would wrongly
// skip the OCR fallback for a genuinely scanned/blank drawing. Stripped
// before any length check or title-block pattern match ever sees it.
const PAGE_MARKER_BOILERPLATE = /--\s*\d+\s*of\s*\d+\s*--/g;

export function stripPdfParseBoilerplate(text: string): string {
  return text.replace(PAGE_MARKER_BOILERPLATE, '').trim();
}

// Embedded-text extraction (Decision 1 step 1: "extract embedded text
// from PDFs first using an appropriate open-source PDF library" --
// pdf-parse, MIT licensed, pure TypeScript/Node, no native dependency).
// Reads page 1 only -- a drawing's title block lives on the sheet itself,
// and each file in an import batch is one sheet.
//
// Not covered by this repo's Jest suite: pdf-parse v2 loads pdfjs-dist
// internally via a dynamic import() that Jest's CJS/VM sandbox can't
// satisfy without --experimental-vm-modules (a flag this project doesn't
// otherwise need and isn't worth risking against the rest of the test
// suite for one dependency). Verified correct by hand instead -- a
// pdf-lib-built fixture with known text round-tripped through this exact
// function under plain Node (outside Jest) and matched. The pure
// stripPdfParseBoilerplate() logic above IS Jest-covered.
export async function extractEmbeddedText(pdfBuffer: Buffer): Promise<PdfTextResult> {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const info = await parser.getInfo();
    const result = await parser.getText({ partial: [1] });
    return { text: stripPdfParseBoilerplate(result.text ?? ''), pageCount: info.total ?? 1 };
  } finally {
    await parser.destroy();
  }
}

export function hasUsableEmbeddedText(text: string): boolean {
  return text.trim().length >= MIN_USABLE_TEXT_LENGTH;
}
