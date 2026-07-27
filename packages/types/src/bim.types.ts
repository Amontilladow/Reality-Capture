export type BimModelStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface BimModel {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  format: 'IFC' | 'NWD' | 'RVT';
  ifcSchema?: 'IFC2X3' | 'IFC4' | 'IFC4.3';
  storageKey?: string;
  coordinationOrigin?: { x: number; y: number; z: number; rotation: number };
  status: BimModelStatus;
  version: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  elementCount?: number;
}

export interface BimElement {
  id: string;
  companyId: string;
  modelId: string;
  projectId: string;
  levelId?: string;
  ifcGuid: string;
  ifcType: string;
  ifcName?: string;
  ifcDescription?: string;
  omniclassCode?: string;
  uniclassCode?: string;
  uniformatCode?: string;
  csiMasterformat?: string;
  bbox?: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  properties: Record<string, unknown>;
  constructionStatus?: 'not_started' | 'in_progress' | 'complete' | 'defective';
  installedAt?: string;
  createdAt: string;
  updatedAt: string;
  openIssueCount?: number;
}

export interface CaptureElementLink {
  id: string;
  captureId: string;
  elementId: string;
  companyId: string;
  linkType: 'documents' | 'inspects' | 'issues';
  linkedBy: string;
  createdAt: string;
}
