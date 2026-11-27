import { summarizeDrawingActivity, type DrawingVersionRow } from './drawing-activity';

// A Friday afternoon (UTC).
const NOW = new Date('2026-11-27T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

let seq = 0;
function row(number: string | null, revision: string | null, createdAt: string, levelName: string | null = 'Ground', title = 'T'): DrawingVersionRow {
  return { id: `id-${++seq}`, drawingNumber: number, title, revision, createdAt, levelName };
}

describe('summarizeDrawingActivity', () => {
  // A-101: A (10d) -> B (2d); A-102: A (today); A-103: A (20d) -> B (19d) -> C (1d)
  const rows = [
    row('A-101', 'A', daysAgo(10)), row('A-101', 'B', daysAgo(2)),
    row('A-102', 'A', '2026-11-27T09:00:00Z'),
    row('A-103', 'A', daysAgo(20)), row('A-103', 'B', daysAgo(19)), row('A-103', 'C', daysAgo(1)),
  ];

  it('counts distinct drawings, revisions and new drawings per window', () => {
    const s = summarizeDrawingActivity(rows, NOW);
    expect(s.totalDrawings).toBe(3);
    expect(s.windows.allTime).toEqual({ drawingsRevised: 2, revisionUploads: 3, newDrawings: 3 });
    expect(s.windows.last30Days).toEqual({ drawingsRevised: 2, revisionUploads: 3, newDrawings: 3 });
    expect(s.windows.last7Days).toEqual({ drawingsRevised: 2, revisionUploads: 2, newDrawings: 1 });
    expect(s.windows.today).toEqual({ drawingsRevised: 0, revisionUploads: 0, newDrawings: 1 });
  });

  it('counts a drawing once as "revised" however many times it was revised', () => {
    const s = summarizeDrawingActivity(rows, NOW);
    // A-103 has two revision uploads (B, C) but is one revised drawing.
    expect(s.windows.allTime.revisionUploads).toBe(3);
    expect(s.windows.allTime.drawingsRevised).toBe(2);
  });

  it('does not count a drawing first uploaded long ago as new, even if revised recently', () => {
    const s = summarizeDrawingActivity(rows, NOW);
    expect(s.windows.last7Days.newDrawings).toBe(1); // only A-102; A-101/A-103 originals are older
  });

  it('lists the most recent revisions first with from/to revision', () => {
    const s = summarizeDrawingActivity(rows, NOW);
    expect(s.recentRevisions.map((r) => [r.drawingNumber, r.fromRevision, r.toRevision, r.revisedOn])).toEqual([
      ['A-103', 'B', 'C', '2026-11-26'],
      ['A-101', 'A', 'B', '2026-11-25'],
      ['A-103', 'A', 'B', '2026-11-08'],
    ]);
  });

  it('matches drawing numbers case-insensitively and ignores surrounding whitespace', () => {
    const s = summarizeDrawingActivity([row('a-101', 'A', daysAgo(5)), row(' A-101 ', 'B', daysAgo(1))], NOW);
    expect(s.totalDrawings).toBe(1);
    expect(s.windows.allTime.revisionUploads).toBe(1);
  });

  it('keeps unnumbered drawings separate rather than merging them into one', () => {
    const s = summarizeDrawingActivity([row(null, null, daysAgo(3)), row('', null, daysAgo(2)), row(null, null, daysAgo(1))], NOW);
    expect(s.totalDrawings).toBe(3);
    expect(s.windows.allTime).toEqual({ drawingsRevised: 0, revisionUploads: 0, newDrawings: 3 });
  });

  it('breaks counts down per level, attributing a drawing to its latest version\'s level', () => {
    const s = summarizeDrawingActivity([
      row('A-1', 'A', daysAgo(40), 'Ground'), row('A-1', 'B', daysAgo(2), 'Level 1'),   // moved level: counts under Level 1
      row('B-1', 'A', daysAgo(3), 'Ground'),
      row('C-1', 'A', daysAgo(50), null), row('C-1', 'B', daysAgo(40), null),
    ], NOW);
    const by = Object.fromEntries(s.byLevel.map((l) => [l.levelName, l]));
    expect(by['Level 1']).toMatchObject({ drawings: 1, drawingsRevisedLast7Days: 1, drawingsRevisedAllTime: 1 });
    expect(by['Ground']).toMatchObject({ drawings: 1, drawingsRevisedAllTime: 0 });
    expect(by['Unassigned']).toMatchObject({ drawings: 1, drawingsRevisedLast30Days: 0, drawingsRevisedAllTime: 1 });
  });

  it('handles Date objects and unsorted input', () => {
    const s = summarizeDrawingActivity([
      { ...row('A-1', 'B', ''), createdAt: new Date(daysAgo(1)) },
      { ...row('A-1', 'A', ''), createdAt: new Date(daysAgo(9)) },
    ], NOW);
    expect(s.windows.allTime).toEqual({ drawingsRevised: 1, revisionUploads: 1, newDrawings: 1 });
    expect(s.recentRevisions[0]).toMatchObject({ fromRevision: 'A', toRevision: 'B' });
  });

  it('returns all zeros and a note for an empty project', () => {
    const s = summarizeDrawingActivity([], NOW);
    expect(s.totalDrawings).toBe(0);
    expect(s.windows.allTime).toEqual({ drawingsRevised: 0, revisionUploads: 0, newDrawings: 0 });
    expect(s.byLevel).toEqual([]);
    expect(s.recentRevisions).toEqual([]);
    expect(s.note).toMatch(/not tracked/);
  });

  it('caps the recent-revisions list so the model context stays small', () => {
    const many: DrawingVersionRow[] = [];
    for (let i = 0; i < 40; i++) { many.push(row(`X-${i}`, 'A', daysAgo(50))); many.push(row(`X-${i}`, 'B', daysAgo(1))); }
    expect(summarizeDrawingActivity(many, NOW).recentRevisions).toHaveLength(15);
  });
});
