export type RfiStatus = 'open' | 'answered' | 'closed' | 'void';
export type RfiPriority = 'critical' | 'high' | 'medium' | 'low';

export const RFI_DISCIPLINES = [
  'civil',
  'structural',
  'architectural',
  'interior_design',
  'mechanical',
  'electrical',
  'plumbing',
  'hvac',
  'other',
] as const;

export type RfiDiscipline = typeof RFI_DISCIPLINES[number];

export const RFI_DISCIPLINE_LABELS: Record<RfiDiscipline, string> = {
  civil: 'Civil',
  structural: 'Structural',
  architectural: 'Architectural',
  interior_design: 'Interior Design',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  other: 'Other',
};

// Short codes used in the RFI numbering scheme:
// {ProjectCode}-{OrgCode}-RFI-{DisciplineCode}-{0001}
export const RFI_DISCIPLINE_CODES: Record<RfiDiscipline, string> = {
  civil: 'CIV',
  structural: 'STR',
  architectural: 'ARC',
  interior_design: 'ID',
  mechanical: 'MEC',
  electrical: 'ELE',
  plumbing: 'PLM',
  hvac: 'HVAC',
  other: 'OTH',
};

export interface Rfi {
  id: string;
  companyId: string;
  projectId: string;
  rfiNumber?: string;
  subject: string;
  question: string;
  answer?: string;
  status: RfiStatus;
  priority: RfiPriority;
  discipline?: RfiDiscipline;
  disciplineOther?: string;
  costImpact: boolean;
  timeImpact: boolean;
  assignedTo?: string;
  dueDate?: string;
  answeredAt?: string;
  answeredBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  createdByName?: string;
  assignedToName?: string;
}
