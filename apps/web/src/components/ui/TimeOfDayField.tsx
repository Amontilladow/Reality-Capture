import { useId } from 'react';
import { FieldShell } from './Field';
import { Listbox } from './Listbox';

// Replaces a native <input type="time">: that control's picker style
// (a circular/analogue dial on Android, a digital spinner elsewhere) and
// its 12h-AM/PM-vs-24h display both follow the DEVICE's own locale/OS
// setting, which a web page cannot override through the native time
// input's own attributes -- there is no HTML attribute for "always show
// AM/PM" or "always show digits." Reported as "the clock is analogue,
// I want digital with AM/PM," which is really a request for a
// fully app-controlled time picker instead of native browser/OS chrome.
//
// Stores and emits the same value a native time input does -- a 24-hour
// "HH:MM" string, or '' when unset -- so call sites and the API need no
// changes; only how the value is PICKED changes.
const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

interface ParsedTime {
  hour12: string;
  minute: string;
  period: 'AM' | 'PM';
}

function parseTime(value: string): ParsedTime | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12: String(hour12), minute, period };
}

function composeTime(hour12: string, minute: string, period: 'AM' | 'PM'): string {
  let hour24 = Number(hour12) % 12;
  if (period === 'PM') hour24 += 12;
  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

// A sensible starting point once the user picks the FIRST part of a
// previously-unset time, so choosing just the hour doesn't require also
// immediately choosing a minute and AM/PM before anything is stored.
const DEFAULT_PART: ParsedTime = { hour12: '9', minute: '00', period: 'AM' };

export function TimeOfDayField({
  label, requirement, hint, error, id, value, onChange, disabled,
}: {
  label: string;
  requirement?: 'required' | 'optional' | 'system';
  hint?: string;
  error?: string;
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const parsed = parseTime(value);

  function setPart(part: keyof ParsedTime, partValue: string) {
    const base = parsed ?? DEFAULT_PART;
    onChange(composeTime(
      part === 'hour12' ? partValue : base.hour12,
      part === 'minute' ? partValue : base.minute,
      (part === 'period' ? partValue : base.period) as 'AM' | 'PM',
    ));
  }

  return (
    <FieldShell id={fieldId} label={label} requirement={requirement} hint={hint} error={error}>
      <div className="flex items-center gap-2">
        <Listbox
          id={fieldId} aria-label={`${label} — hour`} disabled={disabled} value={parsed?.hour12 ?? ''}
          onChange={(e) => setPart('hour12', e.target.value)} className="field-input w-20"
        >
          <option value="" disabled hidden>--</option>
          {HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
        </Listbox>
        <span className="text-ink-500" aria-hidden="true">:</span>
        <Listbox
          aria-label={`${label} — minute`} disabled={disabled} value={parsed?.minute ?? ''}
          onChange={(e) => setPart('minute', e.target.value)} className="field-input w-20"
        >
          <option value="" disabled hidden>--</option>
          {MINUTES_60.map((m) => <option key={m} value={m}>{m}</option>)}
        </Listbox>
        <Listbox
          aria-label={`${label} — AM or PM`} disabled={disabled} value={parsed?.period ?? ''}
          onChange={(e) => setPart('period', e.target.value)} className="field-input w-24"
        >
          <option value="" disabled hidden>--</option>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </Listbox>
      </div>
    </FieldShell>
  );
}
