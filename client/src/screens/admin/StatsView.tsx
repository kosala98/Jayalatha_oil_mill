import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../api/endpoints';
import { describeError } from '../../api/errors';
import { useSession } from '../../auth/Session';
import { Dialog } from '../../components/Dialog';
import { Field, NumberField } from '../../components/Field';
import { Readout } from '../../components/Readout';
import { useToast } from '../../components/Toast';
import { FALLBACK_PRODUCTS } from '../../domain/catalog';
import type { Period, Stats } from '../../domain/types';
import { S, t } from '../../i18n';
import { uuid } from '../../lib/ids';
import { formatMoney, formatQty } from '../../lib/numbers';
import { PeriodPicker } from './PeriodPicker';
import { LEDGER_TABLES, useLiveRefresh } from '../../lib/live';

const productName = (code: string) => FALLBACK_PRODUCTS.find((p) => p.code === code)?.nameSi ?? code;

export function StatsView() {
  const { session, handleAuthError } = useSession();
  const [period, setPeriod] = useState<Period>('today');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      setStats(await api.stats(period, session.token));
    } catch (err) {
      if (!handleAuthError(err)) setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [period, session, handleAuthError]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(LEDGER_TABLES, () => void load());

  return (
    <div className="stack">
      <PeriodPicker value={period} onChange={setPeriod} />

      {error && (
        <div className="card notice">
          <p>{error}</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void load()}>
            {S.common.reload}
          </button>
        </div>
      )}

      {stats && (
        <div className={`stack ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
          <Readout label={S.stats.cashBalance} amount={stats.cashBalance} note={S.stats.cashBalanceHelp} size="xl" />

          <section className="card figures">
            <Figure label={S.stats.totalSales} value={`${S.common.rs} ${formatMoney(stats.sales.total)}`} sub={t(S.stats.count, { n: stats.sales.count })} />
            <Figure label={S.stats.totalPurchases} value={`${S.common.rs} ${formatMoney(stats.purchases.total)}`} sub={t(S.stats.count, { n: stats.purchases.count })} />
            <Figure label={S.stats.chequeSales} value={`${S.common.rs} ${formatMoney(stats.sales.cheque)}`} sub={t(S.stats.count, { n: stats.sales.chequeCount })} />
            <Figure label={S.stats.chequePurchases} value={`${S.common.rs} ${formatMoney(stats.purchases.cheque)}`} sub={t(S.stats.count, { n: stats.purchases.chequeCount })} />
            <Figure label={S.stats.creditSales} value={`${S.common.rs} ${formatMoney(stats.sales.credit)}`} sub={t(S.stats.count, { n: stats.sales.creditCount })} />
            <Figure label={S.stats.creditPurchases} value={`${S.common.rs} ${formatMoney(stats.purchases.credit)}`} sub={t(S.stats.count, { n: stats.purchases.creditCount })} />
            <Figure label={S.stats.expenses} value={`${S.common.rs} ${formatMoney(stats.cash.expenses)}`} tone={Number(stats.cash.expenses) > 0 ? 'warn' : undefined} />
            <Figure
              label={Number(stats.customers.netReceivable) < 0 ? S.stats.payable : S.stats.receivable}
              value={`${S.common.rs} ${formatMoney(Math.abs(Number(stats.customers.netReceivable)).toFixed(2))}`}
              sub={S.stats.receivableHelp}
            />
          </section>

          <section className="card figures">
            <Figure label={S.stats.litersSold} value={`${formatQty(stats.litersSold)} L`} />
            <Figure label={S.stats.kgSold} value={`${formatQty(stats.kgSold)} KG`} sub={S.stats.kgSoldHelp} />
            <Figure
              label={S.stats.charcoalStock}
              value={`${formatQty(stats.charcoal.stockKg)} KG`}
              sub={S.stats.charcoalStockHelp}
              tone={Number(stats.charcoal.stockKg) <= 0 ? 'warn' : undefined}
            />
            <Figure label={S.stats.charcoalSold} value={`${formatQty(stats.charcoal.soldKg)} KG`} />
          </section>

          <button type="button" className="btn btn--quiet btn--sm btn--block" onClick={() => setFixing(true)}>
            ⟲ {S.stats.charcoalFix}
          </button>

          <section className="card">
            <dl className="ledger">
              <div><dt>{S.labels.cashTypes.OPENING_FLOAT}</dt><dd>{formatMoney(stats.cash.openingFloat)}</dd></div>
              <div><dt>{S.labels.cashTypes.TOP_UP}</dt><dd>{formatMoney(stats.cash.topUps)}</dd></div>
              <div><dt>{S.stats.cashSales}</dt><dd>+ {formatMoney(stats.cash.cashSales)}</dd></div>
              <div><dt>{S.labels.cashTypes.EXPENSE}</dt><dd>− {formatMoney(stats.cash.expenses)}</dd></div>
              <div><dt>{S.stats.cashPurchases}</dt><dd>− {formatMoney(stats.cash.cashPurchases)}</dd></div>
              <div><dt>{S.stats.customerCash}</dt><dd>+ {formatMoney(stats.cash.customerReceived)}</dd></div>
              <div><dt>{S.customers.directionPaid}</dt><dd>− {formatMoney(stats.cash.customerPaid)}</dd></div>
              <div className="ledger__total"><dt>{S.stats.cashBalance}</dt><dd>{formatMoney(stats.cashBalance)}</dd></div>
            </dl>
          </section>

          {stats.products.length > 0 && (
            <section className="card">
              <h3 className="card__title">{S.stats.byProduct}</h3>
              <ul className="breakdown">
                {stats.products.map((p) => (
                  <li key={p.productCode}>
                    <span className="breakdown__name">{productName(p.productCode)}</span>
                    <span className="muted small">
                      {[
                        Number(p.liters) > 0 && `${formatQty(p.liters)} L`,
                        Number(p.kg) > 0 && `${formatQty(p.kg)} KG`,
                        Number(p.bottles) > 0 && `${p.bottles} ${S.labels.units.BOTTLE}`,
                      ]
                        .filter(Boolean)
                        .join(' / ')}
                    </span>
                    <span className="breakdown__amount">{formatMoney(p.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {!stats && loading && <p className="muted center">{S.common.loading}</p>}

      <CharcoalFixDialog
        open={fixing}
        currentKg={stats?.charcoal.stockKg ?? '0'}
        onClose={() => setFixing(false)}
        onDone={() => {
          setFixing(false);
          void load();
        }}
      />
    </div>
  );
}

/**
 * Clears the difference left in charcoal stock once a batch is sold out —
 * weighing and moisture loss mean the computed figure rarely lands on zero.
 * Nothing in the history is edited: a signed correction is recorded instead.
 */
function CharcoalFixDialog({
  open,
  currentKg,
  onClose,
  onDone,
}: {
  open: boolean;
  currentKg: string;
  onClose(): void;
  onDone(): void;
}) {
  const { session, handleAuthError } = useSession();
  const toast = useToast();
  const [counted, setCounted] = useState('0');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    const next: Record<string, string> = {};
    if (!/^\d{1,12}(\.\d{1,3})?$/.test(counted.trim())) next.counted = S.validation.quantity;
    if (reason.trim().length < 3) next.reason = S.history.reasonTooShort;
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const result = await api.adjustCharcoal(
        { clientId: uuid(), countedKg: counted.trim(), reason: reason.trim() },
        session.token,
      );
      toast(result.unchanged ? S.stats.charcoalNoChange : S.stats.charcoalFixed, 'success');
      setReason('');
      onDone();
    } catch (err) {
      if (!handleAuthError(err)) setErrors({ reason: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={S.stats.charcoalFixTitle} onClose={() => !busy && onClose()}>
      <form onSubmit={onSubmit} noValidate>
        <p className="muted small">{S.stats.charcoalFixHelp}</p>
        <p className="dialog__summary">
          <strong>
            {S.stats.charcoalStock}: {formatQty(currentKg)} KG
          </strong>
        </p>
        <NumberField label={S.stats.charcoalCounted} value={counted} onChange={setCounted} error={errors.counted} />
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setCounted('0')}>
          {S.stats.charcoalZero}
        </button>
        <Field
          label={S.stats.charcoalFixReason}
          value={reason}
          onChange={setReason}
          error={errors.reason}
          placeholder={S.stats.charcoalFixReasonPlaceholder}
          maxLength={300}
        />
        <div className="dialog__actions">
          <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? S.common.saving : S.common.save}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className={`figure ${tone ? `figure--${tone}` : ''}`}>
      <span className="figure__label">{label}</span>
      <span className="figure__value">{value}</span>
      {sub && <span className="figure__sub">{sub}</span>}
    </div>
  );
}
