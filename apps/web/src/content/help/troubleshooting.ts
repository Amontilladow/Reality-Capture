import type { HelpArticle } from './types';

// Section K from the brief, one entry per symptom. Each is a short,
// standalone article (title = symptom, troubleshootingSteps = what to
// check) rather than the full 16-field structure -- these are meant to be
// found by symptom, not read end to end.
export const troubleshootingArticles: HelpArticle[] = [
  {
    slug: 'trouble-unable-to-log-in',
    category: 'troubleshooting',
    title: 'Unable to Log In',
    summary: 'Your email or password is rejected, or you can\'t reach the app at all.',
    troubleshootingSteps: [
      { problem: 'Email/password rejected', likelyCause: 'Wrong credentials, or your account was deactivated.', fix: 'Re-check your email and password (case-sensitive). If still blocked, ask your company admin to confirm your account is active.' },
      { problem: 'You land on a "Pending Approval" screen', likelyCause: 'Your self-signup account hasn\'t been approved yet.', fix: 'Contact your company admin to approve your requested role.' },
      { problem: 'Forgot your password', likelyCause: '—', fix: 'Use "Forgot password?" on the login page, or ask your company admin for an admin-generated reset link.' },
    ],
    relatedSlugs: ['logging-in', 'resetting-your-password'],
    keywords: ['login', 'cannot log in', 'sign in failed'],
  },
  {
    slug: 'trouble-project-not-visible',
    category: 'troubleshooting',
    title: 'Project Not Visible',
    summary: 'A project you expect to access doesn\'t appear in your project list.',
    troubleshootingSteps: [
      { problem: 'Project missing from the list', likelyCause: 'Every non-archived company project appears to every company user -- this isn\'t a membership issue. The project has most likely been archived.', fix: 'Ask your company admin to confirm the project\'s status, or check with whoever administers your company account.' },
    ],
    relatedSlugs: ['selecting-a-project', 'understanding-project-access'],
    keywords: ['project missing', 'project not visible'],
  },
  {
    slug: 'trouble-access-denied',
    category: 'troubleshooting',
    title: 'Access Denied',
    summary: 'You get a permission error trying to create, edit, or view something.',
    troubleshootingSteps: [
      { problem: 'A create action is blocked', likelyCause: 'Creating an Issue, RFI, Snag, Submittal, Transmittal, or QA Inspection is open to any project member -- if this is blocked, it\'s more likely a different field validation error. Uploading a Document, Capture, Floor Plan, or BIM Model does require "manage_project_records" (or Project Lead), though.', fix: 'Check for a validation message first; if creating a Document/Capture/Floor Plan/BIM Model specifically, ask for "manage_project_records".' },
      { problem: 'An edit, delete, or team-management action is blocked', likelyCause: 'Editing or deleting almost any existing record requires "manage_project_records" (or Project Lead); adding/changing a project member requires "manage_team".', fix: 'Ask your project\'s Project Lead or company admin to check your role and permission grants.' },
      { problem: 'A review/approval or verification action is blocked', likelyCause: 'RFI review decisions need "manage_rfis" or "approve_rfis"; snag verification needs "manage_project_records" or "verify_snag_items".', fix: 'Ask for the specific narrower permission if you only need that one capability.' },
    ],
    relatedSlugs: ['understanding-your-role', 'understanding-user-permissions'],
    keywords: ['access denied', 'permission denied', '403'],
  },
  {
    slug: 'trouble-missing-records',
    category: 'troubleshooting',
    title: 'Missing Records',
    summary: 'An RFI, issue, snag, submittal, transmittal, or inspection you expect to see isn\'t in the list.',
    troubleshootingSteps: [
      { problem: 'A record doesn\'t appear', likelyCause: 'A status or priority filter on the list page is hiding it, or it was created on a different project.', fix: 'Clear any active filters on the list page. Confirm you\'re on the correct project.' },
    ],
    keywords: ['missing records', 'record not found'],
  },
  {
    slug: 'trouble-floor-plan-not-loading',
    category: 'troubleshooting',
    title: 'Floor Plan Not Loading',
    summary: 'A floor plan PDF won\'t open or display.',
    troubleshootingSteps: [
      { problem: 'Floor plan stays blank or shows an error', likelyCause: 'The underlying file failed to upload or process, or a slow/unstable network connection.', fix: 'Try reloading the page. If it still fails, check with whoever uploaded the floor plan that the file was a valid PDF, or try re-uploading it.' },
    ],
    keywords: ['floor plan not loading', 'drawing not loading'],
  },
  {
    slug: 'trouble-upload-failed',
    category: 'troubleshooting',
    title: 'Upload Failed',
    summary: 'A photo, document, or attachment fails to upload.',
    troubleshootingSteps: [
      { problem: 'Upload fails or hangs', likelyCause: 'The file exceeds the size limit, is an unsupported type, or the connection dropped mid-upload.', fix: 'Confirm the file type and size are within what the upload form accepts, then retry. On an unstable connection, try again on a more stable one.' },
    ],
    keywords: ['upload failed', 'upload error'],
  },
  {
    slug: 'trouble-attachment-not-opening',
    category: 'troubleshooting',
    title: 'Attachment Not Opening',
    summary: 'A previously uploaded attachment won\'t open or download.',
    troubleshootingSteps: [
      { problem: 'Clicking the attachment does nothing or errors', likelyCause: 'The download link has expired (links are time-limited for security) or the file was removed.', fix: 'Reload the page to get a fresh link, then try again.' },
    ],
    keywords: ['attachment not opening', 'download failed'],
  },
  {
    slug: 'trouble-changes-not-saving',
    category: 'troubleshooting',
    title: 'Changes Not Saving',
    summary: 'An edit you made doesn\'t stick after saving.',
    troubleshootingSteps: [
      { problem: 'Save appears to succeed but the change reverts', likelyCause: 'A validation error was silently missed, or a permission check rejected the specific field you changed.', fix: 'Look for an error message near the field you edited. If none is visible, reload the page and check whether the change actually applied before retrying.' },
    ],
    keywords: ['not saving', 'changes lost'],
  },
  {
    slug: 'trouble-notification-not-received',
    category: 'troubleshooting',
    title: 'Notification Not Received',
    summary: 'You expected a notification (e.g. for an assignment or comment) and didn\'t get one.',
    troubleshootingSteps: [
      { problem: 'No notification appears for an action you expected to trigger one', likelyCause: 'Not every action generates a notification — only specific events (assignment, reassignment, new comment on a record assigned to you, forwarding) do.', fix: 'Check the record directly for the update. If you believe a genuine assignment or comment notification is missing, report it to your company admin.' },
    ],
    relatedSlugs: ['understanding-notifications'],
    keywords: ['notification not received', 'missing notification'],
  },
  {
    slug: 'trouble-email-connection-failed',
    category: 'troubleshooting',
    title: 'Email Connection Failed',
    summary: 'Connecting your Outlook or Gmail account fails or shows an error.',
    troubleshootingSteps: [
      { problem: 'Connection fails or shows "failed" after the provider consent screen', likelyCause: 'You declined a permission the connection needs, or a transient error during the provider handshake.', fix: 'Try connecting again from Email Integration settings and accept every permission requested. If it keeps failing, contact your company admin.' },
    ],
    relatedSlugs: ['connecting-outlook', 'connecting-gmail', 'troubleshooting-email-authorization'],
    keywords: ['email connection failed', 'outlook error', 'gmail error'],
  },
  {
    slug: 'trouble-ai-assistant-not-responding',
    category: 'troubleshooting',
    title: 'AI Assistant Not Responding',
    summary: 'The AI Assistant doesn\'t answer, or shows a blocked/limit message.',
    troubleshootingSteps: [
      { problem: 'A warning banner appears instead of an answer', likelyCause: 'Your question was blocked as off-topic (the assistant only answers questions about this project\'s own data), or you\'ve reached your daily request limit, shown at the top of the Assistant page.', fix: 'Rephrase the question to be about this specific project\'s RFIs, issues, snagging, risk, progress, or documents. If you\'ve hit the daily limit, try again the next day.' },
    ],
    relatedSlugs: ['understanding-ai-limitations'],
    keywords: ['ai not responding', 'ai assistant error', 'assistant blocked'],
  },
  {
    slug: 'trouble-cant-close-issue',
    category: 'troubleshooting',
    title: 'Can\'t Close an Issue',
    summary: 'The "Close" action on an issue is unavailable or rejected.',
    troubleshootingSteps: [
      { problem: 'Close is rejected with an evidence error', likelyCause: 'No photo or capture has been attached to the issue yet.', fix: 'Attach at least one photo or capture, then try closing again.' },
      { problem: 'The close option isn\'t available at all', likelyCause: 'Closing requires a sufficiently senior company role (Engineering Manager or above) or the "manage_issues" project permission -- being the project\'s own Project Lead isn\'t enough on its own.', fix: 'Ask your company admin or project lead for the "manage_issues" permission, or have someone with the right role close it.' },
    ],
    relatedSlugs: ['reviewing-and-closing-an-issue'],
    keywords: ['cannot close issue', 'close issue blocked'],
  },
  {
    slug: 'trouble-rfi-wont-submit',
    category: 'troubleshooting',
    title: 'RFI Won\'t Submit',
    summary: 'A drafted RFI can\'t be moved to submitted status.',
    troubleshootingSteps: [
      { problem: 'Submit is rejected', likelyCause: 'Submitting is only available to the RFI\'s own creator, someone with "manage_rfis", the project\'s Project Lead, or a super_admin.', fix: 'Ask the RFI\'s creator to submit it, or ask for the "manage_rfis" permission if you need to submit RFIs regularly.' },
    ],
    relatedSlugs: ['submitting-an-rfi'],
    keywords: ['rfi wont submit', 'rfi stuck in draft'],
  },
  {
    slug: 'trouble-unexpected-error',
    category: 'troubleshooting',
    title: 'Unexpected Error',
    summary: 'You see a generic error message not covered by the other troubleshooting articles.',
    troubleshootingSteps: [
      { problem: 'A generic error banner or page appears', likelyCause: 'A temporary network or server issue.', fix: 'Reload the page and try again. If the error persists, note what you were doing when it happened and report it to your company admin.' },
    ],
    keywords: ['error', 'unexpected error', 'something went wrong'],
  },
];
