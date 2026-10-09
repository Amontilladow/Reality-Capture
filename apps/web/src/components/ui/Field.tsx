import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type Requirement = 'required' | 'optional' | 'system';

const REQUIREMENT_SUFFIX: Record<Requirement, string> = {
  required: '',
  optional: '(optional)',
  system: '(auto-generated)',
};

// Shared label/error/hint chrome around .field-input/.field-label (index.css)
// -- every form field gets the same required/optional/system-generated
// marking (brief section 8) and the same error-to-input wiring
// (aria-invalid + aria-describedby pointing at the error text) for free,
// instead of each form re-deriving ids and deciding its own wording for
// "this one's optional."
function FieldShell({
  id,
  label,
  requirement = 'required',
  labelAddon,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  requirement?: Requirement;
  // A trailing element on the label's own row (e.g. Login's "Forgot
  // password?" link) -- rare enough not to warrant every field reasoning
  // about layout, common enough that re-deriving this flex row per form
  // isn't worth it either.
  labelAddon?: ReactNode;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="field-label">
          {label}
          {REQUIREMENT_SUFFIX[requirement] && <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-500">{REQUIREMENT_SUFFIX[requirement]}</span>}
        </label>
        {labelAddon}
      </div>
      {children}
      {hint && !error && <p id={hintId} className="text-xs text-ink-500 mt-1">{hint}</p>}
      {error && <p id={errorId} role="alert" className="field-error">{error}</p>}
    </div>
  );
}

type SharedProps = {
  label: string;
  requirement?: Requirement;
  labelAddon?: ReactNode;
  hint?: string;
  error?: string;
};

// forwardRef is required on all three fields below -- react-hook-form's
// register() returns a ref that must reach the real <input>/<textarea>/
// <select> DOM node for RHF to register and read the field's value.
// Without it, React silently drops the ref (dev-mode warning: "Function
// components cannot be given refs") and RHF never sees the field as
// registered, so handleSubmit() intermittently treats a visibly-filled,
// required field as empty -- confirmed by hand against the Login form,
// which uses this exact component.
export const Input = forwardRef<HTMLInputElement, SharedProps & InputHTMLAttributes<HTMLInputElement>>(
  function Input({ label, requirement, labelAddon, hint, error, id, ...rest }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    return (
      <FieldShell id={fieldId} label={label} requirement={requirement} labelAddon={labelAddon} hint={hint} error={error}>
        <input
          ref={ref}
          id={fieldId}
          className="field-input"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          {...rest}
        />
      </FieldShell>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, SharedProps & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ label, requirement, labelAddon, hint, error, id, ...rest }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    return (
      <FieldShell id={fieldId} label={label} requirement={requirement} labelAddon={labelAddon} hint={hint} error={error}>
        <textarea
          ref={ref}
          id={fieldId}
          className="field-input"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          {...rest}
        />
      </FieldShell>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SharedProps & SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ label, requirement, labelAddon, hint, error, id, children, ...rest }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    return (
      <FieldShell id={fieldId} label={label} requirement={requirement} labelAddon={labelAddon} hint={hint} error={error}>
        <select
          ref={ref}
          id={fieldId}
          className="field-input"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          {...rest}
        >
          {children}
        </select>
      </FieldShell>
    );
  },
);
