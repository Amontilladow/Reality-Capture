import type { ReactNode } from 'react';

// Primary section heading for dashboards/reports. Hierarchy comes from the
// title's weight and size, not decoration: no accent bar, no chip. tone
// still carries meaning on the eyebrow only -- 'orange' marks AI-generated
// content (the one place that color appears), 'blueprint' a navigational
// section, 'teal' (default) a plain data section, rendered in muted ink so
// ordinary sections stay quiet.
const TONE_EYEBROW: Record<'teal' | 'orange' | 'blueprint', string> = {
  teal: 'text-ink-500',
  orange: 'text-orange',
  blueprint: 'text-blueprint',
};

export function SectionHeader({ eyebrow, title, tone = 'teal', actions, size = 'md' }: {
  eyebrow?: string;
  title: string;
  tone?: 'teal' | 'orange' | 'blueprint';
  actions?: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        {eyebrow && (
          <div className={`flex items-center gap-2 text-xs font-medium mb-0 ${TONE_EYEBROW[tone]}`}>
            {tone === 'orange' && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-orange" />}
            {eyebrow}
          </div>
        )}
        <h2 className={`font-semibold text-ink-100 tracking-tight truncate ${size === 'sm' ? 'text-sm' : 'text-base'}`}>
          {title}
        </h2>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
