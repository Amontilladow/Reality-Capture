import { buildReportsBriefingContext, parseStructuredBriefing } from './reports.service';

function kpis(overrides: Partial<{ issues: number; issuesCritical: number; issuesOverdue: number }> = {}) {
  return {
    issues: { summary: { total: overrides.issues ?? 0, critical: overrides.issuesCritical ?? 0, overdue: overrides.issuesOverdue ?? 0 } },
    snagging: { summary: { total: 0, overdue: 0 } },
    rfis: { summary: { total: 0, overdue: 0 } },
    qaqc: { summary: { total: 0, critical: 0, overdue: 0 } },
  } as unknown as Parameters<typeof buildReportsBriefingContext>[0];
}

describe('buildReportsBriefingContext', () => {
  it('names the real figures from each domain, never a fabricated one', () => {
    const context = buildReportsBriefingContext(kpis({ issues: 10, issuesCritical: 2, issuesOverdue: 3 }), null);
    expect(context).toContain('10 total, 2 critical, 3 overdue');
  });

  it('is explicit that risk data is unavailable rather than silently omitting it', () => {
    const context = buildReportsBriefingContext(kpis(), null);
    expect(context).toMatch(/no risk data currently available/i);
  });

  it('includes real risk figures when a risk summary is given', () => {
    const risk = { overallScore: 42, overallLevel: 'MODERATE', totalOpenRisks: 5, criticalCount: 1, overdueCount: 2 } as unknown as Parameters<typeof buildReportsBriefingContext>[1];
    const context = buildReportsBriefingContext(kpis(), risk);
    expect(context).toContain('42/100 (MODERATE)');
    expect(context).toContain('5 open risks');
  });
});

describe('parseStructuredBriefing', () => {
  it('parses a well-formed five-section response', () => {
    const raw = [
      'CONCLUSION: Delivery is largely on track.',
      'DRIVERS: 2 critical issues | 1 overdue RFI',
      'IMPACT: Design information could be delayed.',
      'ACTION: Close out the critical issues this week.',
      'EVIDENCE: 2 critical issues | 1 overdue RFI',
    ].join('\n');
    expect(parseStructuredBriefing(raw)).toEqual({
      conclusion: 'Delivery is largely on track.',
      drivers: ['2 critical issues', '1 overdue RFI'],
      impact: 'Design information could be delayed.',
      action: 'Close out the critical issues this week.',
      evidence: ['2 critical issues', '1 overdue RFI'],
    });
  });

  it('leaves a missing label empty rather than guessing at it', () => {
    const raw = 'CONCLUSION: All clear.\nACTION: No action needed.';
    const result = parseStructuredBriefing(raw);
    expect(result.conclusion).toBe('All clear.');
    expect(result.drivers).toEqual([]);
    expect(result.impact).toBe('');
    expect(result.action).toBe('No action needed.');
  });

  it('returns an empty conclusion for text that does not follow the requested format at all, so the caller can degrade to unavailable', () => {
    const result = parseStructuredBriefing('Sorry, I cannot help with that.');
    expect(result.conclusion).toBe('');
  });

  it('is tolerant of a single-item DRIVERS/EVIDENCE line with no separator', () => {
    const raw = 'CONCLUSION: Stable.\nDRIVERS: Nothing of note.\nIMPACT: None.\nACTION: None.\nEVIDENCE: No open items.';
    const result = parseStructuredBriefing(raw);
    expect(result.drivers).toEqual(['Nothing of note.']);
    expect(result.evidence).toEqual(['No open items.']);
  });
});
