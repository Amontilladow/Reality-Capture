import { Injectable } from '@nestjs/common';
import type { DrawingSourceAdapter, DiscoveredDrawing, SourceHealthCheck } from './drawing-source-adapter.interface';

// The 'internal' provider: drawings registered directly by an authorized
// user through the Site Drawing Hub's own upload form (SiteDrawingsService.
// registerLocalDrawing()), not discovered from an external system. This is
// the genuinely real, immediately usable "first source" this phase ships
// with (brief section 6: "Integrate the first source for which valid API
// access and administrator authorization are available") -- our own
// platform's storage needs no third-party credentials, API access, or admin
// authorization beyond the project permissions that already gate every
// other write in this app.
//
// listDrawings()/getDrawingMetadata() have nothing to discover (there is no
// external catalog to poll) -- implemented as honest no-ops rather than
// omitted, so SiteDrawingSyncService can still run a "sync" for this
// provider (it simply confirms zero changes) and the health-check UI has a
// real, reachable status to show for Local, not a blank.
@Injectable()
export class SiteDrawingLocalAdapter implements DrawingSourceAdapter {
  readonly provider = 'internal' as const;

  async listDrawings(_companyId: string, _projectId: string): Promise<DiscoveredDrawing[]> {
    return [];
  }

  async getDrawingMetadata(_companyId: string, _projectId: string, _sourceFileId: string): Promise<DiscoveredDrawing | null> {
    return null;
  }

  async getSourceHealth(_companyId: string, _projectId: string): Promise<SourceHealthCheck> {
    return { reachable: true, detail: 'Local uploads require no external connection.' };
  }
}
