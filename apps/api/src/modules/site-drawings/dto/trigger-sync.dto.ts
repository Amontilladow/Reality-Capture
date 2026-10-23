import { IsIn, IsOptional } from 'class-validator';
import type { SiteDrawingSourceProvider } from '@engineeringos/types';

// Only 'sharepoint' has a real listDrawings() implementation today (see
// SiteDrawingAdapterRegistry) -- defaulting to it rather than requiring
// the caller to name it keeps the "Sync now" button a single click, while
// still accepting an explicit provider for when a second real adapter
// (Aconex/Procore) exists.
export class TriggerSiteDrawingSyncDto {
  @IsOptional() @IsIn(['sharepoint', 'aconex', 'procore'])
  provider?: SiteDrawingSourceProvider;
}
