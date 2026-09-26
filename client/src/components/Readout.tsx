import { formatMoney } from '../lib/numbers';
import { S } from '../i18n';

interface Props {
  label: string;
  /** Decimal string; null shows a dash (form not complete yet). */
  amount: string | null;
  note?: string;
  size?: 'lg' | 'xl';
  /**
   * A smaller figure above the main one. During a combined visit the big number is
   * the balance of the whole visit, and this keeps the line being typed in view.
   */
  sub?: { label: string; amount: string | null };
  /**
   * The three ways the money is moving, under the headline figure. The cash line is
   * highlighted because that is the one the drawer has to match at the end of the day.
   */
  breakdown?: { label: string; amount: string; strong?: boolean }[];
}

/**
 * The mill's "weighbridge" readout: dark coconut-shell panel, amber oil-coloured digits.
 * Used for the running total on entry forms and the cash balance on the summary.
 */
export function Readout({ label, amount, note, size = 'lg', sub, breakdown }: Props) {
  return (
    <div className={`readout readout--${size}`}>
      {sub && (
        <span className="readout__sub">
          <span>{sub.label}</span>
          <span className="readout__subValue">
            {S.common.rs} {sub.amount === null ? '—' : formatMoney(sub.amount)}
          </span>
        </span>
      )}
      <span className="readout__label">{label}</span>
      <span className="readout__value">
        <span className="readout__currency">{S.common.rs}</span>
        {amount === null ? <span className="readout__empty">—</span> : formatMoney(amount)}
      </span>
      {breakdown && breakdown.length > 0 && (
        <span className="readout__parts">
          {breakdown.map((part) => (
            <span key={part.label} className={`readout__part ${part.strong ? 'readout__part--strong' : ''}`}>
              <span>{part.label}</span>
              <span className="readout__partValue">
                {S.common.rs} {formatMoney(part.amount)}
              </span>
            </span>
          ))}
        </span>
      )}
      {note && <span className="readout__note">{note}</span>}
    </div>
  );
}
