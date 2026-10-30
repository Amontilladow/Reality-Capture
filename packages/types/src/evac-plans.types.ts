// 3D Evacuation Plans -- the platform side of apps/evac3d-service, which turns
// a batch of 2D evacuation-plan PDFs into 3D evacuation-plan sheets. Every
// result is a DRAFT for the appointed Fire & Life Safety consultant's review:
// no status here claims code compliance or Civil Defence approval.

// QUEUED/RUNNING/FAILED describe the platform job; READY_FOR_REVIEW means every
// sheet converted with no automatic flag, NEEDS_ATTENTION that at least one
// sheet carries a flag (or failed) and must be checked on its comparison sheet.
export type EvacPlanJobStatus = 'QUEUED' | 'RUNNING' | 'READY_FOR_REVIEW' | 'NEEDS_ATTENTION' | 'FAILED';

export interface EvacPlanSourceFile {
  filename: string;
  storageKey: string;
  sizeBytes: number;
}

export interface EvacPlanSettings {
  // Shown in each sheet's traceability line, e.g. "P01 (draft)".
  revision?: string;
  // Project-specific observations added to the QC report's "unclear geometry" list.
  notes?: string[];
}

export interface EvacPlanSheetProgress {
  code: string;
  floor: string;
  file: string;
  status: 'queued' | 'modelling' | 'rendering' | 'done' | 'failed';
  error?: string;
}

export interface EvacPlanProgress {
  stage?: string;
  total?: number;
  done?: number;
  current?: string | null;
  sheets?: EvacPlanSheetProgress[];
}

// One sheet of the engine's report.json.
export interface EvacPlanSheetReport {
  code: string;
  floor: string;
  floorName: string;
  file: string;
  symbols: Record<string, number>;
  routeSegments: number;
  unreachedPx: number;
  arrowsAgree: number;
  arrowsTotal: number;
  stairs: number;
  youAreHere: boolean;
  azimuth?: number;
  flags: string[];
}

export interface EvacPlanReport {
  kind: 'evacuation-plans';
  status: 'READY_FOR_REVIEW' | 'NEEDS_ATTENTION';
  statusLabel: string;
  draft: true;
  sheets: EvacPlanSheetReport[];
  failedSheets: { code: string; file: string; error: string }[];
  floors: string[];
  logoSupplied: boolean;
  generatedAt: string;
}

export interface EvacPlanOutputFile {
  path: string;
  storageKey: string;
  sizeBytes: number;
  url?: string;
}

export interface EvacPlanJob {
  id: string;
  companyId: string;
  projectId: string;
  sourceFiles: EvacPlanSourceFile[];
  logoStorageKey?: string;
  settings: EvacPlanSettings;
  status: EvacPlanJobStatus;
  statusLabel?: string;
  progress?: EvacPlanProgress;
  outputs: EvacPlanOutputFile[];
  // Combined PDF (plans + QC comparisons + QC report) and the full zip.
  planPdfUrl?: string;
  packageUrl?: string;
  // The engine's report.json, included only on the single-job read.
  report?: EvacPlanReport;
  errorMessage?: string;
  createdBy: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}
