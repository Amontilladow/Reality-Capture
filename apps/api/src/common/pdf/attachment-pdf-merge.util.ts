import { PDFDocument, PDFFont, StandardFonts, rgb, PageSizes } from 'pdf-lib';

// Extracted from RfisService (Phase 3's RFI PDF export) -- was private to
// that one service even though "render a summary page, then append every
// attachment's real content as full, divided pages" is a generic document-
// export need, not an RFI-specific one. QAQC's NCR/SOR PDF export (Risk
// Engine phase) is the second real caller; this is the shared version both
// now call, so the ~150 lines of pdf-lib merging logic exist exactly once.
//
// Deliberately decoupled from any one record type's vocabulary: callers
// pre-sort their attachment rows into the order they want appended and
// pre-compute each row's typeLabel (RFI's is "Drawing" / "Photo" / "Other —
// <free text>" from RFI_DOCUMENT_TYPE_LABELS; QAQC's is just "Issue
// attachment" / "Response attachment" from its kind column) -- this module
// never needs to know those vocabularies exist.

export interface MergeableAttachment {
  filename: string;
  storageKey?: string;
  typeLabel: string;
}

// Minimal shape this module needs from StorageService -- accepting the
// narrow interface instead of the concrete class keeps this a plain,
// DI-free utility function, callable from any service that already has its
// own StorageService instance.
export interface AttachmentDownloader {
  download(key: string): Promise<Buffer>;
}

// Raster-image extensions pdf-lib's embedJpg()/embedPng() can actually
// decode -- gif/webp (sometimes eligible for a small in-summary thumbnail
// elsewhere) are NOT here, since pdf-lib has no decoder for either; an
// attachment with one of those extensions still gets its plain
// "• filename (type)" text line in the summary, just no appendix page.
const MERGEABLE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

// Full-page section-marker page -- plain drawText(), not routed through
// react-pdf: a functional section marker doesn't need to match the
// summary's exact branded font. Bold heading + regular filename/type line.
function addAttachmentDividerPage(mainDoc: PDFDocument, headingFont: PDFFont, bodyFont: PDFFont, filename: string, typeLabel: string): void {
  const [, pageHeight] = PageSizes.A4;
  const page = mainDoc.addPage(PageSizes.A4);
  const margin = 50;
  page.drawText('ATTACHMENT', {
    x: margin,
    y: pageHeight - margin - 24,
    size: 20,
    font: headingFont,
    color: rgb(0.04, 0.08, 0.11),
  });
  page.drawText(filename, {
    x: margin,
    y: pageHeight - margin - 54,
    size: 13,
    font: bodyFont,
    color: rgb(0.04, 0.08, 0.11),
  });
  page.drawText(`(${typeLabel})`, {
    x: margin,
    y: pageHeight - margin - 74,
    size: 10.5,
    font: bodyFont,
    color: rgb(0.29, 0.38, 0.47),
  });
}

// Downloads one attachment and appends its divider page + real content
// pages to mainDoc. Deliberately swallows every failure here (bad storage
// key, network error, corrupt/encrypted PDF pdf-lib can't parse, corrupt
// image) -- a console.warn plus a skipped attachment, never a thrown
// error, so one bad attachment can't take the rest of the merged document
// (summary + every other attachment) down with it.
async function appendAttachmentPages(
  mainDoc: PDFDocument,
  attachment: MergeableAttachment,
  storage: AttachmentDownloader,
  headingFont: PDFFont,
  bodyFont: PDFFont,
): Promise<void> {
  const { filename, storageKey, typeLabel } = attachment;
  const ext = getFileExtension(filename);
  const isPdf = ext === 'pdf';
  const isMergeableImage = MERGEABLE_IMAGE_EXTENSIONS.has(ext);
  if (!storageKey || (!isPdf && !isMergeableImage)) return; // xls/xlsx/doc/docx/zip/unknown -- text line only, no appendix page

  try {
    const bytes = await storage.download(storageKey);
    // pdf-lib's JpegEmbedder reads the SOI marker via `new
    // DataView(bytes.buffer)` with no byteOffset/length -- it assumes
    // bytes.buffer *is* the image, not a slice of a larger one. But a
    // downloaded Buffer is very often a pooled Buffer sliced out of a
    // larger internal allocation with a nonzero byteOffset -- confirmed
    // live against a real site-photo.jpg attachment, which pdf-lib
    // rejected with "SOI not found in JPEG" even though the bytes are a
    // perfectly valid JPEG. Uint8Array.from() copies into a fresh,
    // byteOffset-0 buffer, which sidesteps this for every pdf-lib embedder,
    // not just JPEG's.
    const normalizedBytes = Uint8Array.from(bytes);

    // Build the real content FIRST and only add the divider page once that
    // succeeds -- if PDFDocument.load()/copyPages()/embedJpg()/embedPng()
    // throws (corrupt file, encrypted PDF, truncated image), nothing has
    // been added to mainDoc yet, so a failed attachment never leaves a
    // stray, content-less divider page behind.
    if (isPdf) {
      const attachmentDoc = await PDFDocument.load(normalizedBytes);
      const copiedPages = await mainDoc.copyPages(attachmentDoc, attachmentDoc.getPageIndices());
      addAttachmentDividerPage(mainDoc, headingFont, bodyFont, filename, typeLabel);
      copiedPages.forEach((p) => mainDoc.addPage(p));
    } else {
      const image = ext === 'png' ? await mainDoc.embedPng(normalizedBytes) : await mainDoc.embedJpg(normalizedBytes);
      const [pageWidth, pageHeight] = PageSizes.A4;
      const margin = 40;
      const { width, height } = image.scaleToFit(pageWidth - margin * 2, pageHeight - margin * 2);
      addAttachmentDividerPage(mainDoc, headingFont, bodyFont, filename, typeLabel);
      const page = mainDoc.addPage(PageSizes.A4);
      page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
    }
  } catch (err) {
    // Per-attachment failure only -- everything else (summary + every
    // other attachment) still comes through fine.
    console.warn(`[attachment-pdf-merge] Skipping attachment "${filename}" while merging PDF appendix: ${(err as Error)?.message ?? err}`);
  }
}

// Loads the react-pdf-rendered summary as a pdf-lib PDFDocument, then
// appends divider + content pages for every attachment in the order given
// -- one final PDFDocument, .save()'d once at the end into the single
// Buffer the caller's controller streams back.
export async function mergeAttachmentPdfs(
  summaryBuffer: Buffer,
  attachments: MergeableAttachment[],
  storage: AttachmentDownloader,
): Promise<Buffer> {
  const mainDoc = await PDFDocument.load(summaryBuffer);
  const headingFont = await mainDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await mainDoc.embedFont(StandardFonts.Helvetica);

  for (const attachment of attachments) {
    await appendAttachmentPages(mainDoc, attachment, storage, headingFont, bodyFont);
  }

  const bytes = await mainDoc.save();
  return Buffer.from(bytes);
}
