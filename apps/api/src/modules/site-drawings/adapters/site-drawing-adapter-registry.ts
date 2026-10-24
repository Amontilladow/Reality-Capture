import { Injectable } from '@nestjs/common';
import type { SiteDrawingSourceProvider } from '@engineeringos/types';
import { SiteDrawingLocalAdapter } from './local-adapter';
import { SiteDrawingSharePointAdapter } from './sharepoint-adapter';
import type { DrawingSourceAdapter } from './drawing-source-adapter.interface';

// Resolves a DrawingSourceAdapter by provider -- the one place
// SiteDrawingsService (and, later, a sync-job scheduler) looks up which
// adapter to call, instead of each caller hardcoding which concrete
// adapter class a given provider string maps to. New providers (Aconex,
// Procore) register here and nowhere else needs to change.
@Injectable()
export class SiteDrawingAdapterRegistry {
  private readonly byProvider: Map<SiteDrawingSourceProvider, DrawingSourceAdapter>;

  constructor(
    localAdapter: SiteDrawingLocalAdapter,
    sharePointAdapter: SiteDrawingSharePointAdapter,
  ) {
    this.byProvider = new Map<SiteDrawingSourceProvider, DrawingSourceAdapter>([
      [localAdapter.provider, localAdapter],
      [sharePointAdapter.provider, sharePointAdapter],
    ]);
  }

  resolve(provider: SiteDrawingSourceProvider): DrawingSourceAdapter | undefined {
    return this.byProvider.get(provider);
  }
}
