// GIS Preparation (M4 ADM/DRM GIS drawing preparation) -- the platform side
// of apps/adm-gis-prep. Results are PRELIMINARY checks only: the official
// ADM/DRM QC tool and review decide acceptance, so no status here ever
// claims compliance or approval.

export const GIS_PREP_PROFILES = ['sdd_planning', 'bdms_building'] as const;
export type GisPrepProfile = (typeof GIS_PREP_PROFILES)[number];

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
  settings: GisPrepSettings;
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
