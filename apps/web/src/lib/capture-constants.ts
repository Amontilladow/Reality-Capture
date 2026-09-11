import type { CaptureStatus } from '@engineeringos/types';

// Mirrors the SNAG_STATUS_LABELS / STATUS_LABELS (issue-constants.ts) pattern:
// a plain label map keyed by the raw enum value, used instead of printing the
// raw lowercase status string in the UI.
export const CAPTURE_STATUS_LABELS: Record<CaptureStatus, string> = {
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};
