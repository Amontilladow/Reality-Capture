import type { DocType } from '@engineeringos/types';

export const DOC_TYPES: DocType[] = [
  'drawing', 'specification', 'rfi', 'submittal', 'transmittal',
  'inspection_record', 'method_statement', 'risk_assessment',
  'handover_certificate', 'test_report', 'ncrm', 'other',
];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  drawing: 'Drawing',
  specification: 'Specification',
  rfi: 'RFI',
  submittal: 'Submittal',
  transmittal: 'Transmittal',
  inspection_record: 'Inspection record',
  method_statement: 'Method statement',
  risk_assessment: 'Risk assessment',
  handover_certificate: 'Handover certificate',
  test_report: 'Test report',
  ncrm: 'NCR',
  other: 'Other',
};

export const DOC_SOURCE_LABELS: Record<string, string> = {
  internal: 'Uploaded',
  procore: 'Procore',
  aconex: 'Aconex',
  sharepoint: 'SharePoint',
  bim360: 'BIM 360',
  manual_link: 'External link',
};
