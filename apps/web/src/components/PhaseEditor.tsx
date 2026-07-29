import { useState } from 'react';
import type { ProjectPhase } from '@engineeringos/types';
import { PROJECT_PHASES, PROJECT_PHASE_LABELS } from '@engineeringos/types';

export function PhaseEditor({
  phase,
  onSave,
  saving,
}: {
  phase?: ProjectPhase;
  onSave: (phase: ProjectPhase | '') => void;
  saving?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<ProjectPhase | ''>(phase ?? '');

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <select
          autoFocus
          className="field-input !py-1 !text-xs w-auto"
          value={value}
          onChange={(e) => setValue(e.target.value as ProjectPhase | '')}
        >
          <option value="">Unspecified</option>
          {PROJECT_PHASES.map((p) => (
            <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
          ))}
        </select>
        <button
          onClick={() => { onSave(value); setEditing(false); }}
          disabled={saving}
          className="btn-primary !px-2 !py-1 text-xs shrink-0"
        >
          Save
        </button>
        <button onClick={() => { setValue(phase ?? ''); setEditing(false); }} className="btn-ghost !px-1.5 !py-1 text-xs shrink-0">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-ink-500 hover:text-blueprint">
      <span>{phase ? PROJECT_PHASE_LABELS[phase] : 'Set phase'}</span>
      <EditIcon className="w-3 h-3" />
    </button>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
