// GIS Preparation (M4 ADM/DRM GIS drawing preparation): the platform side
// of apps/adm-gis-prep. Results are PRELIMINARY checks only: the official
// ADM/DRM QC tool and review decide acceptance, so no status here ever
// claims compliance or approval.

export const GIS_PREP_PROFILES = ['sdd_planning', 'bdms_building'] as const;
export type GisPrepProfile = (typeof GIS_PREP_PROFILES)[number];

// The single source of truth for the maximum DXF/DWG upload size, shared by
// the frontend (GisPrepPage.tsx: pre-upload check + the limit it displays)
// and the API (gis-prep.service.ts: the post-upload size check before a job
// is ever queued -- see that file's own comment on why the presigned PUT
// itself can't enforce this). apps/ai-service's GIS_PREP_MAX_UPLOAD_MB
// (Python, routers/gis_prep.py) is the SAME number, kept in sync by hand --
// a Python service can't import a TS constant -- as the pipeline's own
// safety-net check. "MB" here means 1024*1024 bytes everywhere in this
// codebase's *_MB config (apps/ai-service/app/config.py and this value
// alike), never decimal 1,000,000-byte MB.
//
// 8 MB, not the 500 MB this replaced, and not the 30 MB once proposed as an
// operational target. GIS_30MB_CAPACITY_VALIDATION.md's own benchmark (5 to
// 30 MB, in 5 MB steps, each measured twice) found peak RSS of 196 MB at
// 5 MB, 313 MB at 10 MB, and 780 MB at 30 MB, against the engine's existing
// GIS_PREP_MEMORY_LIMIT_MB=270 MB per-process watcher inside a shared
// 512 MB container (apps/ai-service's own baseline already uses roughly
// 180-210 MB of that). 30 MB measured at 780 MB peak -- more than the
// ENTIRE container on its own, let alone alongside the service's own
// baseline and any concurrent OCR/assistant activity. 8 MB is the largest
// round number whose predicted peak RSS (this benchmark's own linear fit,
// ~80 + 23.3*MB) stays under the EXISTING 270 MB watcher threshold with NO
// other config change, leaving real margin rather than sitting exactly on
// the line one real-world drawing's extra complexity could cross.
export const GIS_PREP_MAX_UPLOAD_MB = 8;
export const GIS_PREP_MAX_UPLOAD_BYTES = GIS_PREP_MAX_UPLOAD_MB * 1024 * 1024;

// QUEUED/RUNNING/FAILED describe the platform job; READY/WARNINGS/BLOCKED
// mirror the tool's own statuses ("Ready for review" / "Prepared with
// warnings" / "Blocked ..."), whose exact wording is kept in statusLabel.
export type GisPrepJobStatus = 'QUEUED' | 'RUNNING' | 'READY_FOR_REVIEW' | 'PREPARED_WITH_WARNINGS' | 'BLOCKED' | 'FAILED';

// Passed through to the tool's JobSettings (apps/adm-gis-prep/src/m4adm/models.py),
// which is the validator of record.
export interface GisPrepSettings {
  profile: GisPrepProfile;
  strict: boolean;
  categories: string[];
  metadata: Record<string, string>;
  crs: {
    source_crs?: string | null;
    source_confirmed: boolean;
    target_crs?: string;
    confirm_transformation?: boolean;
    control_points?: [[number, number], [number, number]][];
    max_georef_rms?: number;
  };
  units_confirmed_metres: boolean;
  layer_mapping?: Record<string, string>;
  handle_mapping?: Record<string, string>;
  accepted_fixes?: string[];
}

// CAD-to-GIS conversion of an architectural floor plan into a DRM BDMS draft (m4adm.convert.ConversionSettings).
export interface GisConvertSettings {
  mode: 'convert';
  profile: 'bdms_building';
  metadata: Record<string, string>;
  source_units?: 'auto' | 'mm' | 'cm' | 'm';
  single_unit_number?: string;
  wall_layers?: string[];
  floor_height?: string;
  building_number_of_floors?: string;
  building_height?: string;
  building_usage_category?: string;
  building_usage_type?: string;
  title_values?: Record<string, string>;
  unit_values?: Record<string, string>;
  crs?: {
    target_crs?: string;
    control_points?: [[number, number], [number, number]][];
    confirm_transformation?: boolean;
    max_georef_rms?: number;
  };
  feature_decisions?: Record<string, { action: 'accept' | 'reject'; attributes?: Record<string, string> }>;
}

export interface GisPrepCounts {
  errors: number;
  warnings: number;
  info: number;
  openDecisions: number;
}

export interface GisPrepOutputFile {
  path: string;
  storageKey: string;
  sizeBytes: number;
  url?: string;
}

export interface GisPrepJob {
  id: string;
  companyId: string;
  projectId: string;
  profile: GisPrepProfile;
  sourceFilename: string;
  sourceStorageKey: string;
  sourceSha256?: string;
  status: GisPrepJobStatus;
  statusLabel?: string;
  toolJobId?: string;
  counts?: GisPrepCounts;
  settings: GisPrepSettings | GisConvertSettings;
  outputs: GisPrepOutputFile[];
  packageStorageKey?: string;
  packageUrl?: string;
  // The tool's qc_report.json, included only on the single-job read.
  report?: Record<string, unknown>;
  errorMessage?: string;
  parentJobId?: string;
  createdBy: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}
