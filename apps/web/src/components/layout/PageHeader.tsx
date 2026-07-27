import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="h-16 border-b border-base-600 bg-base-900/60 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-10">
      <div>
        {eyebrow && <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">{eyebrow}</div>}
        <h1 className="text-base font-semibold tracking-tight -mt-0.5">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
