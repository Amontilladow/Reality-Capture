import type { ReactNode } from 'react';

// A heavier section header than field-label (block/components/ui): a
// colored left accent-bar + pill-chip eyebrow + a bold title, for the
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
//
// Deliberately heavy (6px bar, chip-backed eyebrow, bold title) -- the
// reference deck's "| DEEP DIVE: ..." treatment, not a quiet label. 'sm'
// still reads as a real heading (bold, normal case) rather than the old
// small-caps field-label look, since this component owns every primary
// section heading in the app now, not just the dense Reports rows.
const TONE_BAR: Record<'teal' | 'orange' | 'blueprint', string> = {
  teal: 'bg-teal',
  orange: 'bg-orange',
  blueprint: 'bg-blueprint',
};
const TONE_CHIP: Record<'teal' | 'orange' | 'blueprint', string> = {
  teal: 'bg-teal/10 text-teal',
  orange: 'bg-orange/10 text-orange',
  blueprint: 'bg-blueprint/10 text-blueprint',
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
        <span className={`w-1.5 rounded-full shrink-0 ${TONE_BAR[tone]}`} />
        <div className="min-w-0">
          {eyebrow && (
            <span className={`inline-block text-eyebrow font-mono uppercase tracking-widest mb-1 px-2 py-0.5 rounded-full ${TONE_CHIP[tone]}`}>
              {eyebrow}
            </span>
          )}
          <h2 className={`font-bold text-ink-100 tracking-tight truncate ${size === 'sm' ? 'text-sm' : 'text-lg'}`}>
            {title}
          </h2>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
