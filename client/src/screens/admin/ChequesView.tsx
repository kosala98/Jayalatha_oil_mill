import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/endpoints';
import { describeError } from '../../api/errors';
import { useSession } from '../../auth/Session';
import { Field } from '../../components/Field';
import { todayIso } from '../../domain/payment';
import type { ChequeDay, ChequeItem } from '../../domain/types';
import { S, t } from '../../i18n';
import { formatMoney } from '../../lib/numbers';
import { useLiveRefresh } from '../../lib/live';

/**
 * "Which cheques go to the bank today?" — the question this screen exists for.
 * Defaults to today and filters by the deposit date the cashier entered, not by
 * the day the cheque was taken.
 */
export function ChequesView() {
  const { session, handleAuthError } = useSession();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<ChequeDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.cheques(from, to < from ? from : to, session.token));
    } catch (err) {
      if (!handleAuthError(err)) setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [session, handleAuthError, from, to]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['sales', 'purchases', 'customer_payments', 'customers'], () => void load());

  const incoming = data?.items.filter((i) => i.direction === 'IN') ?? [];
  const outgoing = data?.items.filter((i) => i.direction === 'OUT') ?? [];

  return (
    <div className="stack">
      <section className="card">
        <h3 className="card__title">{S.cheques.title}</h3>
        <p className="muted small">{S.cheques.help}</p>
        <div className="field-row">
          <Field label={S.cheques.from} value={from} onChange={setFrom} type="date" />
          <Field label={S.cheques.to} value={to} onChange={setTo} type="date" />
        </div>
        <button
          type="button"
          className="btn btn--quiet btn--sm btn--block"
          onClick={() => {
            setFrom(todayIso());
            setTo(todayIso());
          }}
        >
          {S.common.today}
        </button>
      </section>

      {error && <p className="card form-error">{error}</p>}
      {loading && <p className="muted center">{S.common.loading}</p>}

      {data && !loading && (
        <>
          <dl className="card figures">
            <div>
              <dt>{S.cheques.incoming}</dt>
              <dd className="figures__value">{formatMoney(data.incomingTotal)}</dd>
              <dd className="figures__hint">{t(S.stats.count, { n: incoming.length })}</dd>
            </div>
            <div>
              <dt>{S.cheques.outgoing}</dt>
              <dd className="figures__value">{formatMoney(data.outgoingTotal)}</dd>
              <dd className="figures__hint">{t(S.stats.count, { n: outgoing.length })}</dd>
            </div>
          </dl>

          {data.items.length === 0 && <p className="card empty">{S.cheques.empty}</p>}
          {incoming.length > 0 && <ChequeList title={S.cheques.incoming} items={incoming} />}
          {outgoing.length > 0 && <ChequeList title={S.cheques.outgoing} items={outgoing} />}
        </>
      )}
    </div>
  );
}

function ChequeList({ title, items }: { title: string; items: ChequeItem[] }) {
  return (
    <section className="card">
      <h3 className="card__title">{title}</h3>
      <ul className="history history--plain">
        {items.map((c) => (
          <li key={`${c.kind}-${c.id}`} className="history__row">
            <div className="history__main">
              <span className="history__title">{t(S.cheques.number, { n: c.chequeNumber ?? '—' })}</span>
              <span className="history__meta">
                {c.kind === 'sale' ? S.cheques.kindSale : c.kind === 'purchase' ? S.cheques.kindPurchase : S.cheques.kindPayment}
                {c.customer ? ` · ${c.customer.name}` : ''}
              </span>
              <span className="history__meta">
                {t(S.cheques.depositOn, { date: (c.depositDate ?? '').slice(0, 10) })}
              </span>
            </div>
            <span className="history__amount">{formatMoney(c.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
