import { useEffect, useState } from 'react';
import { S } from '../i18n';

interface Props {
  onSubmit(pin: string): Promise<void>;
  error: string | null;
  busy: boolean;
  /** Defaults to the admin prompt; the sign-in screen asks more generally. */
  title?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const MAX = 8;

/** Big-button keypad for the counter tablet. Also accepts a hardware keyboard. */
export function PinPad({ onSubmit, error, busy, title }: Props) {
  const [pin, setPin] = useState('');

  const press = (d: string) => setPin((p) => (p.length < MAX ? p + d : p));
  const back = () => setPin((p) => p.slice(0, -1));
  const submit = async () => {
    if (pin.length < 4 || busy) return;
    try {
      await onSubmit(pin);
    } finally {
      setPin('');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pinpad">
      <p className="pinpad__prompt">{title ?? S.admin.enterPin}</p>
      <div className="pinpad__dots" aria-hidden="true">
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={`pinpad__dot ${i < pin.length ? 'is-filled' : ''}`} />
        ))}
      </div>
      <p className="field__error pinpad__error" role="alert">
        {error ?? '\u00a0'}
      </p>
      <div className="pinpad__grid">
        {KEYS.map((k) => (
          <button key={k} type="button" className="pinpad__key" onClick={() => press(k)} disabled={busy}>
            {k}
          </button>
        ))}
        <button type="button" className="pinpad__key pinpad__key--quiet" onClick={back} disabled={busy} aria-label={S.admin.backspace}>
          ⌫
        </button>
        <button type="button" className="pinpad__key" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button
          type="button"
          className="pinpad__key pinpad__key--go"
          onClick={() => void submit()}
          disabled={busy || pin.length < 4}
          aria-label={S.admin.unlock}
        >
          ✓
        </button>
      </div>
    </div>
  );
}
