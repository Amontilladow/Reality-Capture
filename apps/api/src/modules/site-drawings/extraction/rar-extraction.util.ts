import { createExtractorFromData, type FileHeader } from 'node-unrar-js';

export interface ExtractedRarEntry {
  filename: string;
  buffer: Buffer;
}

export interface RarExtractionResult {
  entries: ExtractedRarEntry[];
  skippedNonPdf: string[];
  rejectedUnsafe: string[];
}

export interface RarExtractionLimits {
  maxEntryCount: number;
  maxTotalUncompressedBytes: number;
  maxSingleFileBytes: number;
}

// Same generous-but-bounded defaults as DEFAULT_ZIP_EXTRACTION_LIMITS
// (zip-extraction.util.ts) -- a RAR package of "hundreds of PDF drawings"
// is the same real-world shape as a ZIP one, so there's no reason for the
// two formats' safety ceilings to differ.
export const DEFAULT_RAR_EXTRACTION_LIMITS: RarExtractionLimits = {
  maxEntryCount: 2000,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  maxSingleFileBytes: 200 * 1024 * 1024,
};

const PDF_EXTENSION = /\.pdf$/i;

// Mirrors yauzl's own internal entry-name validation (see
// extractPdfEntriesFromZip's comment) -- node-unrar-js does no such
// validation itself, so this archive format needs the same defense built
// by hand: an entry naming an absolute path or containing a ".." segment
// fails the WHOLE archive, not just that one entry, exactly like the ZIP
// path's documented stance (one unsafe entry means the archive itself
// isn't trustworthy).
function isUnsafeEntryName(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:[/\\]/.test(name)) return true;
  return name.split(/[/\\]/).some((segment) => segment === '..');
}

// Extracts every .pdf entry from a RAR archive into memory. Same shape and
// safety doctrine as extractPdfEntriesFromZip, adapted to what
// node-unrar-js exposes:
//
// - Unlike yauzl/ZIP, node-unrar-js has no free, legal RAR *writer* to
//   pair it with (see this file's .spec.ts for why its tests mock the
//   library rather than building real fixtures) -- real end-to-end
//   extraction correctness against a genuine RAR5 archive (the format
//   version this feature exists for) was verified by hand against a real
//   production support case before this was built, not just by unit test.
// - A path-traversal/absolute-path entry fails the whole archive (see
//   isUnsafeEntryName), checked against every header BEFORE any
//   extraction is attempted.
// - An entry over the per-file size cap, or one that's password-encrypted
//   (this app has no UI for supplying a password, so an encrypted entry
//   can never actually be extracted), is skipped and reported
//   (rejectedUnsafe) without failing the rest of the archive.
// - A non-.pdf entry is skipped and reported (skippedNonPdf), not
//   rejected -- same reasoning as the ZIP path.
// - Running totals are checked against the caller's limits using the
//   archive's own declared sizes (available up front from getFileList(),
//   before any bytes are actually decompressed), so a RAR-bomb-shaped
//   archive is caught before memory is spent extracting it.
export async function extractPdfEntriesFromRar(
  rarBuffer: Buffer,
  limits: RarExtractionLimits = DEFAULT_RAR_EXTRACTION_LIMITS,
): Promise<RarExtractionResult> {
  const arrayBuffer = rarBuffer.buffer.slice(rarBuffer.byteOffset, rarBuffer.byteOffset + rarBuffer.byteLength) as ArrayBuffer;
  const extractor = await createExtractorFromData({ data: arrayBuffer });

  const headers = [...extractor.getFileList().fileHeaders];
  if (headers.length > limits.maxEntryCount) {
    throw new Error(`Archive contains more than ${limits.maxEntryCount} entries -- rejected as an unsafe/oversized package.`);
  }

  for (const header of headers) {
    if (!header.flags.directory && isUnsafeEntryName(header.name)) {
      throw new Error(`Archive contains an unsafe entry path: "${header.name}".`);
    }
  }

  const skippedNonPdf: string[] = [];
  const rejectedUnsafe: string[] = [];
  const toExtract: FileHeader[] = [];
  let totalUncompressedBytes = 0;

  for (const header of headers) {
    if (header.flags.directory) continue;

    if (header.flags.encrypted || header.unpSize > limits.maxSingleFileBytes) {
      rejectedUnsafe.push(header.name);
      continue;
    }

    totalUncompressedBytes += header.unpSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new Error(`Archive's total uncompressed size exceeds ${limits.maxTotalUncompressedBytes} bytes -- rejected as a likely archive bomb.`);
    }

    if (!PDF_EXTENSION.test(header.name)) {
      skippedNonPdf.push(header.name);
      continue;
    }

    toExtract.push(header);
  }

  const entries: ExtractedRarEntry[] = [];
  if (toExtract.length > 0) {
    const { files } = extractor.extract({ files: toExtract.map((header) => header.name) });
    for (const file of files) {
      if (!file.extraction) {
        // Passed every check above but still came back empty -- treat as
        // unsafe/unsupported rather than silently dropping it.
        rejectedUnsafe.push(file.fileHeader.name);
        continue;
      }
      entries.push({ filename: file.fileHeader.name, buffer: Buffer.from(file.extraction) });
    }
  }

  return { entries, skippedNonPdf, rejectedUnsafe };
}
