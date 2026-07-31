import type { ProjectPhase } from './project.types';

export type CaptureType = 'photo_360' | 'photo_standard' | 'video';
export type CaptureStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export interface Capture {
  id: string;
  companyId: string;
  projectId: string;
  locationId?: string;
  capturedBy: string;
  captureType: CaptureType;
  phase?: ProjectPhase;
  title?: string;
  description?: string;
  tags: string[];
  capturedAt: string;
  uploadedAt: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracyM?: number;
  compassHeadingDeg?: number;
  originalKey: string;
  originalSizeBytes: number;
  originalMimeType: string;
  originalWidthPx?: number;
  originalHeightPx?: number;
  status: CaptureStatus;
  processingError?: string;
  processedAt?: string;
  aiTags: string[];
  aiDescription?: string;
  aiDetectedIssues?: AiDetectedIssue[];
  createdAt: string;
  updatedAt: string;
  // Joined
  renditions?: CaptureRendition[];
  hotspots?: Hotspot[];
  thumbnailUrl?: string;    // convenience: resolved URL for the thumbnail_sm rendition
  previewUrl?: string;      // convenience: resolved URL for the preview rendition
  locationName?: string;
  levelName?: string;
  buildingName?: string;
}

export interface AiDetectedIssue {
  type: 'structural' | 'safety' | 'quality' | 'progress';
  description: string;
  confidence: number; // 0-1
  boundingBox?: { x: number; y: number; w: number; h: number }; // normalized 0-1
}

export interface CaptureRendition {
  id: string;
  captureId: string;
  companyId: string;
  renditionType: 'thumbnail_sm' | 'thumbnail_lg' | 'preview' | 'optimized';
  storageKey: string;
  widthPx?: number;
  heightPx?: number;
  sizeBytes: number;
  url?: string; // resolved presigned URL
  createdAt: string;
}

export interface Hotspot {
  id: string;
  sourceCaptureId: string;
  targetCaptureId?: string;
  companyId: string;
  hotspotType: 'navigation' | 'info' | 'annotation' | 'issue';
  label?: string;
  content?: string;
  yawDeg: number;
  pitchDeg: number;
  iconName?: string;
  color?: string;
  createdBy: string;
  createdAt: string;
}

// Upload flow — client requests a presigned URL, uploads directly to S3,
// then calls the register endpoint to create the capture record
export interface UploadUrlRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  captureType: CaptureType;
  locationId?: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;         // presigned S3 PUT URL
  storageKey: string;        // key to pass back in register
  expiresIn: number;         // seconds
}

export interface RegisterCaptureDto {
  storageKey: string;
  originalSizeBytes: number;
  originalMimeType: string;
  captureType: CaptureType;
  capturedAt: string;
  locationId?: string;
  phase?: ProjectPhase;
  title?: string;
  description?: string;
  tags?: string[];
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracyM?: number;
  compassHeadingDeg?: number;
}
