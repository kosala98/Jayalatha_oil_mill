import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { describeError } from '../api/errors';
import { useSession } from '../auth/Session';
import { Dialog } from '../components/Dialog';
import { Field, NumberField } from '../components/Field';
import { Segmented } from '../components/Segmented';
import { useToast } from '../components/Toast';
import { todayIso } from '../domain/payment';
import { newBillNo } from '../domain/bill';
import { presentBill } from '../lib/buildBill';
import type { Customer, CustomerProfile, LedgerEntry, PaymentDirection, SettlementMethod } from '../domain/types';
import { S } from '../i18n';
import { uuid } from '../lib/ids';
import { checkPositive, formatMoney, formatQty, formatStamp } from '../lib/numbers';
import { useCustomers } from '../lib/useCustomers';
import { FALLBACK_PRODUCTS } from '../domain/catalog';
import { useSubmit } from '../lib/useSubmit';
import { useLatestGuard, useLiveRefresh } from '../lib/live';

/**
 * Daily customers: the people who take oil now and pay at the end of the month.
 * Deliberately on the counter side, not behind the PIN — the person at the
 * counter is the one who gets asked "how much do I owe?".
 */
export function CustomersScreen() {
  const { customers, loading, stale, reload, addLocal } = useCustomers();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const shown = customers.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  if (openId) {
    return <CustomerProfileView id={openId} onBack={() => { setOpenId(null); void reload(); }} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h3 className="card__title">{S.customers.title}</h3>
        <p className="muted small">{S.customers.help}</p>
        <Field label={S.common.search} value={query} onChange={setQuery} placeholder={S.customers.searchPlaceholder} />
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setAdding(true)}>
          {S.customers.add}
        </button>
        {stale && <p className="muted small">{S.customers.offlineList}</p>}
      </section>

      {loading && customers.length === 0 && <p className="muted center">{S.common.loading}</p>}
      {!loading && customers.length === 0 && <p className="card empty">{S.customers.empty}</p>}
      {customers.length > 0 && shown.length === 0 && <p className="card empty">{S.customers.noMatch}</p>}

      {shown.length > 0 && (
        <ul className="card customer-list">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" className="customer-row" onClick={() => setOpenId(c.id)}>
                <span className="customer-row__main">
                  <span className="customer-row__name">{c.name}</span>
                  {c.phone && <span className="history__meta">{c.phone}</span>}
                </span>
                <BalanceTag balance={c.balance} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddCustomerDialog open={adding} onClose={() => setAdding(false)} onCreated={(c) => { addLocal(c); setAdding(false); setOpenId(c.id); }} />
    </div>
  );
}

/** Turns a stored code into the name the counter would say out loud. */
function detailName(detail: string): string {
  const product = FALLBACK_PRODUCTS.find((p) => p.code === detail);
  if (product) return product.nameSi;
  const material = S.labels.materials[detail as keyof typeof S.labels.materials];
  return material ?? detail;
}

/** "මුදල් 1,000 · චෙක් 4,000 (#778899) · ණය 4,000" — only the parts actually used. */
function splitOf(row: LedgerEntry): string {
  const parts = [
    Number(row.cashAmount) > 0 && `${S.labels.payment.CASH} ${formatMoney(row.cashAmount)}`,
    Number(row.chequeAmount) > 0 &&
      `${S.labels.payment.CHEQUE} ${formatMoney(row.chequeAmount)}${row.chequeNumber ? ` (#${row.chequeNumber})` : ''}`,
    Number(row.creditAmount) > 0 && `${S.labels.payment.CREDIT} ${formatMoney(row.creditAmount)}`,
  ].filter(Boolean) as string[];
  return parts.join(' · ');
}

/** Label on the left, figure on the right, an optional breakdown underneath. */
function Row({
  label,
  value,
  strong,
  children,
}: {
  label: string;
  value: string;
  strong?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`summary__row ${strong ? 'summary__row--strong' : ''}`}>
      <span className="summary__label">{label}</span>
      <span className="summary__value">{formatMoney(value)}</span>
      {children && <span className="summary__hint">{children}</span>}
    </div>
  );
}

function BalanceTag({ balance }: { balance: string }) {
  const n = Number(balance);
  if (n === 0) return <span className="balance balance--settled">{S.customers.settled}</span>;
  return (
    <span className={`balance ${n > 0 ? 'balance--owed' : 'balance--owing'}`}>
      <span className="balance__label">{n > 0 ? S.customers.owesUs : S.customers.weOwe}</span>
      <span className="balance__amount">
        {S.common.rs} {formatMoney(Math.abs(n).toFixed(2))}
      </span>
    </span>
  );
}

function AddCustomerDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(c: Customer): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setNameError(S.validation.customerName);
      return;
    }
    setNameError(null);
    setBusy(true);
    // Not queued like a sale: a customer needs a server id before a credit
    // transaction can point at them, so this one waits for the connection.
    try {
      const created = await api.createCustomer({
        clientId: uuid(),
        name: name.trim(),
        phone: phone.trim() || null,
        note: note.trim() || null,
      });
      onCreated(created);
      toast(S.customers.created, 'success');
      setName('');
      setPhone('');
      setNote('');
    } catch (err) {
      setNameError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={S.customers.addTitle} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <Field label={S.customers.name} value={name} onChange={setName} error={nameError} placeholder={S.customers.namePlaceholder} maxLength={80} />
        <Field label={S.customers.phone} value={phone} onChange={setPhone} inputMode="tel" maxLength={20} />
        <Field label={S.customers.note} value={note} onChange={setNote} placeholder={S.customers.notePlaceholder} maxLength={200} />
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

function CustomerProfileView({ id, onBack }: { id: string; onBack(): void }) {
  const { session, canSeeAdmin } = useSession();
  const toast = useToast();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState<'SETTLEMENT' | 'LOAN' | null>(null);
  const [range, setRange] = useState<'today' | 'month' | 'all'>('all');

  const begin = useLatestGuard();
  async function load() {
    const isCurrent = begin();
    setError(null);
    try {
      const next = await api.customer(id);
      if (isCurrent()) setProfile(next);
    } catch (err) {
      if (isCurrent()) setError(describeError(err));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useLiveRefresh(['customers', 'sales', 'purchases', 'customer_payments'], () => void load());

  async function remove(reason: string) {
    if (!session) return;
    try {
      await api.removeCustomer(id, reason, session.token);
      toast(S.customers.removed, 'success');
      onBack();
    } catch (err) {
      setError(describeError(err));
    }
  }

  // "What did he take this month?" is the question this answers.
  const since = (() => {
    const now = new Date();
    if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return 0;
  })();
  const shownLedger = (profile?.ledger ?? []).filter((r) => new Date(r.occurredAt).getTime() >= since);

  return (
    <div className="stack">
      <button type="button" className="btn btn--quiet btn--sm" onClick={onBack}>
        {S.customers.back}
      </button>

      {error && <p className="card form-error">{error}</p>}
      {!profile && !error && <p className="muted center">{S.common.loading}</p>}

      {profile && (
        <>
          <section className="card">
            <h3 className="card__title">{profile.name}</h3>
            {profile.phone && <p className="muted small">{profile.phone}</p>}
            {profile.note && <p className="muted small">{profile.note}</p>}
            <div className="balance-panel">
              <span className="balance-panel__label">{S.customers.balance}</span>
              <BalanceTag balance={profile.balance} />
            </div>
            {/* One column of labels, one of figures, in the order someone reads them
                out: what was traded, what is owed for goods, what was lent. */}
            <section className="summary">
              <h4 className="summary__title">{S.customers.business}</h4>
              <Row label={S.customers.salesTotal} value={profile.salesTotal} strong>
                {S.customers.ofWhichCash} {formatMoney(profile.salesCash)} · {S.customers.ofWhichCheque}{' '}
                {formatMoney(profile.salesCheque)} · {S.customers.ofWhichCredit} {formatMoney(profile.creditSales)}
              </Row>
              <Row label={S.customers.purchasesTotal} value={profile.purchasesTotal} strong>
                {S.customers.ofWhichCash} {formatMoney(profile.purchasesCash)} · {S.customers.ofWhichCheque}{' '}
                {formatMoney(profile.purchasesCheque)} · {S.customers.ofWhichCredit}{' '}
                {formatMoney(profile.creditPurchases)}
              </Row>

              <h4 className="summary__title">{S.customers.goodsCredit}</h4>
              <Row label={S.customers.creditSales} value={profile.creditSales} />
              <Row label={S.customers.creditPurchases} value={profile.creditPurchases} />
              <Row label={S.customers.received} value={profile.received} />
              <Row label={S.customers.paid} value={profile.paid} />

              <h4 className="summary__title">{S.customers.personalLoans}</h4>
              <Row label={S.customers.loanGiven} value={profile.loanGiven} />
              <Row label={S.customers.loanTaken} value={profile.loanTaken} />
            </section>

            <button type="button" className="btn btn--primary btn--block" onClick={() => setSettling('SETTLEMENT')}>
              {S.customers.settle}
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setSettling('LOAN')}>
              {S.customers.newLoan}
            </button>
            {canSeeAdmin && (
              <button
                type="button"
                className="btn btn--danger-quiet btn--block btn--sm"
                onClick={() => {
                  const reason = window.prompt(S.customers.removeHelp);
                  if (reason && reason.trim().length >= 3) void remove(reason.trim());
                }}
              >
                {S.customers.remove}
              </button>
            )}
          </section>

          <section className="card">
            <h3 className="card__title">{S.customers.ledger}</h3>
            <Segmented
              label={S.common.date}
              hideLabel
              options={[
                { value: 'today', label: S.customers.today },
                { value: 'month', label: S.customers.thisMonth },
                { value: 'all', label: S.customers.allTime },
              ]}
              value={range}
              onChange={setRange}
            />
            {profile.ledger.length === 0 && <p className="muted small">{S.customers.ledgerEmpty}</p>}
            {profile.ledger.length > 0 && shownLedger.length === 0 && (
              <p className="muted small">{S.customers.noneInPeriod}</p>
            )}
            <ul className="history history--plain">
              {shownLedger.map((row) => (
                <li key={`${row.kind}-${row.id}`} className="history__row">
                  <div className="history__main">
                    <span className="history__title">
                      {S.labels.ledgerKinds[row.kind]}
                      {row.kind === 'payment' || row.kind === 'loan'
                        ? ` · ${S.labels.directions[row.detail as PaymentDirection] ?? ''}`
                        : ` · ${detailName(row.detail)}`}
                    </span>
                    {/* "5 ලීටර් × 810.00" — the quantity is the first thing anyone
                        checks when a figure is questioned. */}
                    {row.quantity && (
                      <span className="history__meta history__qty">
                        {formatQty(row.quantity)}{' '}
                        {row.unitType === 'BOTTLE' && row.bottleSize
                          ? `${S.labels.bottleSizes[row.bottleSize]} ${S.labels.units.BOTTLE}`
                          : S.labels.units[row.unitType ?? 'KG']}
                        {row.unitPrice ? ` × ${formatMoney(row.unitPrice)}` : ''}
                      </span>
                    )}
                    <span className="history__meta">{formatStamp(row.occurredAt)}</span>
                    <span className="history__meta history__split">{splitOf(row)}</span>
                    {row.note && <span className="history__meta">{row.note}</span>}
                  </div>
                  <span
                    className={`history__amount ${row.kind === 'payment' || row.kind === 'loan' ? 'history__amount--payment' : ''}`}
                  >
                    {formatMoney(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <SettleDialog
            kind={settling}
            customerId={id}
            onClose={() => setSettling(null)}
            onSaved={() => {
              setSettling(null);
              void load();
            }}
          />
        </>
      )}
    </div>
  );
}

const DIRECTIONS = (['RECEIVED', 'PAID'] as const).map((d) => ({
  value: d,
  label: d === 'RECEIVED' ? S.customers.directionReceived : S.customers.directionPaid,
}));
const METHODS = (['CASH', 'CHEQUE'] as const).map((m) => ({ value: m, label: S.labels.payment[m] }));

function SettleDialog({
  kind,
  customerId,
  onClose,
  onSaved,
}: {
  /** null keeps it closed; otherwise which kind of money is being recorded. */
  kind: 'SETTLEMENT' | 'LOAN' | null;
  customerId: string;
  onClose(): void;
  onSaved(): void;
}) {
  const isLoan = kind === 'LOAN';
  const { save, busy, error, clearError } = useSubmit(
    'payment',
    isLoan ? S.customers.loanSaved : S.customers.paymentSaved,
  );
  const [direction, setDirection] = useState<PaymentDirection>('RECEIVED');

  // Settling usually means he is paying us; a loan usually means we are handing cash out.
  useEffect(() => {
    if (kind) setDirection(kind === 'LOAN' ? 'PAID' : 'RECEIVED');
  }, [kind]);
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [cheque, setCheque] = useState('');
  const [depositDate, setDepositDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    const next: Record<string, string> = {};
    const a = checkPositive(amount, 2);
    if (!a.ok) next.amount = a.reason === 'decimals' ? S.validation.tooManyDecimals : S.validation.amount;
    if (method === 'CHEQUE') {
      if (!cheque.trim()) next.cheque = S.validation.cheque;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(depositDate)) next.depositDate = S.validation.depositDate;
    }
    setErrors(next);
    if (!a.ok || Object.keys(next).length) return;

    const billNo = newBillNo();
    const saved = await save({
      clientId: uuid(),
      billNo,
      customerId,
      kind: kind ?? 'SETTLEMENT',
      direction,
      method,
      amount: a.value,
      chequeNumber: method === 'CHEQUE' ? cheque.trim() : null,
      chequeDepositDate: method === 'CHEQUE' ? depositDate : null,
      note: note.trim() || null,
    });
    if (saved) {
      void presentBill({
        billNo,
        customerId,
        items: [
          {
            side: 'out',
            name: isLoan
              ? direction === 'PAID'
                ? S.customers.loanGave
                : S.customers.loanTook
              : direction === 'RECEIVED'
                ? S.customers.directionReceived
                : S.customers.directionPaid,
            detail: note.trim(),
            amount: a.value,
          },
        ],
        inTotal: '0',
        outTotal: a.value,
        net: a.value,
        how: method === 'CASH' ? `${S.bill.byCash} ${formatMoney(a.value)}` : `${S.bill.byCheque} ${formatMoney(a.value)} (#${cheque.trim()})`,
        // Money in reduces what they owe; money out increases it.
        balanceEffect: direction === 'RECEIVED' ? -Number(a.value) : Number(a.value),
        kind: 'payment',
      });
      setAmount('');
      setCheque('');
      setNote('');
      onSaved();
    }
  }

  return (
    <Dialog open={kind !== null} title={isLoan ? S.customers.loanTitle : S.customers.settleTitle} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <p className="muted small">{isLoan ? S.customers.loanHelp : S.customers.settleHelp}</p>
        <Segmented
          label={isLoan ? S.customers.loanDirection : S.customers.direction}
          options={
            isLoan
              ? [
                  { value: 'PAID' as const, label: S.customers.loanGave },
                  { value: 'RECEIVED' as const, label: S.customers.loanTook },
                ]
              : DIRECTIONS
          }
          value={direction}
          onChange={setDirection}
        />
        <Segmented label={S.common.payment} options={METHODS} value={method} onChange={setMethod} />
        <NumberField label={S.customers.amount} value={amount} onChange={setAmount} error={errors.amount} prefix={S.common.rs} className="field--big" />
        {method === 'CHEQUE' && (
          <div className="field-row">
            <Field label={S.common.chequeNumber} value={cheque} onChange={setCheque} error={errors.cheque} maxLength={40} autoCapitalize="characters" />
            <Field label={S.common.depositDate} value={depositDate} onChange={setDepositDate} error={errors.depositDate} type="date" />
          </div>
        )}
        <Field label={S.customers.paymentNote} value={note} onChange={setNote} maxLength={200} />
        {error && <p className="form-error">{error}</p>}
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
