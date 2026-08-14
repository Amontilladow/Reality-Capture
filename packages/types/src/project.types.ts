export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export interface Project {
  id: string;
  companyId: string;
  name: string;
  code?: string;
  description?: string;
  location?: string;
  country?: string;
  city?: string;
  coordinates?: { lat: number; lng: number };
  status: ProjectStatus;
  phase?: ProjectPhase;
  startDate?: string;
  expectedEndDate?: string;
  coverImageUrl?: string;
  settings: ProjectSettings;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Stakeholder directory -- set once per project, pulled onto every RFI PDF.
  orgCode?: string;
  clientName?: string;
  leadDesigner?: string;
  consultantName?: string;
  technicalAdvisor?: string;
  pmcName?: string;
  mainContractor?: string;
  subcontractor?: string;
  // Branding for RFI PDFs -- one logo + one stamp per project. Storage
  // keys are the persisted values; the Url fields are presigned read URLs
  // resolved fresh on every fetch, never stored.
  logoStorageKey?: string;
  stampStorageKey?: string;
  logoUrl?: string;
  stampUrl?: string;
  // Computed / joined
  memberCount?: number;
  captureCount?: number;
  openIssueCount?: number;
}

export interface ProjectSettings {
  defaultPhase?: string;
  captureNamingPattern?: string;
  issueNumberPrefix?: string;
  enableAI?: boolean;
  enableBIM?: boolean;
}

export interface Building {
  id: string;
  projectId: string;
  companyId: string;
  name: string;
  code?: string;
  description?: string;
  totalLevels?: number;
  phase?: ProjectPhase;
  createdAt: string;
  updatedAt: string;
  levels?: Level[];
}

export interface Level {
  id: string;
  buildingId: string;
  companyId: string;
  name: string;
  elevationM?: number;
  levelOrder: number;
  createdAt: string;
  locations?: Location[];
}

export interface Location {
  id: string;
  levelId: string;
  companyId: string;
  name: string;
  description?: string;
  coordinatesOnPlan?: { x: number; y: number };
  createdAt: string;
  captureCount?: number;
  openIssueCount?: number;
}

// ── PROJECT PHASE ──────────────────────────────────────────────────────────────

export const PROJECT_PHASES = [
  'pre_construction',
  'demolition',
  'excavation',
  'foundation',
  'structure',
  'mep_rough_in',
  'external_envelope',
  'internal_fit_out',
  'finishes',
  'commissioning',
  'handover',
  'post_occupancy',
] as const;

export type ProjectPhase = typeof PROJECT_PHASES[number];

export const PROJECT_PHASE_LABELS: Record<ProjectPhase, string> = {
  pre_construction: 'Pre-Construction',
  demolition: 'Demolition',
  excavation: 'Excavation',
  foundation: 'Foundation',
  structure: 'Structure',
  mep_rough_in: 'MEP Rough-In',
  external_envelope: 'External Envelope',
  internal_fit_out: 'Internal Fit-Out',
  finishes: 'Finishes',
  commissioning: 'Commissioning',
  handover: 'Handover',
  post_occupancy: 'Post-Occupancy',
};
