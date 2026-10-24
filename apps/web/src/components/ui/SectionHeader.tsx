import type { ReactNode } from 'react';

// A heavier section header than field-label (block/components/ui): a
// colored left accent-bar + small-caps eyebrow + a bolder title, for the
// primary section headings on dashboards/reports (platform visual
// upgrade). field-label stays as-is for smaller inline labels (form
// fields, dense stat-tile captions) -- this is specifically for the
// "what section am I looking at" headings above a panel/grid/table.
//
// tone is purely an accent choice, never a status signal: 'teal' is the
// default for ordinary section headers; 'orange' is reserved for AI-
// generated content panels so that color consistently means "AI" wherever
// it appears; 'blueprint' is available for a section that's itself a
// navigational/interactive surface. None of the three ever substitute for
// ok/warn/danger, which stay exclusively on status-tone.ts's own meanings.
const TONE_BAR: Record<'teal' | 'orange' | 'blueprint', string> = {
  teal: 'bg-teal',
  orange: 'bg-orange',
  blueprint: 'bg-blueprint',
};
const TONE_TEXT: Record<'teal' | 'orange' | 'blueprint', string> = {
  teal: 'text-teal',
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
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-stretch gap-3 min-w-0">
        <span className={`w-1 rounded-full shrink-0 ${TONE_BAR[tone]}`} />
        <div className="min-w-0">
          {eyebrow && (
            <div className={`text-eyebrow font-mono uppercase tracking-widest mb-0.5 ${TONE_TEXT[tone]}`}>
              {eyebrow}
            </div>
          )}
          <h2 className={`font-semibold text-ink-100 tracking-tight truncate ${size === 'sm' ? 'text-xs uppercase tracking-wide' : 'text-sm'}`}>
            {title}
          </h2>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
