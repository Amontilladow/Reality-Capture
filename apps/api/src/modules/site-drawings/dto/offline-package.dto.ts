import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import { SITE_DRAWING_OFFLINE_PACKAGE_STATUSES, type SiteDrawingOfflinePackageStatus } from '@engineeringos/types';

// Starts tracking an offline download (brief section 8) -- the PDF bytes
// themselves are downloaded straight from a short-lived presigned URL
// (SiteDrawingsService.getAuthorizedDownloadUrl) directly into the
// browser's IndexedDB; this record is metadata only, used for revalidation
// and to drive the OFFLINE/last-verified UI.
export class StartOfflinePackageDto {
  @IsUUID()
  revisionId!: string;
}

// Reports the outcome of the client-side download -- a partial/corrupted
// download must never be silently presented as a complete package (section
// 8/10), so the client reports exactly what happened rather than the
// server assuming success.
export class CompleteOfflinePackageDto {
  @IsIn(SITE_DRAWING_OFFLINE_PACKAGE_STATUSES)
  status!: SiteDrawingOfflinePackageStatus;

  @IsOptional() @IsString() @IsNotEmpty()
  contentHash?: string;

  @IsOptional() @IsInt() @IsPositive()
  fileSizeBytes?: number;
}
