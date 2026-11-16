// Management or engineer view of the same page. Saved to the user's
// preferences; the default comes from their company role.
export function PerspectiveSwitch({ value, onChange }: { value: 'management' | 'engineer'; onChange: (v: 'management' | 'engineer') => void }) {
  return (
    <div role="radiogroup" aria-label="Dashboard view" className="inline-flex p-0 rounded-full border border-ink-100/15 bg-base-800/60">
      {(['engineer', 'management'] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`h-8 px-4 rounded-full text-xs font-medium transition-colors ${value === v ? 'bg-ink-100 text-base-950' : 'text-ink-300 hover:text-ink-100'}`}>
          {v === 'engineer' ? 'Engineer view' : 'Management view'}
        </button>
      ))}
    </div>
  );
}
