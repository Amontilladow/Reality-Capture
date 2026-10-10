import type { HelpArticle } from './types';

// Verified against FloorPlanViewer.tsx, PinPanel.tsx,
// drawings.controller.ts, and buildings.controller.ts directly. The key
// fact that shapes this whole category: a "pinpoint" is not a separate
// record type -- dropping a pin on a floor plan auto-creates an Issue at
// that location (locations.pos_x_norm/pos_y_norm), and the pin's detail
// panel is really that Issue's (or, after conversion, Snag's) own quick
// editor. There is no standalone "create a pinpoint" action independent
// of creating an issue.
//
// Permission note, verified directly against the controllers rather than
// assumed from the pattern elsewhere: *creating* a pin
// (`POST drawings/:id/pins`) requires "manage_project_records" -- but
// renaming/moving it, archiving (deleting) it, and converting it to a
// Snag (`PATCH/DELETE/POST locations/:id...` on buildings.controller.ts)
// have no such gate at all and are open to any project member. This is a
// genuine asymmetry in the real permission model, not a mistake in this
// doc -- described as-is, not "corrected" by this Help Centre phase.
export const floorPlansArticles: HelpArticle[] = [
  {
    slug: 'opening-a-floor-plan',
    category: 'floor-plans-pinpoints',
    title: 'Opening a Floor Plan',
    summary: 'How to open a project\'s floor plans.',
    whatItDoes: 'Shows the list of uploaded floor plan PDFs for a project, grouped by building/level where assigned, and opens the one you select for viewing.',
    whoCanUse: 'Any project member.',
    steps: [
      'Open a project, then select "Floor Plans" in the sidebar.',
      'Select a drawing from the left-hand list to open it.',
    ],
    relatedSlugs: ['navigating-a-floor-plan', 'troubleshooting-floor-plan-display'],
    keywords: ['floor plan', 'drawing', 'open'],
  },
  {
    slug: 'navigating-a-floor-plan',
    category: 'floor-plans-pinpoints',
    title: 'Navigating a Floor Plan',
    summary: 'Moving between pages of a multi-page floor plan PDF.',
    whatItDoes: 'A floor plan can have multiple pages; the viewer shows "Prev"/"Next" controls when there\'s more than one.',
    whoCanUse: 'Any project member.',
    steps: ['Use the "← Prev" / "Next →" controls above the drawing to move between pages.'],
    relatedSlugs: ['zooming-and-panning'],
    keywords: ['floor plan navigation', 'pages'],
  },
  {
    slug: 'zooming-and-panning',
    category: 'floor-plans-pinpoints',
    title: 'Zooming and Panning',
    summary: 'Getting a closer look at part of a floor plan.',
    whatItDoes: 'The floor plan viewer supports standard zoom and pan/drag to inspect detail.',
    whoCanUse: 'Any project member.',
    keywords: ['zoom', 'pan'],
  },
  {
    slug: 'understanding-pinpoints',
    category: 'floor-plans-pinpoints',
    title: 'Understanding Pinpoints',
    summary: 'What a pin on a floor plan actually is.',
    whatItDoes: 'A pin marks a specific location on a floor plan. Dropping a pin automatically creates an Issue at that location — there is no separate "pinpoint" record. Opening a pin shows a quick-edit panel for that linked Issue (or Snag, if converted): rename, add a note, assign, attach photos or a 360° capture, link a BIM element, and convert it between an Issue and a Snag.',
    whenToUse: 'Whenever you need to mark exactly where on site something is, rather than just describing it in text.',
    whoCanUse: 'Placing a new pin requires the "manage_project_records" permission (or being that project\'s Project Lead). Once a pin exists, renaming it, moving it, deleting it, and converting it to a Snag are all open to any project member.',
    relatedSlugs: ['creating-a-pinpoint', 'linking-a-pinpoint-to-an-issue'],
    keywords: ['pinpoint', 'pin', 'marker'],
  },
  {
    slug: 'creating-a-pinpoint',
    category: 'floor-plans-pinpoints',
    title: 'Creating a Pinpoint',
    summary: 'How to drop a new pin on a floor plan.',
    whatItDoes: 'Drops a pin at a specific point on the open floor plan page, auto-creating an Issue there.',
    requiredPermissions: '"manage_project_records" permission, or being that project\'s Project Lead.',
    whoCanUse: 'Project members holding "manage_project_records" (or the Project Lead) -- not every project member.',
    prerequisites: ['A floor plan page must be open.'],
    steps: [
      'Open the floor plan and, optionally, set "New pins assign to" to pre-fill who the auto-created issue is assigned to.',
      'Select "+ Add pin."',
      'Click the exact spot on the drawing where the pin should go.',
    ],
    afterSubmission: 'A pin appears at that spot and a new Issue is created, assigned to whoever you selected (or unassigned). Select the pin to open its quick-edit panel and fill in a title, note, photos, and other detail.',
    commonMistakes: ['Forgetting to cancel "+ Add pin" mode before clicking elsewhere on the drawing — every click while it\'s active drops a new pin.'],
    relatedSlugs: ['understanding-pinpoints', 'attaching-photographs-to-a-pinpoint'],
    keywords: ['create pin', 'add pin', 'drop pin'],
  },
  {
    slug: 'attaching-photographs-to-a-pinpoint',
    category: 'floor-plans-pinpoints',
    title: 'Attaching Photographs',
    summary: 'Adding site photos to a pin.',
    whatItDoes: 'Lets you upload a photo or 360° capture directly against a pin\'s location from its quick-edit panel.',
    requiredPermissions: '"manage_project_records" permission, or being that project\'s Project Lead -- the same requirement as uploading any other capture.',
    whoCanUse: 'Project members holding "manage_project_records" (or the Project Lead).',
    steps: [
      'Select the pin on the floor plan to open its panel.',
      'Use the upload control there to add a photo or 360° capture.',
    ],
    relatedSlugs: ['understanding-pinpoints'],
    keywords: ['photo', 'photograph', 'upload', 'capture'],
  },
  {
    slug: 'linking-a-pinpoint-to-an-issue',
    category: 'floor-plans-pinpoints',
    title: 'Converting a Pinpoint Between Issue and Snag',
    summary: 'A pin\'s auto-created record can be converted from an Issue to a Snag (or back).',
    whatItDoes: 'Every pin starts with an auto-created Issue. If what you actually found needs the fixed/verified two-step Snagging workflow instead, you can convert the pin\'s record to a Snag from its panel.',
    whoCanUse: 'Any project member -- converting a pin has no narrower permission requirement.',
    steps: ['Open the pin\'s panel and use the convert-to-Snag control.'],
    commonMistakes: ['There is no separate "link an existing issue to a pin" action — a pin always comes with its own auto-created record from the start.'],
    relatedSlugs: ['understanding-pinpoints', 'understanding-the-difference-between-issues-and-snagging'],
    keywords: ['convert pin', 'pin to snag'],
  },
  {
    slug: 'viewing-pinpoint-details',
    category: 'floor-plans-pinpoints',
    title: 'Viewing Pinpoint Details',
    summary: 'Opening a pin to see or edit its linked record.',
    whatItDoes: 'Selecting a pin opens its quick-edit panel: title, note, assignee, linked BIM element (if any), and attached photos/captures.',
    whoCanUse: 'Any project member.',
    steps: ['Select the pin on the floor plan.'],
    relatedSlugs: ['understanding-pinpoints'],
    keywords: ['pin details', 'open pin'],
  },
  {
    slug: 'filtering-pinpoints',
    category: 'floor-plans-pinpoints',
    title: 'Filtering Pinpoints',
    summary: 'There is currently no dedicated filter for which pins show on a floor plan — all pins on the current page are shown.',
    whatItDoes: 'All pins placed on the currently open floor plan page are always visible together.',
    notYetAvailable: true,
    relatedSlugs: ['understanding-pinpoints'],
    keywords: ['filter pins'],
  },
  {
    slug: 'troubleshooting-floor-plan-display',
    category: 'floor-plans-pinpoints',
    title: 'Troubleshooting Floor Plan Display',
    summary: 'A floor plan won\'t open or display correctly.',
    troubleshootingSteps: [
      { problem: 'Floor plan stays blank or shows an error', likelyCause: 'The PDF failed to process on upload, or a network issue.', fix: 'Reload the page. If it still fails, confirm with whoever uploaded it that the file was a valid PDF, or re-upload it.' },
    ],
    relatedSlugs: ['opening-a-floor-plan'],
    keywords: ['floor plan not loading'],
  },
];
