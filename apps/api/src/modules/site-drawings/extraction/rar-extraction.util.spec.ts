import type { FileHeader } from 'node-unrar-js';
import { extractPdfEntriesFromRar, type RarExtractionLimits } from './rar-extraction.util';

// Unlike ZIP (yauzl paired with yazl, a real free writer), there is no
// free, legal library to WRITE a real RAR archive at test time -- RAR is a
// proprietary format, and the UnRAR source license that node-unrar-js
// vendors explicitly forbids using it to build a RAR compressor. Real
// end-to-end extraction correctness (a genuine RAR5 archive, decompressed
// byte-for-byte correctly) was verified by hand against an actual
// production support case before this was built. These tests instead mock
// node-unrar-js's own Extractor interface to exercise this file's own
// logic in isolation: path-traversal rejection, size limits, non-PDF
// skipping, and encrypted-entry handling -- all things this file adds on
// top of whatever node-unrar-js itself does.
jest.mock('node-unrar-js', () => ({ createExtractorFromData: jest.fn() }));
const { createExtractorFromData } = jest.requireMock('node-unrar-js') as { createExtractorFromData: jest.Mock };

function header(overrides: Partial<FileHeader> & { name: string }): FileHeader {
  return {
    flags: { encrypted: false, solid: false, directory: false },
    packSize: 0,
    unpSize: 0,
    crc: 0,
    time: '',
    unpVer: '',
    method: 'Normal',
    comment: '',
    ...overrides,
  };
}

function mockExtractor(headers: FileHeader[], contents: Record<string, string>) {
  createExtractorFromData.mockResolvedValue({
    getFileList: () => ({ arcHeader: { comment: '', flags: {} }, fileHeaders: headers[Symbol.iterator]() }),
    extract: ({ files }: { files: string[] }) => ({
      arcHeader: { comment: '', flags: {} },
      files: (function* () {
        for (const name of files) {
          const fileHeader = headers.find((h) => h.name === name)!;
          const content = contents[name];
          yield { fileHeader, extraction: content === undefined ? undefined : new TextEncoder().encode(content) };
        }
      })(),
    }),
  });
}

describe('extractPdfEntriesFromRar', () => {
  beforeEach(() => createExtractorFromData.mockReset());

  it('extracts every .pdf entry and skips (not rejects) a non-pdf entry, ignoring directory entries', async () => {
    mockExtractor(
      [
        header({ name: 'A-101.pdf', unpSize: 23 }),
        header({ name: 'S-201.pdf', unpSize: 23 }),
        header({ name: 'readme.txt', unpSize: 13 }),
        header({ name: '1', flags: { encrypted: false, solid: false, directory: true } }),
      ],
      { 'A-101.pdf': '%PDF-1.4 fake content A', 'S-201.pdf': '%PDF-1.4 fake content S' },
    );

    const result = await extractPdfEntriesFromRar(Buffer.from('fake rar bytes'));

    expect(result.entries.map((e) => e.filename).sort()).toEqual(['A-101.pdf', 'S-201.pdf']);
    expect(result.skippedNonPdf).toEqual(['readme.txt']);
    expect(result.rejectedUnsafe).toEqual([]);
    expect(result.entries.find((e) => e.filename === 'A-101.pdf')?.buffer.toString()).toBe('%PDF-1.4 fake content A');
  });

  it('rejects the whole archive on a path-traversal entry name, never extracting anything from it', async () => {
    mockExtractor([header({ name: '../../etc/passwd.pdf', unpSize: 9 })], {});
    await expect(extractPdfEntriesFromRar(Buffer.from('x'))).rejects.toThrow(/unsafe entry path/);
  });

  it('rejects the whole archive on an absolute-path entry name', async () => {
    mockExtractor([header({ name: '/etc/passwd.pdf', unpSize: 9 })], {});
    await expect(extractPdfEntriesFromRar(Buffer.from('x'))).rejects.toThrow(/unsafe entry path/);
  });

  it('rejects an archive with more entries than the configured cap (archive-bomb-shaped entry count)', async () => {
    const headers = Array.from({ length: 5 }, (_, i) => header({ name: `d-${i}.pdf`, unpSize: 10 }));
    mockExtractor(headers, {});
    const limits: RarExtractionLimits = { maxEntryCount: 3, maxTotalUncompressedBytes: 10 * 1024 * 1024, maxSingleFileBytes: 1024 * 1024 };

    await expect(extractPdfEntriesFromRar(Buffer.from('x'), limits)).rejects.toThrow(/more than 3 entries/);
  });

  it('rejects a single file exceeding the per-file cap, but continues processing the rest of the archive', async () => {
    mockExtractor(
      [header({ name: 'too-big.pdf', unpSize: 1000 }), header({ name: 'fine.pdf', unpSize: 11 })],
      { 'fine.pdf': '%PDF-1.4 ok' },
    );
    const limits: RarExtractionLimits = { maxEntryCount: 10, maxTotalUncompressedBytes: 10 * 1024 * 1024, maxSingleFileBytes: 500 };

    const result = await extractPdfEntriesFromRar(Buffer.from('x'), limits);
    expect(result.rejectedUnsafe).toEqual(['too-big.pdf']);
    expect(result.entries.map((e) => e.filename)).toEqual(['fine.pdf']);
  });

  it('rejects the whole archive once the running TOTAL uncompressed size exceeds the cap, even with small individual files', async () => {
    mockExtractor([header({ name: 'a.pdf', unpSize: 100 }), header({ name: 'b.pdf', unpSize: 100 })], {});
    const limits: RarExtractionLimits = { maxEntryCount: 10, maxTotalUncompressedBytes: 150, maxSingleFileBytes: 1_000_000 };

    await expect(extractPdfEntriesFromRar(Buffer.from('x'), limits)).rejects.toThrow(/total uncompressed size exceeds/);
  });

  // This app has no UI to supply a password, so an encrypted entry can
  // never actually be extracted -- it's treated as unsupported (skipped,
  // reported), not as a fatal error for the rest of the archive.
  it('skips a password-encrypted entry as unsafe/unsupported, without attempting to extract it', async () => {
    mockExtractor(
      [header({ name: 'locked.pdf', unpSize: 10, flags: { encrypted: true, solid: false, directory: false } }), header({ name: 'open.pdf', unpSize: 10 })],
      { 'open.pdf': '%PDF-1.4 ok' },
    );

    const result = await extractPdfEntriesFromRar(Buffer.from('x'));
    expect(result.rejectedUnsafe).toEqual(['locked.pdf']);
    expect(result.entries.map((e) => e.filename)).toEqual(['open.pdf']);
  });

  it('never throws on an empty archive -- just returns no entries', async () => {
    mockExtractor([], {});
    await expect(extractPdfEntriesFromRar(Buffer.from('x'))).resolves.toEqual({ entries: [], skippedNonPdf: [], rejectedUnsafe: [] });
  });
});
