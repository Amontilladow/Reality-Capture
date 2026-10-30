// Risk titles from the engine read "Unresolved RFI: MGT-B-GEN-RFI-STR-0001 —
// Transfer beam TB-07 reinforcement congestion": a state, the source record's
// type and code, then what it's about. In a list that buries the subject
// behind 40 characters of bookkeeping, so lists show the subject as the
// title and the source ("RFI · MGT-B-GEN-RFI-STR-0001") as context.
const PATTERN = /^(?:unresolved|open|overdue)\s+([a-z][a-z /]*?):\s*(\S+)\s+[—–-]+\s+(.+)$/i;

export interface RiskTitleParts {
  subject: string;
  /** e.g. "RFI · MGT-B-GEN-RFI-STR-0001"; absent for free-text titles. */
  source?: string;
}

export function splitRiskTitle(title: string): RiskTitleParts {
  const m = PATTERN.exec(title.trim());
  if (!m) return { subject: title };
  const [, kind, code, subject] = m;
  return { subject: subject.trim(), source: `${kind.trim()} · ${code}` };
}
