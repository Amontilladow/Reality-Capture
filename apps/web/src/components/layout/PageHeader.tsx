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
    <div className={`border-b border-base-600 bg-base-900/60 backdrop-blur px-6 flex items-center justify-between gap-3 sticky top-0 z-10 ${breadcrumbs || subtitle ? 'py-3' : 'h-[72px]'}`}>
      {/* Same 6px accent-bar language as SectionHeader (platform visual
          overhaul) -- every page's own title now carries the same weight
          as the sections inside it, instead of a plain text-base label. */}
      <div className="min-w-0 shrink flex items-stretch gap-3">
        <span className="w-1.5 rounded-full shrink-0 bg-teal" />
        <div className="min-w-0">
          {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          {eyebrow && (
            <span className="inline-block text-eyebrow font-mono uppercase tracking-widest mb-1 px-2 py-0.5 rounded-full bg-teal/10 text-teal truncate">
              {eyebrow}
            </span>
          )}
          <h1 className="text-xl font-bold tracking-tight -mt-0.5 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-ink-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
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
