import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import type { Crumb } from '../ui/Breadcrumbs';

export function PageHeader({
  breadcrumbs,
  eyebrow,
  title,
  actions,
}: {
  breadcrumbs?: Crumb[];
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
}) {
  useDocumentTitle(title);

  return (
    <div className={`border-b border-base-600 bg-base-900/60 backdrop-blur px-6 flex items-center justify-between gap-3 sticky top-0 z-10 ${breadcrumbs ? 'py-2.5' : 'h-16'}`}>
      <div className="min-w-0 shrink">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        {eyebrow && <div className="text-eyebrow font-mono uppercase text-ink-500 truncate">{eyebrow}</div>}
        <h1 className="text-base font-semibold tracking-tight -mt-0.5 truncate">{title}</h1>
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
