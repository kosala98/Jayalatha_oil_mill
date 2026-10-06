import { useCallback, useEffect, useState } from 'react';
import { api, type HistoryKind, type HistoryRecord } from '../../api/endpoints';
import { describeError } from '../../api/errors';
import { useSession } from '../../auth/Session';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { FALLBACK_PRODUCTS } from '../../domain/catalog';
import { todayIso } from '../../domain/payment';
import type { CashEntry, CustomerPayment, Period, Purchase, Sale } from '../../domain/types';
import { S } from '../../i18n';
import { formatMoney, formatStamp, formatQty } from '../../lib/numbers';
import { PeriodPicker } from './PeriodPicker';
import { useLatestGuard, useLiveRefresh, useNewDayRefresh } from '../../lib/live';

/** Sales, purchases, cash entries, and money received from or paid to customers. */
type ListedKind = HistoryKind;
type AnyRecord = HistoryRecord[ListedKind];
const KINDS = (['sale', 'purchase', 'cash', 'payment'] as const).map((k) => ({ value: k, label: S.history.types[k] }));
const productName = (code: string) => FALLBACK_PRODUCTS.find((p) => p.code === code)?.nameSi ?? code;

/**
 * Which way the money moved for the mill: 'in' is an asset gained (a sale, cash put in
 * the drawer, money received from a customer), 'out' a liability or outflow (a purchase,
 * an expense, money paid to a customer).
 */
type Flow = 'in' | 'out';

function describe(
  kind: HistoryKind,
  r: AnyRecord,
): { title: string; detail: string; amount: string; cheque: string | null; split: string | null; flow: Flow } {
  if (kind === 'sale') {
    const s = r as Sale;
    const unit = s.unitType === 'BOTTLE' && s.bottleSize
      ? `${S.labels.bottleSizes[s.bottleSize]} ${S.labels.units.BOTTLE}`
      : S.labels.units[s.unitType];
    return {
      title: productName(s.productCode),
      detail: `${formatQty(s.quantity)} ${unit} × ${formatMoney(s.pricePerUnit)}`,
      amount: s.total,
      cheque: Number(s.chequeAmount) > 0 ? s.chequeNumber : null,
      split: splitLabel(s),
      flow: 'in',
    };
  }
  if (kind === 'purchase') {
    const p = r as Purchase;
    return {
      title: p.material === 'OTHER' ? p.customName ?? S.labels.materials.OTHER : S.labels.materials[p.material],
      detail: `${formatQty(p.quantityKg)} KG × ${formatMoney(p.pricePerKg)}`,
      amount: p.total,
      cheque: Number(p.chequeAmount) > 0 ? p.chequeNumber : null,
      split: splitLabel(p),
      flow: 'out',
    };
  }
  if (kind === 'payment') {
    const p = r as CustomerPayment;
    const what = p.direction === 'RECEIVED' ? S.customers.directionReceived : S.customers.directionPaid;
    const how = [p.kind === 'LOAN' ? S.labels.ledgerKinds.loan : null, S.labels.payment[p.method], p.note]
      .filter(Boolean)
      .join(' · ');
    return {
      title: `${p.customerName ?? ''} · ${what}`,
      detail: how,
      amount: p.amount,
      cheque: p.method === 'CHEQUE' ? p.chequeNumber : null,
      split: null,
      flow: p.direction === 'RECEIVED' ? 'in' : 'out',
    };
  }
  const c = r as CashEntry;
  return {
    title: S.labels.cashTypes[c.type],
    detail: c.note ?? '',
    amount: c.amount,
    cheque: null,
    split: null,
    flow: c.type === 'EXPENSE' ? 'out' : 'in',
  };
}

/** "මුදල් 2,000 · චෙක් 2,000 · ණය 6,000" — only the parts that are actually used. */
function splitLabel(r: { cashAmount: string; chequeAmount: string; creditAmount: string }): string | null {
  const parts = [
    Number(r.cashAmount) > 0 && `${S.labels.payment.CASH} ${formatMoney(r.cashAmount)}`,
    Number(r.chequeAmount) > 0 && `${S.labels.payment.CHEQUE} ${formatMoney(r.chequeAmount)}`,
    Number(r.creditAmount) > 0 && `${S.labels.payment.CREDIT} ${formatMoney(r.creditAmount)}`,
  ].filter(Boolean) as string[];
  return parts.length > 1 ? parts.join(' · ') : null;
}

export function HistoryView() {
  const { session, handleAuthError } = useSession();
  const toast = useToast();
  const [kind, setKind] = useState<ListedKind>('sale');
  const [period, setPeriod] = useState<Period>('today');
  // Calendar days picked by hand ('YYYY-MM-DD'); while `dateFrom` is set it replaces the period.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const range = dateFrom ? { from: dateFrom, to: dateTo && dateTo >= dateFrom ? dateTo : dateFrom } : null;
  const rangeFrom = range?.from;
  const rangeTo = range?.to;
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [items, setItems] = useState<AnyRecord[]>([]);
  // Which kind `items` belongs to, so a tab switch never renders sales as purchases for a frame.
  const [itemsKind, setItemsKind] = useState<ListedKind>('sale');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<AnyRecord | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const begin = useLatestGuard();
  const load = useCallback(
    async (append: string | null) => {
      if (!session) return;
      const isCurrent = begin();
      setLoading(true);
      setError(null);
      try {
        const range = rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : null;
        const page = await api.list(kind, { period, range, cursor: append, includeDeleted }, session.token);
        if (!isCurrent()) return;
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setItemsKind(kind);
        setCursor(page.nextCursor);
      } catch (err) {
        if (isCurrent() && !handleAuthError(err)) setError(describeError(err));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [kind, period, rangeFrom, rangeTo, includeDeleted, session, handleAuthError, begin],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    void load(null);
  }, [load]);
  // A new or deleted row elsewhere: reload the first page (older pages are fetched again on demand).
  useLiveRefresh(['sales', 'purchases', 'cash_entries', 'customer_payments', 'customers'], () => {
    setCursor(null);
    void load(null);
  });
  useNewDayRefresh(() => {
    setCursor(null);
    void load(null);
  });

  const shown = itemsKind === kind ? items : [];

  async function confirmDelete() {
    if (!target || !session) return;
    if (reason.trim().length < 3) {
      setReasonError(S.history.reasonTooShort);
      return;
    }
    setDeleting(true);
    try {
      const updated = await api.remove(kind, target.id, reason.trim(), session.token);
      setItems((prev) =>
        includeDeleted ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev.filter((i) => i.id !== updated.id),
      );
      toast(S.history.deletedToast, 'success');
      setTarget(null);
    } catch (err) {
      if (!handleAuthError(err)) setReasonError(describeError(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="stack">
      <Segmented label={S.history.type} hideLabel options={KINDS} value={kind} onChange={setKind} />
      <PeriodPicker
        value={range ? null : period}
        onChange={(p) => {
          setPeriod(p);
          setDateFrom('');
          setDateTo('');
        }}
      />
      <div className="field-row">
        <Field label={S.history.dateFrom} value={dateFrom} onChange={setDateFrom} type="date" max={todayIso()} />
        <Field
          label={S.history.dateTo}
          value={dateTo}
          onChange={setDateTo}
          type="date"
          min={dateFrom || undefined}
          max={todayIso()}
        />
      </div>
      {(dateFrom || dateTo) && (
        <button
          type="button"
          className="btn btn--quiet btn--sm btn--block"
          onClick={() => {
            setDateFrom('');
            setDateTo('');
          }}
        >
          {S.history.clearDates}
        </button>
      )}
      <label className="check">
        <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
        {S.history.showDeleted}
      </label>
      <p className="history__legend small">
        <span className="history__amount--in">+ {S.history.flowIn}</span>
        <span className="history__amount--out">− {S.history.flowOut}</span>
      </p>

      {error && (
        <div className="card notice">
          <p>{error}</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void load(null)}>
            {S.common.reload}
          </button>
        </div>
      )}

      {!error && !loading && shown.length === 0 && <p className="card empty">{S.history.empty}</p>}

      {shown.length > 0 && (
        <ul className="card history">
          {shown.map((r) => {
            const d = describe(kind, r);
            return (
              <li key={r.id} className={`history__row ${r.isDeleted ? 'is-deleted' : ''}`}>
                <div className="history__main">
                  <span className="history__title">{d.title}</span>
                  {d.detail && <span className="history__detail">{d.detail}</span>}
                  <span className="history__meta">
                    {formatStamp(r.occurredAt)}
                    {d.cheque && <span className="badge">{S.labels.payment.CHEQUE} #{d.cheque}</span>}
                    {r.isDeleted && <span className="badge badge--deleted">{S.history.deleted}</span>}
                  </span>
                  {d.split && <span className="history__meta history__split">{d.split}</span>}
                  {r.isDeleted && r.deleteReason && <span className="history__reason">{r.deleteReason}</span>}
                </div>
                <div className="history__side">
                  <span className={`history__amount history__amount--${d.flow}`}>
                    {d.flow === 'in' ? '+ ' : '− '}
                    {formatMoney(d.amount)}
                  </span>
                  {!r.isDeleted && (
                    <button
                      type="button"
                      className="btn btn--danger-quiet btn--sm"
                      onClick={() => {
                        setTarget(r);
                        setReason('');
                        setReasonError(null);
                      }}
                    >
                      {S.history.delete}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {loading && <p className="muted center">{S.common.loading}</p>}
      {cursor && !loading && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => void load(cursor)}>
          {S.common.loadMore}
        </button>
      )}

      <Dialog open={target !== null} title={S.history.deleteTitle} onClose={() => !deleting && setTarget(null)}>
        {target && (
          <>
            <p className="dialog__summary">
              <strong>{describe(kind, target).title}</strong> — {S.common.rs} {formatMoney(describe(kind, target).amount)}
              <br />
              <span className="muted small">{formatStamp(target.occurredAt)}</span>
            </p>
            <p className="muted small">{S.history.deleteHelp}</p>
            <div className="field">
              <label htmlFor="delete-reason" className="field__label">
                {S.history.reason}
              </label>
              <textarea
                id="delete-reason"
                className={`textarea ${reasonError ? 'input--error' : ''}`}
                rows={3}
                maxLength={300}
                placeholder={S.history.reasonPlaceholder}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {reasonError && <p className="field__error">{reasonError}</p>}
            </div>
            <div className="dialog__actions">
              <button type="button" className="btn btn--quiet" onClick={() => setTarget(null)} disabled={deleting}>
                {S.common.cancel}
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? S.common.saving : S.history.confirmDelete}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
