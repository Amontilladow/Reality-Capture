import sharp from 'sharp';
import type { Job } from 'bull';
import { ImageProcessingProcessor, type ImageProcessingJob } from './image-processing.processor';
import type { DatabaseService } from '../../../database/database.service';
import type { StorageService } from '../../storage/storage.service';

// Tagged-template mock: `this.db.query\`...\`` just calls query(strings, ...values).
// A plain jest.fn() works as the tag function directly. All DB access in this processor
// now goes through withTenant -- forward its callback to the same query mock so every
// existing db.query.mock.calls assertion below still sees the same call sequence.
function makeDb() {
  const query = jest.fn().mockResolvedValue([]);
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
  return { query, withTenant } as unknown as DatabaseService & { query: jest.Mock; withTenant: jest.Mock };
}

function makeStorage() {
  const uploads: { key: string; body: Buffer; contentType: string }[] = [];
  return {
    download: jest.fn(),
    upload: jest.fn(async (key: string, body: Buffer, contentType: string) => {
      uploads.push({ key, body, contentType });
    }),
    generateKey: jest.fn((_companyId: string, _projectId: string, _type: string, filename: string) => `key/${filename}`),
    __uploads: uploads,
  } as unknown as StorageService & { download: jest.Mock; __uploads: typeof uploads };
}

function makeJob(overrides: Partial<{
  captureId: string; companyId: string; projectId: string; storageKey: string;
  mimeType: string; captureType: 'photo_360' | 'photo_standard' | 'video';
}> = {}) {
  return {
    data: {
      captureId: 'capture-1',
      companyId: 'company-1',
      projectId: 'project-1',
      storageKey: 'company-1/captures/project-1/original.jpg',
      mimeType: 'image/jpeg',
      captureType: 'photo_standard',
      ...overrides,
    },
  } as unknown as Job<ImageProcessingJob>;
}

async function makeTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } } })
    .jpeg()
    .toBuffer();
}

describe('ImageProcessingProcessor', () => {
  it('generates 3 real renditions (thumbnail_sm, thumbnail_lg, preview) and marks the capture ready', async () => {
    const db = makeDb();
    const storage = makeStorage();
    storage.download.mockResolvedValue(await makeTestImage(1600, 1600));
    const processor = new ImageProcessingProcessor(db, storage);

    await processor.handleProcessCapture(makeJob({ captureType: 'photo_standard' }));

    expect(storage.__uploads).toHaveLength(3);
    const types = storage.__uploads.map((u: { key: string }) => u.key);
    expect(types.some((k: string) => k.includes('thumbnail_sm'))).toBe(true);
    expect(types.some((k: string) => k.includes('thumbnail_lg'))).toBe(true);
    expect(types.some((k: string) => k.includes('preview'))).toBe(true);

    // Every uploaded buffer must be a real, valid JPEG sharp can re-read.
    for (const upload of storage.__uploads) {
      const meta = await sharp(upload.body).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    }

    // 3 INSERT INTO capture_renditions + 1 final UPDATE captures
    expect(db.query).toHaveBeenCalledTimes(4);
    const lastCallSql = (db.query.mock.calls.at(-1)[0] as TemplateStringsArray).join('');
    expect(lastCallSql).toContain("status = 'ready'");
  });

  it('produces an exactly-2:1 preview for photo_360 (fit: fill), not a letterboxed one', async () => {
    const db = makeDb();
    const storage = makeStorage();
    storage.download.mockResolvedValue(await makeTestImage(4000, 2000)); // real 2:1 equirectangular
    const processor = new ImageProcessingProcessor(db, storage);

    await processor.handleProcessCapture(makeJob({ captureType: 'photo_360' }));

    const preview = storage.__uploads.find((u: { key: string }) => u.key.includes('preview'));
    if (!preview) throw new Error('Expected a preview rendition to be uploaded.');
    const meta = await sharp(preview.body).metadata();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(960);
  });

  it('does not fail processing when a photo_360 capture is not actually 2:1 (warns, continues)', async () => {
    const db = makeDb();
    const storage = makeStorage();
    storage.download.mockResolvedValue(await makeTestImage(1000, 1000)); // square, not 2:1
    const processor = new ImageProcessingProcessor(db, storage);

    await expect(processor.handleProcessCapture(makeJob({ captureType: 'photo_360' }))).resolves.not.toThrow();
    expect(storage.__uploads).toHaveLength(3);
    const lastCallSql = (db.query.mock.calls.at(-1)[0] as TemplateStringsArray).join('');
    expect(lastCallSql).toContain("status = 'ready'");
  });

  it('passes video captures straight to ready without downloading or processing anything', async () => {
    const db = makeDb();
    const storage = makeStorage();
    const processor = new ImageProcessingProcessor(db, storage);

    await processor.handleProcessCapture(makeJob({ captureType: 'video' }));

    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = (db.query.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(sql).toContain("status = 'ready'");
  });

  it('marks the capture failed and re-throws when download fails, without ever writing a partial rendition', async () => {
    const db = makeDb();
    const storage = makeStorage();
    storage.download.mockRejectedValue(new Error('S3 object not found'));
    const processor = new ImageProcessingProcessor(db, storage);

    await expect(processor.handleProcessCapture(makeJob())).rejects.toThrow('S3 object not found');

    expect(storage.upload).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = (db.query.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(sql).toContain("status = 'failed'");
  });
});
