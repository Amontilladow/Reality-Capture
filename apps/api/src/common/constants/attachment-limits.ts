// Shared presigned-PUT attachment constraints -- originally defined in
// issues.service.ts (ticket 2b), pulled out here so RFI attachments use the
// exact same allow-list/size cap instead of a second, driftable copy.
export const ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
export const ATTACHMENT_ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'xls', 'xlsx', 'doc', 'docx', 'zip',
]);
