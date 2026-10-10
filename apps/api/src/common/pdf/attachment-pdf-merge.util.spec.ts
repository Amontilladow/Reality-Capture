import { PDFDocument } from 'pdf-lib';
import { mergeAttachmentPdfs, type MergeableAttachment } from './attachment-pdf-merge.util';

async function makeSummaryBuffer(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe('mergeAttachmentPdfs', () => {
  it('returns the summary unchanged when there are no attachments', async () => {
    const summary = await makeSummaryBuffer();
    const merged = await mergeAttachmentPdfs(summary, [], { download: jest.fn() });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);
  });

  it('skips an attachment with no storageKey (text-line-only representation)', async () => {
    const summary = await makeSummaryBuffer();
    const attachments: MergeableAttachment[] = [{ filename: 'spec.docx', typeLabel: 'Other' }];
    const merged = await mergeAttachmentPdfs(summary, attachments, { download: jest.fn() });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1); // no divider/content page added
  });

  it('skips an unsupported extension even with a storageKey (e.g. .zip)', async () => {
    const summary = await makeSummaryBuffer();
    const attachments: MergeableAttachment[] = [{ filename: 'archive.zip', storageKey: 'k1', typeLabel: 'Other' }];
    const download = jest.fn();
    const merged = await mergeAttachmentPdfs(summary, attachments, { download });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);
    expect(download).not.toHaveBeenCalled(); // never even attempted -- extension check happens first
  });

  it('appends a divider page + the real pages for a mergeable PDF attachment', async () => {
    const summary = await makeSummaryBuffer();
    const attachmentDoc = await PDFDocument.create();
    attachmentDoc.addPage([150, 150]);
    attachmentDoc.addPage([150, 150]);
    const attachmentBytes = Buffer.from(await attachmentDoc.save());

    const attachments: MergeableAttachment[] = [{ filename: 'drawing.pdf', storageKey: 'k1', typeLabel: 'Drawing' }];
    const merged = await mergeAttachmentPdfs(summary, attachments, { download: async () => attachmentBytes });
    const doc = await PDFDocument.load(merged);
    // 1 summary page + 1 divider page + 2 real attachment pages
    expect(doc.getPageCount()).toBe(4);
  });

  it('isolates one attachment\'s download failure from the rest -- the good attachment still merges', async () => {
    const summary = await makeSummaryBuffer();
    const attachmentDoc = await PDFDocument.create();
    attachmentDoc.addPage([150, 150]);
    const goodBytes = Buffer.from(await attachmentDoc.save());

    const attachments: MergeableAttachment[] = [
      { filename: 'corrupt.pdf', storageKey: 'bad', typeLabel: 'Other' },
      { filename: 'good.pdf', storageKey: 'good', typeLabel: 'Other' },
    ];
    const download = jest.fn(async (key: string) => {
      if (key === 'bad') throw new Error('network error');
      return goodBytes;
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const merged = await mergeAttachmentPdfs(summary, attachments, { download });
    warnSpy.mockRestore();

    const doc = await PDFDocument.load(merged);
    // 1 summary + (divider + 1 page) for the good attachment only
    expect(doc.getPageCount()).toBe(3);
  });
});
