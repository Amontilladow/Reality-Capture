// Deliberately a simple, practical syntax check -- not an attempt at full
// RFC 5322 compliance. The real validation authority for every address
// rendered by this app is the backend (class-validator's @IsEmail() at
// write time, when the user/member row was created); this check exists
// only to decide whether it's safe to build a mailto: link out of a value,
// not to be the platform's source of truth for "is this address real."
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

// mailto: URIs (RFC 6068): the "to" address sits directly in the path with
// no percent-encoding needed for the characters a validated address can
// contain (letters, digits, '.', '_', '%', '+', '-', '@'); only the query
// parameters (subject/body) need encodeURIComponent, since those carry
// free text that can contain spaces, '&', '#', etc. Returns null for an
// invalid address rather than building a link that could misbehave or
// (depending on how a caller used the result) reflect attacker-controlled
// text into the DOM.
export function buildMailtoHref(to: string, options?: { subject?: string; body?: string }): string | null {
  if (!isValidEmail(to)) return null;

  const params = new URLSearchParams();
  if (options?.subject) params.set('subject', options.subject);
  if (options?.body) params.set('body', options.body);
  const query = params.toString();

  return `mailto:${to}${query ? `?${query}` : ''}`;
}
