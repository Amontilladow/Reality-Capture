// Pure summarisation behind the assistant's getDrawingChanges tool, kept free
// of any service/DB dependency so the counting rules are unit-testable.
//
// What "changed" means here: every upload of a drawing is its own row in
// `drawings` (drawing_number + revision + created_at). The first row for a
// drawing number is the original upload; any later row with the same number
// is a revision. Edits made inside a drawing file are not recorded anywhere,
// so they cannot be counted; the summary says so, so the model can too.

export interface DrawingVersionRow {
  id: string;
  drawingNumber: string | null;
  title: string | null;
  revision: string | null;
  createdAt: Date | string;
  levelName: string | null;
}

export interface DrawingWindowStats {
  /** Distinct drawings that received at least one revision in the window. */
  drawingsRevised: number;
  /** Revision uploads in the window (one drawing can have several). */
  revisionUploads: number;
  /** Drawings first uploaded in the window. */
  newDrawings: number;
}

export interface DrawingActivitySummary {
  asOf: string;
  totalDrawings: number;
  windows: {
    today: DrawingWindowStats;
    last7Days: DrawingWindowStats;
    last30Days: DrawingWindowStats;
    allTime: DrawingWindowStats;
  };
  byLevel: {
    levelName: string;
    drawings: number;
    drawingsRevisedLast7Days: number;
    drawingsRevisedLast30Days: number;
    drawingsRevisedAllTime: number;
  }[];
  recentRevisions: {
    drawingNumber: string | null;
    title: string | null;
    levelName: string | null;
    fromRevision: string | null;
    toRevision: string | null;
    revisedOn: string;
  }[];
  note: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT = 15;
const MAX_LEVELS = 20;
export const DRAWING_ACTIVITY_NOTE =
  'Counted from uploaded drawing revisions (a later upload of the same drawing number is a revision). Edits made inside a drawing file are not tracked. Windows are measured back from asOf (UTC); "today" starts at 00:00 UTC.';

interface Version { row: DrawingVersionRow; at: number }

export function summarizeDrawingActivity(rows: DrawingVersionRow[], now: Date = new Date()): DrawingActivitySummary {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const starts = {
    today: todayStart,
    last7Days: now.getTime() - 7 * DAY_MS,
    last30Days: now.getTime() - 30 * DAY_MS,
    allTime: Number.NEGATIVE_INFINITY,
  } as const;
  type WindowName = keyof typeof starts;
  const windowNames = Object.keys(starts) as WindowName[];

  // Group the versions of each drawing; an unnumbered drawing stays on its own.
  const groups = new Map<string, Version[]>();
  for (const row of rows) {
    const number = (row.drawingNumber ?? '').trim().toLowerCase();
    const key = number || `id:${row.id}`;
    const list = groups.get(key) ?? [];
    list.push({ row, at: new Date(row.createdAt).getTime() });
    groups.set(key, list);
  }

  const windows = Object.fromEntries(
    windowNames.map((w) => [w, { drawingsRevised: 0, revisionUploads: 0, newDrawings: 0 }]),
  ) as Record<WindowName, DrawingWindowStats>;

  const levels = new Map<string, { drawings: number; revised: Record<'last7Days' | 'last30Days' | 'allTime', number> }>();
  const revisionEvents: { version: Version; previous: Version }[] = [];

  for (const versions of groups.values()) {
    versions.sort((a, b) => a.at - b.at);
    const revisedIn = new Set<WindowName>();

    versions.forEach((v, i) => {
      for (const w of windowNames) {
        if (v.at < starts[w]) continue;
        if (i === 0) windows[w].newDrawings += 1;
        else { windows[w].revisionUploads += 1; revisedIn.add(w); }
      }
      if (i > 0) revisionEvents.push({ version: v, previous: versions[i - 1] });
    });
    for (const w of revisedIn) windows[w].drawingsRevised += 1;

    // A drawing belongs to the level of its latest version.
    const levelName = versions[versions.length - 1].row.levelName ?? 'Unassigned';
    const entry = levels.get(levelName) ?? { drawings: 0, revised: { last7Days: 0, last30Days: 0, allTime: 0 } };
    entry.drawings += 1;
    if (revisedIn.has('last7Days')) entry.revised.last7Days += 1;
    if (revisedIn.has('last30Days')) entry.revised.last30Days += 1;
    if (revisedIn.has('allTime')) entry.revised.allTime += 1;
    levels.set(levelName, entry);
  }

  const byLevel = [...levels.entries()]
    .map(([levelName, e]) => ({
      levelName,
      drawings: e.drawings,
      drawingsRevisedLast7Days: e.revised.last7Days,
      drawingsRevisedLast30Days: e.revised.last30Days,
      drawingsRevisedAllTime: e.revised.allTime,
    }))
    .sort((a, b) => b.drawings - a.drawings || a.levelName.localeCompare(b.levelName))
    .slice(0, MAX_LEVELS);

  const recentRevisions = revisionEvents
    .sort((a, b) => b.version.at - a.version.at)
    .slice(0, MAX_RECENT)
    .map(({ version, previous }) => ({
      drawingNumber: version.row.drawingNumber,
      title: version.row.title,
      levelName: version.row.levelName,
      fromRevision: previous.row.revision,
      toRevision: version.row.revision,
      revisedOn: new Date(version.at).toISOString().slice(0, 10),
    }));

  return {
    asOf: now.toISOString(),
    totalDrawings: groups.size,
    windows,
    byLevel,
    recentRevisions,
    note: DRAWING_ACTIVITY_NOTE,
  };
}
