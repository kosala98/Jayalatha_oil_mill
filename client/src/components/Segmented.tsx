import { type KeyboardEvent, useId, useRef } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  label: string;
  options: readonly SegmentOption<T>[];
  /** null: nothing selected (another control is choosing instead). */
  value: T | null;
  onChange(value: NoInfer<T>): void;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  size?: 'md' | 'sm';
}

/** A radio group drawn as a segmented control. Arrow keys move the selection. */
export function Segmented<T extends string | number>({ label, options, value, onChange, hideLabel, size = 'md' }: Props<T>) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div className="field">
      <span id={id} className={hideLabel ? 'sr-only' : 'field__label'}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className={`segmented segmented--${size}`}>
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked || (value === null && i === 0) ? 0 : -1}
              className="segmented__option"
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
