import { type InputHTMLAttributes, useId } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string | null;
  /** Short text shown inside the field on the left, e.g. "රු." */
  prefix?: string;
  /** Short unit shown on the right, e.g. "KG" */
  suffix?: string;
  /** Keeps the label for screen readers while the row shows its own text. */
  hideLabel?: boolean;
}

export function Field({ label, value, onChange, error, prefix, suffix, hideLabel, className, ...rest }: Props) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id} className={`field__label ${hideLabel ? 'visually-hidden' : ''}`}>
        {label}
      </label>
      <div className={`input ${error ? 'input--error' : ''}`}>
        {prefix && <span className="input__affix">{prefix}</span>}
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          autoComplete="off"
          {...rest}
        />
        {suffix && <span className="input__affix input__affix--end">{suffix}</span>}
      </div>
      {error && (
        <p id={errId} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Numeric text field: decimal keypad on phones, no browser spinner, no float coercion. */
export function NumberField(props: Props & { integer?: boolean }) {
  const { integer, ...rest } = props;
  return <Field inputMode={integer ? 'numeric' : 'decimal'} enterKeyHint="next" {...rest} />;
}
