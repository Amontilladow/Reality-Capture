import {
  Children, Fragment, forwardRef, isValidElement, useCallback, useEffect, useId, useImperativeHandle,
  useLayoutEffect, useRef, useState,
} from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Drop-in replacement for a native <select> (house rule: never ship one --
// it draws its own chevron flush against the control edge and can't be
// themed). Implements the WAI-ARIA "select-only combobox" pattern: a button
// with role="combobox" keeps focus the whole time and points at the active
// option through aria-activedescendant, while the listbox renders in a
// portal so overflow-hidden parents (modals, tables, cards) can't clip it.
//
// The API deliberately mirrors <select> so call sites change one tag name:
// it takes <option> children (fragments and arrays flattened), value or
// defaultValue, and onChange receives an object with target.value, so
// existing `onChange={(e) => setX(e.target.value)}` handlers keep working.
// For react-hook-form, wire it through <Controller> rather than register():
// register() needs a real native input to read from.

export interface ListboxChangeEvent {
  target: { value: string; name: string };
  currentTarget: { value: string; name: string };
}

interface ParsedOption {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
  hidden: boolean;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function collectOptions(children: ReactNode, out: ParsedOption[] = []): ParsedOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      collectOptions((child.props as { children?: ReactNode }).children, out);
      return;
    }
    if (child.type === 'option') {
      const p = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean; hidden?: boolean };
      const text = textOf(p.children);
      out.push({
        value: p.value !== undefined ? String(p.value) : text,
        label: p.children,
        text,
        disabled: !!p.disabled,
        hidden: !!p.hidden,
      });
    }
  });
  return out;
}

const TYPEAHEAD_RESET_MS = 500;
const PAGE_STEP = 10;
const LIST_MAX_HEIGHT = 288;
const VIEWPORT_GUTTER = 8;

export interface ListboxProps {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: ListboxChangeEvent) => void;
  onBlur?: () => void;
  children?: ReactNode;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

export const Listbox = forwardRef<HTMLButtonElement, ListboxProps>(function Listbox(
  {
    value, defaultValue, onChange, onBlur, children, id, name, className = 'field-input', disabled, required, title,
    autoFocus, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby, 'aria-describedby': ariaDescribedby,
    'aria-invalid': ariaInvalid,
  },
  forwardedRef,
) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-listbox`;
  const optionId = (i: number) => `${autoId}-opt-${i}`;

  const options = collectOptions(children);
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string | undefined>(
    defaultValue !== undefined ? String(defaultValue) : undefined,
  );
  const current = isControlled ? String(value) : internalValue;

  // Same fallback as a native select: with no matching option, the first
  // visible one shows (without firing onChange).
  const matched = options.findIndex((o) => o.value === current);
  const firstVisible = options.findIndex((o) => !o.hidden);
  const selectedIndex = matched >= 0 ? matched : firstVisible;
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; minWidth: number } | null>(null);
  const [listLabel, setListLabel] = useState<string | undefined>(undefined);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: '', timer: 0 as number | ReturnType<typeof setTimeout> });
  useImperativeHandle(forwardedRef, () => triggerRef.current as HTMLButtonElement);

  const enabledIndexes = options.map((o, i) => (!o.disabled && !o.hidden ? i : -1)).filter((i) => i >= 0);

  const step = useCallback((from: number, delta: number) => {
    if (!enabledIndexes.length) return -1;
    const pos = enabledIndexes.indexOf(from);
    if (pos === -1) return delta > 0 ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1];
    const next = Math.min(enabledIndexes.length - 1, Math.max(0, pos + delta));
    return enabledIndexes[next];
  }, [enabledIndexes]);

  function openList(activeIndex?: number) {
    if (disabled) return;
    const start = activeIndex ?? (enabledIndexes.includes(selectedIndex) ? selectedIndex : enabledIndexes[0] ?? -1);
    setActive(start);
    if (!ariaLabel && !ariaLabelledby && triggerRef.current) {
      const label = document.querySelector(`label[for="${CSS.escape(triggerRef.current.id)}"]`);
      setListLabel(label?.textContent?.trim() || undefined);
    }
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setPosition(null);
  }

  function commit(index: number) {
    const option = options[index];
    close();
    if (!option || option.disabled) return;
    if (option.value === current) return;
    if (!isControlled) setInternalValue(option.value);
    const target = { value: option.value, name: name ?? '' };
    onChange?.({ target, currentTarget: target });
  }

  function runTypeahead(char: string): number {
    const state = typeahead.current;
    clearTimeout(state.timer);
    state.buffer += char.toLowerCase();
    state.timer = setTimeout(() => { state.buffer = ''; }, TYPEAHEAD_RESET_MS);
    // Repeating one letter cycles through the options starting with it,
    // like a native select; otherwise match the whole typed prefix.
    const cycling = state.buffer.split('').every((c) => c === state.buffer[0]);
    const needle = cycling ? state.buffer[0] : state.buffer;
    const from = open ? active : selectedIndex;
    const startPos = cycling ? enabledIndexes.indexOf(from) + 1 : Math.max(0, enabledIndexes.indexOf(from));
    const ordered = [...enabledIndexes.slice(startPos), ...enabledIndexes.slice(0, startPos)];
    const hit = ordered.find((i) => options[i].text.trim().toLowerCase().startsWith(needle));
    return hit ?? -1;
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    const { key, altKey } = e;
    const printable = key.length === 1 && !e.ctrlKey && !e.metaKey && !(altKey && key !== ' ');

    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        openList();
      } else if (key === 'Home' || key === 'End') {
        e.preventDefault();
        openList(key === 'Home' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]);
      } else if (printable) {
        e.preventDefault();
        const hit = runTypeahead(key);
        openList(hit >= 0 ? hit : undefined);
      }
      return;
    }

    switch (key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => step(a, 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (altKey) commit(active);
        else setActive((a) => step(a, -1));
        return;
      case 'Home':
        e.preventDefault();
        setActive(enabledIndexes[0] ?? -1);
        return;
      case 'End':
        e.preventDefault();
        setActive(enabledIndexes[enabledIndexes.length - 1] ?? -1);
        return;
      case 'PageDown':
        e.preventDefault();
        setActive((a) => step(a, PAGE_STEP));
        return;
      case 'PageUp':
        e.preventDefault();
        setActive((a) => step(a, -PAGE_STEP));
        return;
      case 'Enter':
        e.preventDefault();
        commit(active);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'Tab':
        commit(active);
        return;
      default:
        break;
    }
    if (key === ' ' && !typeahead.current.buffer) {
      e.preventDefault();
      commit(active);
      return;
    }
    if (printable) {
      e.preventDefault();
      const hit = runTypeahead(key);
      if (hit >= 0) setActive(hit);
    }
  }

  // Position the portaled list against the trigger: below by default,
  // flipped above when there's more room there, clamped to the viewport.
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const listHeight = Math.min(LIST_MAX_HEIGHT, listRef.current?.scrollHeight ?? LIST_MAX_HEIGHT);
    const below = window.innerHeight - rect.bottom;
    const flip = below < listHeight + VIEWPORT_GUTTER && rect.top > below;
    const width = Math.max(rect.width, listRef.current?.offsetWidth ?? 0);
    const left = Math.max(VIEWPORT_GUTTER, Math.min(rect.left, window.innerWidth - width - VIEWPORT_GUTTER));
    setPosition(flip
      ? { bottom: window.innerHeight - rect.top + 4, left, minWidth: rect.width }
      : { top: rect.bottom + 4, left, minWidth: rect.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // optionId is derived from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // A click anywhere outside the trigger and the list closes it without
  // changing the value, same as clicking away from an open native select.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => () => clearTimeout(typeahead.current.timer), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        title={title}
        autoFocus={autoFocus}
        className={`${className} inline-flex items-center justify-between gap-2 text-left ${open ? 'border-blueprint ring-2 ring-blueprint/20' : ''}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (open) close();
          onBlur?.();
        }}
      >
        {/* Every label stacked invisibly in one grid cell, so an auto-width
            trigger sizes to its longest option the way a native select
            does instead of jumping as the value changes. minmax(0,1fr)
            still lets a full-width trigger shrink and truncate. */}
        <span className="grid grid-cols-[minmax(0,1fr)] flex-1 min-w-0">
          <span className={`col-start-1 row-start-1 truncate ${selected?.disabled ? 'text-ink-500' : ''}`}>
            {selected ? selected.label : '\u00a0'}
          </span>
          {options.map((option, i) => (option.hidden ? null : (
            <span key={`${option.value}-${i}`} aria-hidden="true" className="col-start-1 row-start-1 invisible h-0 truncate">
              {option.label}
            </span>
          )))}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true" className={`w-4 h-4 shrink-0 text-ink-500 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {name && <input type="hidden" name={name} value={selected?.value ?? ''} />}
      {open && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel ?? listLabel}
          aria-labelledby={ariaLabel ? undefined : ariaLabelledby}
          tabIndex={-1}
          // Keep focus on the trigger: the list is never focused, it's
          // driven through aria-activedescendant.
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: position?.top,
            bottom: position?.bottom,
            left: position?.left ?? 0,
            minWidth: position?.minWidth,
            maxHeight: LIST_MAX_HEIGHT,
            maxWidth: `min(28rem, calc(100vw - ${VIEWPORT_GUTTER * 2}px))`,
            visibility: position ? 'visible' : 'hidden',
          }}
          className="z-[70] overflow-auto rounded-lg border border-base-600 bg-base-800 py-2 shadow-lg"
        >
          {options.length === 0 && (
            <li role="option" aria-selected={false} aria-disabled="true" className="px-4 py-2 text-sm text-ink-500">
              No options
            </li>
          )}
          {options.map((option, i) => (option.hidden ? null : (
            <li
              key={`${option.value}-${i}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === selectedIndex}
              aria-disabled={option.disabled || undefined}
              onMouseMove={() => { if (!option.disabled && active !== i) setActive(i); }}
              onClick={() => { if (!option.disabled) commit(i); }}
              className={`flex items-center gap-2 min-h-8 px-4 py-2 text-sm cursor-pointer select-none ${
                option.disabled ? 'text-ink-500 cursor-not-allowed' : 'text-ink-100'
              } ${i === active && !option.disabled ? 'bg-base-700' : ''} ${i === selectedIndex ? 'font-medium' : ''}`}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 text-blueprint ${i === selectedIndex ? '' : 'invisible'}`} fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate">{option.label}</span>
            </li>
          )))}
        </ul>,
        document.body,
      )}
    </>
  );
});
