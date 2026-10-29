import type { ReactNode } from 'react';
import { buildMailtoHref } from '../../lib/email';

// Requirement A: clicking another person's email opens a new composition
// window addressed to *that* address via a plain mailto: link -- the
// system's own default handler decides what "opens" means (a native app,
// a browser-registered web handler, or its own "no app associated"
// dialog), never something this component or RC's backend controls or can
// detect. No Graph/Gmail API, no OAuth, nothing sent anywhere -- this is a
// static <a href="mailto:...">, exactly as capable (and exactly as
// limited) as typing the address into an OS "open with" dialog by hand.
//
// `email` must be the target PERSON's own address -- never the signed-in
// user's. Callers pass whichever address the surrounding record actually
// carries (a member row's `member.email`, a contact's `contact.email`,
// etc.); this component has no opinion on whose address that is and
// deliberately doesn't read from the auth store, so there's no risk of it
// silently substituting the wrong one.
//
// An invalid address renders as plain, non-interactive text instead of a
// link -- never a mailto: built from unvalidated input, and never a
// clickable element that would do nothing (or something unexpected) when
// clicked.
export function EmailLink({
  email, children, className = '', subject, body,
}: {
  email: string;
  children?: ReactNode;
  className?: string;
  subject?: string;
  body?: string;
}) {
  const href = buildMailtoHref(email, { subject, body });

  if (!href) {
    return <span className={className}>{children ?? email}</span>;
  }

  return (
    <a
      href={href}
      className={`text-blueprint hover:text-blueprint-hover hover:underline ${className}`}
      // Defensive, not required by any current call site: a mailto: click
      // inside a row that itself has (or later gains) a click handler
      // must not also trigger that row's own action.
      onClick={(e) => e.stopPropagation()}
    >
      {children ?? email}
    </a>
  );
}
