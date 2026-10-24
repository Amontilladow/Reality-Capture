import * as yauzl from 'yauzl';

export interface ExtractedZipEntry {
  filename: string;
  buffer: Buffer;
}

export interface ZipExtractionResult {
  entries: ExtractedZipEntry[];
  skippedNonPdf: string[];
  rejectedUnsafe: string[];
}

export interface ZipExtractionLimits {
  maxEntryCount: number;
  maxTotalUncompressedBytes: number;
  maxSingleFileBytes: number;
}

// Safe, generous defaults for "a ZIP of hundreds of PDF drawings" (brief
// section 2) while still bounding worst-case memory/disk use against a
// zip bomb (a tiny archive whose central directory claims a wildly larger
// uncompressed size than is remotely plausible for PDF drawings).
export const DEFAULT_ZIP_EXTRACTION_LIMITS: ZipExtractionLimits = {
  maxEntryCount: 2000,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  maxSingleFileBytes: 200 * 1024 * 1024, // matches DRAWING_MAX_SIZE_BYTES in site-drawings.service.ts
};

const PDF_EXTENSION = /\.pdf$/i;

// Extracts every .pdf entry from a ZIP archive into memory, rejecting
// anything unsafe along the way (brief section 2: "prevent path traversal,
// malicious archive contents"). Deliberately conservative:
//
// - A path-traversal or absolute-path entry name fails the WHOLE archive
//   (this function's promise rejects), not a per-entry skip: yauzl
//   validates every entry's name internally as it decodes the central
//   directory (the same check its own exported validateFileName()
//   documents as the correct defense) and emits 'error' before the
//   'entry' event ever fires for ANY entry if one is unsafe -- there is no
//   way to selectively accept the rest of an archive that contains one.
//   Confirmed by hand against a hand-built malicious fixture (yazl, the
//   paired writer library, refuses to even construct such an entry, so a
//   well-behaved ZIP writer can never produce one in the first place).
// - A directory entry is silently skipped (not an error).
// - A non-.pdf entry is skipped and reported, not rejected -- a ZIP of
//   "mostly drawings" with a stray readme.txt is normal, not malicious.
// - A single file over the per-file size cap is skipped and reported
//   (rejectedUnsafe) -- this one IS a per-entry decision (ours, not
//   yauzl's), since one oversized file isn't evidence the rest of the
//   archive is malicious.
// - The running total entry count and uncompressed size are checked
//   against the caller's limits BEFORE each entry's data is read, so a
//   zip-bomb-shaped archive is caught before memory is spent reading it.
export async function extractPdfEntriesFromZip(
  zipBuffer: Buffer,
  limits: ZipExtractionLimits = DEFAULT_ZIP_EXTRACTION_LIMITS,
): Promise<ZipExtractionResult> {
  const zipfile = await yauzl.fromBufferPromise(zipBuffer, { lazyEntries: true, autoClose: false });
  const entries: ExtractedZipEntry[] = [];
  const skippedNonPdf: string[] = [];
  const rejectedUnsafe: string[] = [];
  let totalUncompressedBytes = 0;
  let entryCount = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('error', reject);
      zipfile.on('end', () => resolve());

      zipfile.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          try {
            entryCount += 1;
            if (entryCount > limits.maxEntryCount) {
              reject(new Error(`Archive contains more than ${limits.maxEntryCount} entries -- rejected as an unsafe/oversized package.`));
              return;
            }

            // Directory entries end with '/' in the zip spec.
            if (entry.fileName.endsWith('/')) {
              zipfile.readEntry();
              return;
            }

            if (entry.uncompressedSize > limits.maxSingleFileBytes) {
              rejectedUnsafe.push(entry.fileName);
              zipfile.readEntry();
              return;
            }

            totalUncompressedBytes += entry.uncompressedSize;
            if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
              reject(new Error(`Archive's total uncompressed size exceeds ${limits.maxTotalUncompressedBytes} bytes -- rejected as a likely zip bomb.`));
              return;
            }

            if (!PDF_EXTENSION.test(entry.fileName)) {
              skippedNonPdf.push(entry.fileName);
              zipfile.readEntry();
              return;
            }

            const stream = await zipfile.openReadStreamPromise(entry);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(chunk as Buffer);
            entries.push({ filename: entry.fileName, buffer: Buffer.concat(chunks) });
            zipfile.readEntry();
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      });

      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }

  return { entries, skippedNonPdf, rejectedUnsafe };
}
