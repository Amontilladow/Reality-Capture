// Pure URL -> trackable-domain resolution, kept separate from
// background.js so it's unit-testable without chrome.* APIs.
//
// Deliberately returns null (meaning "don't track this") for anything
// that isn't a normal http(s) page: chrome://, about:, file://, and the
// extension's own pages are never reported as a "domain" -- there's
// nothing meaningful to classify there, and for chrome://settings or a
// file:// path in particular, treating the raw URL as a trackable label
// would leak local file paths/browser-internal URLs into the company's
// shared application registry (a company-wide admin screen, see
// apps/api's ApplicationsController) -- not something one person's local
// browsing details belong in.
export function resolveTrackableDomain(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname || null;
}
