import { ZipFile } from 'yazl';
import { extractPdfEntriesFromZip, type ZipExtractionLimits } from './zip-extraction.util';

async function buildZip(entries: { name: string; content: string }[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.content), entry.name);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// yazl's own addBuffer() refuses to even construct a path-traversal entry
// name (validateMetadataPath throws "invalid relative path") -- the exact
// same class of defense this test exists to prove the READ side
// (extractPdfEntriesFromZip, via yauzl.validateFileName) also has. To
// build a fixture a well-behaved zip WRITER would never produce, this
// writes the raw ZIP binary format directly (STORED/uncompressed, single
// entry, no real CRC since the malicious entry is expected to be rejected
// before its data is ever read).
function buildRawZipWithUnsafeName(unsafeName: string, content: string): Buffer {
  const nameBuf = Buffer.from(unsafeName);
  const dataBuf = Buffer.from(content);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // compression: stored
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0x21, 12); // mod date (a valid arbitrary DOS date)
  localHeader.writeUInt32LE(0, 14); // crc32 (unchecked -- entry is rejected before read)
  localHeader.writeUInt32LE(dataBuf.length, 18); // compressed size
  localHeader.writeUInt32LE(dataBuf.length, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26); // filename length
  localHeader.writeUInt16LE(0, 28); // extra field length

  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0); // central directory signature
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(0, 10); // compression: stored
  centralHeader.writeUInt16LE(0, 12); // mod time
  centralHeader.writeUInt16LE(0x21, 14); // mod date
  centralHeader.writeUInt32LE(0, 16); // crc32
  centralHeader.writeUInt32LE(dataBuf.length, 20); // compressed size
  centralHeader.writeUInt32LE(dataBuf.length, 24); // uncompressed size
  centralHeader.writeUInt16LE(nameBuf.length, 28); // filename length
  centralHeader.writeUInt16LE(0, 30); // extra field length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(0, 42); // relative offset of local header

  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralEntry.length, 12); // size of central directory
  eocd.writeUInt32LE(localEntry.length, 16); // offset of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localEntry, centralEntry, eocd]);
}

describe('extractPdfEntriesFromZip', () => {
  it('extracts every .pdf entry and skips (not rejects) a non-pdf entry', async () => {
    const zip = await buildZip([
      { name: 'A-101.pdf', content: '%PDF-1.4 fake content A' },
      { name: 'S-201.pdf', content: '%PDF-1.4 fake content S' },
      { name: 'readme.txt', content: 'not a drawing' },
    ]);

    const result = await extractPdfEntriesFromZip(zip);

    expect(result.entries.map((e) => e.filename).sort()).toEqual(['A-101.pdf', 'S-201.pdf']);
    expect(result.skippedNonPdf).toEqual(['readme.txt']);
    expect(result.rejectedUnsafe).toEqual([]);
    expect(result.entries.find((e) => e.filename === 'A-101.pdf')?.buffer.toString()).toBe('%PDF-1.4 fake content A');
  });

  it('rejects (brief section 2) the whole archive on a path-traversal entry name, never extracting anything from it', async () => {
    const zip = buildRawZipWithUnsafeName('../../etc/passwd.pdf', 'malicious');
    await expect(extractPdfEntriesFromZip(zip)).rejects.toThrow(/invalid relative path/);
  });

  it('rejects the whole archive on an absolute-path entry name', async () => {
    const zip = buildRawZipWithUnsafeName('/etc/passwd.pdf', 'malicious');
    await expect(extractPdfEntriesFromZip(zip)).rejects.toThrow(/absolute path/);
  });

  it('rejects an archive with more entries than the configured cap (zip-bomb-shaped entry count)', async () => {
    const manyEntries = Array.from({ length: 5 }, (_, i) => ({ name: `d-${i}.pdf`, content: `%PDF-1.4 ${i}` }));
    const zip = await buildZip(manyEntries);
    const limits: ZipExtractionLimits = { maxEntryCount: 3, maxTotalUncompressedBytes: 10 * 1024 * 1024, maxSingleFileBytes: 1024 * 1024 };

    await expect(extractPdfEntriesFromZip(zip, limits)).rejects.toThrow(/more than 3 entries/);
  });

  it('rejects a single file exceeding the per-file cap, but continues processing the rest of the archive', async () => {
    const zip = await buildZip([
      { name: 'too-big.pdf', content: 'x'.repeat(1000) },
      { name: 'fine.pdf', content: '%PDF-1.4 ok' },
    ]);
    const limits: ZipExtractionLimits = { maxEntryCount: 10, maxTotalUncompressedBytes: 10 * 1024 * 1024, maxSingleFileBytes: 500 };

    const result = await extractPdfEntriesFromZip(zip, limits);
    expect(result.rejectedUnsafe).toEqual(['too-big.pdf']);
    expect(result.entries.map((e) => e.filename)).toEqual(['fine.pdf']);
  });

  it('rejects the whole archive once the running TOTAL uncompressed size exceeds the cap, even with small individual files', async () => {
    const zip = await buildZip([
      { name: 'a.pdf', content: 'x'.repeat(100) },
      { name: 'b.pdf', content: 'x'.repeat(100) },
    ]);
    const limits: ZipExtractionLimits = { maxEntryCount: 10, maxTotalUncompressedBytes: 150, maxSingleFileBytes: 1_000_000 };

    await expect(extractPdfEntriesFromZip(zip, limits)).rejects.toThrow(/total uncompressed size exceeds/);
  });

  it('never throws on an empty archive -- just returns no entries', async () => {
    const zip = await buildZip([]);
    await expect(extractPdfEntriesFromZip(zip)).resolves.toEqual({ entries: [], skippedNonPdf: [], rejectedUnsafe: [] });
  });
});
