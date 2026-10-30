import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import type { Crumb } from '../ui/Breadcrumbs';

export function PageHeader({
  breadcrumbs,
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  breadcrumbs?: Crumb[];
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  useDocumentTitle(title);

  return (
    <div className={`border-b border-base-600/60 bg-base-950/60 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-10 ${breadcrumbs || subtitle ? 'py-4' : 'min-h-16 py-4'}`}>
      {/* Title block: breadcrumbs or a quiet eyebrow above one strong title.
          No accent bar or chip -- the title's size and weight are the
          hierarchy, and the page's own content gets the color. */}
      <div className="min-w-0 shrink">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        {eyebrow && (
          <div className="text-xs font-medium text-ink-500 mb-0 truncate">{eyebrow}</div>
        )}
        <h1 className="text-2xl font-normal tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs text-ink-500 mt-0 truncate">{subtitle}</p>}
      </div>
      {actions && (
        // min-w-0 lets this shrink below its content's natural width once
        // both it and the title (above) have given up what they can; the
        // row of action buttons then scrolls horizontally within itself
        // instead of widening the whole page, which would drag the sidebar
        // nav off-screen too — see LAUNCH_READINESS.md. The title keeps a
        // plain auto flex-basis (not flex-1, which resolves to basis 0% and
        // would let it collapse to nothing whenever the actions row alone
        // doesn't fit) so it shrinks proportionally with the actions row
        // instead of disappearing first.
        <div className="flex items-center gap-2 min-w-0 shrink overflow-x-auto">{actions}</div>
      )}
    </div>
  );
}
