import { BadRequestException } from '@nestjs/common';
import { SiteDrawingSharePointAdapter } from './sharepoint-adapter';
import type { DatabaseService } from '../../../database/database.service';
import type { SharePointGraphClient } from './sharepoint-graph-client';

const companyId = 'company-1';
const projectId = 'project-1';
const tenantId = 'tenant-abc';
const driveId = 'drive-1';
const siteId = 'site-1';

function configRow(overrides: Record<string, unknown> = {}) {
  return [{
    config: {
      tenantId,
      projectSites: {
        [projectId]: { siteId, driveId, ...overrides },
      },
    },
  }];
}

// Models this.db.withTenant(companyId, (sql) => sql`...`) the same way
// site-drawings.service.spec.ts's single()/multi() helpers do, but the
// adapter only ever issues exactly one statement per withTenant call, so
// one queue of "next result" is enough.
function makeDb(results: unknown[]) {
  let i = 0;
  const withTenant = jest.fn((_companyId: string, callback: (sql: unknown) => unknown) => {
    const result = results[i++] ?? [];
    return callback(() => Promise.resolve(result));
  });
  return { withTenant } as unknown as DatabaseService;
}

function makeGraph() {
  return {
    get: jest.fn(),
    getCurrentDownloadUrl: jest.fn(),
    getVersionContentUrl: jest.fn(),
    post: jest.fn(),
  } as unknown as SharePointGraphClient & { get: jest.Mock; getCurrentDownloadUrl: jest.Mock; getVersionContentUrl: jest.Mock };
}

describe('SiteDrawingSharePointAdapter', () => {
  describe('requireProjectSite (via listDrawings)', () => {
    it('throws a clear, specific error when the company has no SharePoint connection at all', async () => {
      const db = makeDb([[]]);
      const adapter = new SiteDrawingSharePointAdapter(db, makeGraph());
      await expect(adapter.listDrawings(companyId, projectId)).rejects.toThrow(BadRequestException);
      await expect(adapter.listDrawings(companyId, projectId)).rejects.toThrow(/not connected/);
    });

    it('throws a clear, specific error when the project is not mapped to a site, even though the company IS connected', async () => {
      const db = makeDb([[{ config: { tenantId, projectSites: {} } }]]);
      const adapter = new SiteDrawingSharePointAdapter(db, makeGraph());
      await expect(adapter.listDrawings(companyId, projectId)).rejects.toThrow(/not mapped/);
    });
  });

  describe('listDrawings', () => {
    it('maps a driveItem to a DiscoveredDrawing, filters out non-PDF files, and falls back to the filename when no column is configured', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.get
        .mockResolvedValueOnce({
          value: [
            { id: 'item-1', name: 'A-101.pdf', webUrl: 'https://sp/A-101.pdf', lastModifiedDateTime: '2026-01-01T00:00:00Z', size: 1024, listItem: { fields: {} } },
            { id: 'item-2', name: 'notes.docx', webUrl: 'https://sp/notes.docx', lastModifiedDateTime: '2026-01-01T00:00:00Z', listItem: { fields: {} } },
          ],
        }) // children page
        .mockResolvedValueOnce({ value: [{ id: '2.0', lastModifiedDateTime: '2026-01-02T00:00:00Z' }] }); // versions for item-1 (latestVersionLabel)

      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      const result = await adapter.listDrawings(companyId, projectId);

      expect(result).toHaveLength(1); // the .docx is filtered out
      expect(result[0].sourceFileId).toBe('item-1');
      expect(result[0].drawingNumber).toBe('A-101');
      expect(result[0].drawingTitle).toBe('A-101');
      expect(result[0].revisionNumber).toBe('2.0'); // real SharePoint version label, not a guess
      expect(result[0].sourceStatusRaw).toBeUndefined(); // never inferred -- no statusField configured
      expect(result[0].contentHash).toBeUndefined(); // never seeded from SharePoint's own hash (see adapter's own comment)
    });

    it('uses configured column names instead of the filename when they are present', async () => {
      const db = makeDb([configRow({ drawingNumberField: 'DrawingNo', statusField: 'ApprovalStatus', revisionNumberField: 'RevisionLabel' })]);
      const graph = makeGraph();
      graph.get.mockResolvedValueOnce({
        value: [{
          id: 'item-1', name: 'export-final.pdf', webUrl: 'https://sp/x.pdf', lastModifiedDateTime: '2026-01-01T00:00:00Z',
          listItem: { fields: { DrawingNo: 'A-101', ApprovalStatus: 'Approved for Construction', RevisionLabel: 'C' } },
        }],
      });

      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      const [result] = await adapter.listDrawings(companyId, projectId);

      expect(result.drawingNumber).toBe('A-101');
      expect(result.sourceStatusRaw).toBe('Approved for Construction');
      expect(result.revisionNumber).toBe('C');
      // No extra versions call was needed since revisionNumberField was configured.
      expect(graph.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('listRevisions', () => {
    it('returns one entry per SharePoint version, newest first, each carrying its own sourceRevisionId', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.get
        .mockResolvedValueOnce({ id: 'item-1', name: 'A-101.pdf', webUrl: 'https://sp/A-101.pdf', lastModifiedDateTime: '2026-01-03T00:00:00Z', listItem: { fields: {} } })
        .mockResolvedValueOnce({
          value: [
            { id: '1.0', lastModifiedDateTime: '2026-01-01T00:00:00Z' },
            { id: '2.0', lastModifiedDateTime: '2026-01-03T00:00:00Z' },
          ],
        });

      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      const result = await adapter.listRevisions(companyId, projectId, 'item-1');

      expect(result.map((r) => r.sourceRevisionId)).toEqual(['2.0', '1.0']);
    });

    it('returns an empty array when the item no longer exists (never pretends a revision history for a deleted file)', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.get.mockResolvedValueOnce(null);
      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      await expect(adapter.listRevisions(companyId, projectId, 'missing')).resolves.toEqual([]);
    });
  });

  describe('getAuthorizedFile', () => {
    it('resolves the CURRENT download URL when no sourceRevisionId is given', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.getCurrentDownloadUrl.mockResolvedValueOnce('https://signed.example/current');
      const adapter = new SiteDrawingSharePointAdapter(db, graph);

      const result = await adapter.getAuthorizedFile(companyId, projectId, 'item-1');

      expect(result.url).toBe('https://signed.example/current');
      expect(graph.getVersionContentUrl).not.toHaveBeenCalled();
    });

    it('resolves a SPECIFIC historical version\'s URL when sourceRevisionId is given', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.getVersionContentUrl.mockResolvedValueOnce('https://signed.example/v1');
      const adapter = new SiteDrawingSharePointAdapter(db, graph);

      const result = await adapter.getAuthorizedFile(companyId, projectId, 'item-1', '1.0');

      expect(result.url).toBe('https://signed.example/v1');
      expect(graph.getCurrentDownloadUrl).not.toHaveBeenCalled();
      expect(graph.getVersionContentUrl).toHaveBeenCalledWith(tenantId, driveId, 'item-1', '1.0');
    });

    it('never silently returns a missing URL as success', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.getCurrentDownloadUrl.mockResolvedValueOnce(null);
      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      await expect(adapter.getAuthorizedFile(companyId, projectId, 'item-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSourceHealth', () => {
    it('reports unreachable with a specific reason when the company has no connection', async () => {
      const db = makeDb([[]]);
      const adapter = new SiteDrawingSharePointAdapter(db, makeGraph());
      const result = await adapter.getSourceHealth(companyId, projectId);
      expect(result.reachable).toBe(false);
      expect(result.detail).toMatch(/not connected/);
    });

    it('reports reachable after a successful lightweight Graph call', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.get.mockResolvedValueOnce({ id: 'drive-1' });
      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      const result = await adapter.getSourceHealth(companyId, projectId);
      expect(result.reachable).toBe(true);
    });

    it('never throws out of getSourceHealth itself -- a Graph failure is reported, not propagated', async () => {
      const db = makeDb([configRow()]);
      const graph = makeGraph();
      graph.get.mockRejectedValueOnce(new Error('network down'));
      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      const result = await adapter.getSourceHealth(companyId, projectId);
      expect(result.reachable).toBe(false);
    });
  });

  describe('checkForChanges', () => {
    it('persists the new delta link and reports true when a relevant (PDF) change is found', async () => {
      const db = makeDb([configRow(), []]); // getConfig (via requireProjectSite), then the deltaLink UPDATE
      const graph = makeGraph();
      graph.get.mockResolvedValueOnce({
        value: [{ id: 'item-1', name: 'A-101.pdf', webUrl: 'x', lastModifiedDateTime: '2026-01-01T00:00:00Z' }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?token=next',
      });

      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      const result = await adapter.checkForChanges(companyId, projectId, '2025-12-01T00:00:00Z');

      expect(result).toBe(true);
      expect((db.withTenant as jest.Mock).mock.calls.length).toBe(2); // one read, one write of the delta link
    });

    it('reports false when the delta page has no PDF changes', async () => {
      const db = makeDb([configRow(), []]);
      const graph = makeGraph();
      graph.get.mockResolvedValueOnce({ value: [{ id: 'item-2', name: 'notes.docx', webUrl: 'x', lastModifiedDateTime: '2026-01-01T00:00:00Z' }] });
      const adapter = new SiteDrawingSharePointAdapter(db, graph);
      await expect(adapter.checkForChanges(companyId, projectId, '2025-12-01T00:00:00Z')).resolves.toBe(false);
    });
  });
});
