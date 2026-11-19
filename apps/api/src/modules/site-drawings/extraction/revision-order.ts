// Whether an incoming revision label is confidently newer than the
// drawing's current one -- the gate SiteDrawingImportProcessor.reconcile()
// needs before it's safe to automatically make an imported file "current"
// (Site Drawing Hub integrity hardening, Phase 2: "a new revision must not
// automatically supersede an existing revision merely because it was
// processed later"). ZIP entry order is an artifact of how the archive was
// built, never a reliable stand-in for real-world revision chronology.
//
// Deliberately NOT a universal revision-ranking algorithm: construction
// revision labels aren't one convention (numeric "1", "2"; lettered "A",
// "B"; project-specific "P1", "REV-03"). This only ever answers confidently
// for the handful of shapes that are genuinely unambiguous, and returns
// 'ambiguous' for everything else -- including comparing two different
// label shapes, which is a sign extraction may not even be reading
// the same kind of value both times. An 'ambiguous' result, not a guess,
// is what keeps an uncertain case out of the current_revision_id slot.

export type RevisionOrder = 'incoming_newer' | 'incoming_older' | 'equal' | 'ambiguous';

function parsePureNumber(label: string): number | null {
  return /^\d+$/.test(label) ? Number(label) : null;
}

// A single letter or doubled-letter revision label (A, B, ..., Z, AA, AB,
// ...), the other common construction convention. Ordered by (length, then
// lexicographically), which correctly places every "AA"+ label after "Z" --
// the same order the convention itself uses once single letters run out.
function parseLetterLabel(label: string): string | null {
  return /^[A-Z]{1,2}$/.test(label) ? label : null;
}

// "P1"/"P2", "REV-03"/"REV-04": the same non-numeric prefix with a trailing
// number that actually varies. Matched literally (case-insensitive on the
// prefix, exact), not fuzzed -- two labels whose prefixes differ even
// slightly ("P1" vs "PH1") are a sign they may not be describing the same
// revision sequence at all, which is exactly when this should NOT guess.
function parsePrefixedNumber(label: string): { prefix: string; n: number } | null {
  const match = /^([A-Z-]*?)(\d+)$/i.exec(label);
  if (!match) return null;
  return { prefix: match[1].toUpperCase(), n: Number(match[2]) };
}

export function compareRevisionOrder(currentLabel: string, incomingLabel: string): RevisionOrder {
  const current = currentLabel.trim().toUpperCase();
  const incoming = incomingLabel.trim().toUpperCase();
  if (current === incoming) return 'equal';

  const currentNum = parsePureNumber(current);
  const incomingNum = parsePureNumber(incoming);
  if (currentNum !== null && incomingNum !== null) {
    return incomingNum > currentNum ? 'incoming_newer' : incomingNum < currentNum ? 'incoming_older' : 'equal';
  }

  const currentLetter = parseLetterLabel(current);
  const incomingLetter = parseLetterLabel(incoming);
  if (currentLetter !== null && incomingLetter !== null) {
    if (incomingLetter.length !== currentLetter.length) return incomingLetter.length > currentLetter.length ? 'incoming_newer' : 'incoming_older';
    return incomingLetter > currentLetter ? 'incoming_newer' : incomingLetter < currentLetter ? 'incoming_older' : 'equal';
  }

  const currentPrefixed = parsePrefixedNumber(current);
  const incomingPrefixed = parsePrefixedNumber(incoming);
  if (currentPrefixed !== null && incomingPrefixed !== null && currentPrefixed.prefix === incomingPrefixed.prefix) {
    return incomingPrefixed.n > currentPrefixed.n ? 'incoming_newer' : incomingPrefixed.n < currentPrefixed.n ? 'incoming_older' : 'equal';
  }

  // Different shapes (a number vs. a letter, or mismatched prefixes): no
  // confident reading, never a guess.
  return 'ambiguous';
}
