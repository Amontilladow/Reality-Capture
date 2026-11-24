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
// 30 MB, not the 500 MB this replaced: GIS_PREP_MEMORY_REMEDIATION.md's own
// benchmark measured ~24-33x inflation from DXF file size to the engine's
// peak resident memory, inside a 512 MB container shared with another
// service -- 500 MB was never actually safe to process, only accepted by
// the API before being handed to a service that would have rejected or
// OOM'd on anything much past ~20-25 MB.
export const GIS_PREP_MAX_UPLOAD_MB = 30;
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
