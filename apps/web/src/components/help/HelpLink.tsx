// Phase 4G: a reusable contextual help link. Always deep-links to one
// specific article (never the Help Centre homepage), and always opens
// in a new tab -- most of this component's callers sit inside a form or
// a mid-task page, so navigating away in the same tab would discard
// whatever the user was in the middle of entering.
export function HelpLink({ slug, label = 'Help' }: { slug: string; label?: string }) {
  return (
    <a
      href={`/projects/help?article=${encodeURIComponent(slug)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-signal transition-colors"
      title="Open this topic in the Help Centre (opens in a new tab)"
    >
      <IconHelpCircle className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}

function IconHelpCircle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="16.8" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
