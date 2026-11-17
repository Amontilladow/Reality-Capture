import { PDFParse } from 'pdf-parse';

// Below this, a page is treated as having no usable embedded text layer at
// all (a scanned drawing with no OCR'd text baked in, or a vector-only CAD
// export with no real text objects): the OCR fallback path, not a
// guess from a handful of stray characters some PDF viewers/printers
// leave behind (page numbers, a watermark).
export const MIN_USABLE_TEXT_LENGTH = 20;

export interface PdfTextResult {
  text: string;
  pageCount: number;
  // Every cell of every vector-drawn table detected on the page (pdf-parse's
  // getTable(): scans draw operators for rectangles/lines forming a grid,
  // then matches positioned text to cells by actual (x, y), not content-
  // stream order), flattened across tables/rows into one list -- a title
  // block's own cells, in practice, since that's normally the only bordered
  // grid on a drawing sheet. A caller that scopes its field regexes to one
  // cell's own text at a time is immune to the failure mode plain getText()
  // has no defense against: a title-block field's label and value can be
  // written to the PDF content stream in a different order than they're
  // laid out visually (confirmed by hand against a reproduction fixture
  // built the way CAD title-block attribute blocks commonly serialize --
  // labels in one pass, values in another), so the token immediately
  // following a label in the flattened text can genuinely belong to a
  // different field entirely. Empty when the page has no detected table
  // (a borderless or hand-drawn-rule title block) -- callers fall back to
  // whole-page matching in that case, same as before this existed.
  tableCells: string[];
}

// pdf-parse's getText() always appends a "-- N of M --" page-separator
// marker to the returned text, REGARDLESS of how much (or how little)
// real content the page actually has; confirmed by hand against a
// real pdf-lib-built fixture. Left in, that boilerplate alone is enough
// to clear MIN_USABLE_TEXT_LENGTH for a page with NO real text at all
// (exactly the case this threshold exists to catch), which would wrongly
// skip the OCR fallback for a scanned/blank drawing. Stripped
// before any length check or title-block pattern match ever sees it.
const PAGE_MARKER_BOILERPLATE = /--\s*\d+\s*of\s*\d+\s*--/g;

export function stripPdfParseBoilerplate(text: string): string {
  return text.replace(PAGE_MARKER_BOILERPLATE, '').trim();
}

// Embedded-text extraction (Decision 1 step 1: "extract embedded text
// from PDFs first using an appropriate open-source PDF library";
// pdf-parse, MIT licensed, pure TypeScript/Node, no native dependency).
// Reads page 1 only; a drawing's title block lives on the sheet itself,
// and each file in an import batch is one sheet.
//
// Not covered by this repo's Jest suite: pdf-parse v2 loads pdfjs-dist
// internally via a dynamic import() that Jest's CJS/VM sandbox can't
// satisfy without --experimental-vm-modules (a flag this project doesn't
// otherwise need and isn't worth risking against the rest of the test
// suite for one dependency). Verified correct by hand instead; a
// pdf-lib-built fixture with known text round-tripped through this exact
// function under plain Node (outside Jest) and matched. The pure
// stripPdfParseBoilerplate() logic above IS Jest-covered.
export async function extractEmbeddedText(pdfBuffer: Buffer): Promise<PdfTextResult> {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const info = await parser.getInfo();
    const textResult = await parser.getText({ partial: [1] });
    // One parser instance, both passes: getTable() re-walks the same page's
    // operator list getText() already parsed, so folding it into this same
    // call avoids a second full PDF parse per file -- worth doing given an
    // import batch can be hundreds of files.
    //
    // getTable() is kept in its OWN try/catch, separate from getText()
    // above: confirmed by hand against a reproduction fixture (a bordered
    // title-block grid on a page also carrying a few thousand unrelated
    // vector lines, the way an actual CAD-exported drawing sheet looks
    // next to its title block -- not just the bare grid a simpler fixture
    // would have), pdf-parse's own table-detection (geometry/Table.js)
    // throws "Cannot read properties of undefined (reading 'from')" on
    // exactly this shape of page. Reproduced on every real drawing in
    // production (confirmed in the API's own logs), meaning table-cell
    // extraction never once succeeded for a real file, and -- since this
    // call sat inline before this fix -- silently took the whole-page text
    // getText() had ALREADY successfully extracted down with it, forcing
    // every single import onto the slower, flakier OCR fallback for no
    // reason: the page's real text was sitting right there. Falling back to
    // no detected table on this failure costs nothing it wasn't already
    // going to cost (extractTitleBlockFieldsFromCells() returning null here
    // is the same, already-handled fallback path as a page with no table
    // at all; see this type's own comment above).
    let tableCells: string[] = [];
    try {
      const tableResult = await parser.getTable({ partial: [1] });
      tableCells = (tableResult.pages[0]?.tables ?? []).flatMap((table) => table.flat());
    } catch {
      tableCells = [];
    }
    return { text: stripPdfParseBoilerplate(textResult.text ?? ''), pageCount: info.total ?? 1, tableCells };
  } finally {
    await parser.destroy();
  }
}

export function hasUsableEmbeddedText(text: string): boolean {
  return text.trim().length >= MIN_USABLE_TEXT_LENGTH;
}
