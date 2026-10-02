import { type FormEvent, useState } from 'react';
import { describePayment, newBillNo } from '../domain/bill';
import { basketCustomerId, basketNet, basketPayments, clearBasket, removeLine, useBasket } from '../domain/basket';
import { useToast } from '../components/Toast';
import { S, t } from '../i18n';
import { uuid } from '../lib/ids';
import { formatMoney } from '../lib/numbers';
import { presentBill } from '../lib/buildBill';
import { useCustomers } from '../lib/useCustomers';
import { submit } from '../offline/outbox';

/**
 * The customer who arrives with copra and leaves with oil. Each line was already
 * priced and paid for on the screen where it was weighed, so this is where the visit
 * is read back, checked, and committed — one bill, one press.
 */
export function CombinedScreen({ onBack, onSaved }: { onBack?(): void; onSaved?(): void }) {
  const toast = useToast();
  const lines = useBasket();
  const { customers } = useCustomers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const salesTotal = lines.filter((l) => l.kind === 'sale').reduce((acc, l) => acc + Number(l.total), 0);
  const purchasesTotal = lines.filter((l) => l.kind === 'purchase').reduce((acc, l) => acc + Number(l.total), 0);
  const net = basketNet(lines);
  const paid = basketPayments(lines);
  const customerId = basketCustomerId(lines);
  const customer = customers.find((c) => c.id === customerId) ?? null;

  async function saveAll(e: FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return;
    setBusy(true);
    setError(null);
    const billNo = newBillNo();

    try {
      for (const line of lines) {
        const payment = {
          cashAmount: line.cashAmount,
          chequeAmount: line.chequeAmount,
          creditAmount: line.creditAmount,
          chequeNumber: line.chequeNumber,
          chequeDepositDate: line.chequeDepositDate,
          // The visit belongs to one customer, even when a line was typed before anyone
          // was picked (copra weighed, paid in cash) — otherwise that half never reaches
          // the customer's profile.
          customerId: line.customerId ?? customerId,
        };
        if (line.kind === 'sale') {
          await submit('sale', {
            clientId: uuid(),
            billNo,
            productCode: line.productCode,
            unitType: line.unitType,
            bottleSize: line.bottleSize,
            customName: line.customName,
            quantity: line.quantity,
            pricePerUnit: line.price,
            containerCount: line.containerCount,
            containerPrice: line.containerPrice,
            ...payment,
          });
        } else {
          await submit('purchase', {
            clientId: uuid(),
            billNo,
            material: line.material,
            customName: line.customName,
            grossKg: line.grossKg,
            deductions: line.deductions,
            quantityKg: line.quantityKg,
            pricePerKg: line.price,
            ...payment,
          });
        }
      }

      // One visit, one receipt: both halves and how each was paid.
      void presentBill({
        billNo,
        customerId,
        items: lines.map((line) => ({
          side: line.kind === 'sale' ? ('out' as const) : ('in' as const),
          name: line.label,
          detail:
            line.kind === 'sale'
              ? `${line.quantity} ${
                  line.unitType === 'BOTTLE' && line.bottleSize
                    ? `${S.labels.bottleSizes[line.bottleSize]} ${S.labels.units.BOTTLE}`
                    : S.labels.units[line.unitType]
                } × ${formatMoney(line.price)}`
              : `${line.quantityKg} KG × ${formatMoney(line.price)}`,
          amount: line.total,
          how: describePayment(line, formatMoney),
        })),
        inTotal: purchasesTotal.toFixed(2),
        outTotal: salesTotal.toFixed(2),
        net: net.toFixed(2),
        how: summarise(paid),
        balanceEffect: paid.credit,
      });

      toast(t(S.combined.saved, { n: lines.length }), 'success');
      clearBasket();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : S.common.notSaved);
    } finally {
      setBusy(false);
    }
  }

  /** "මුදලින් 60,000.00 · චෙක්පත් 30,000.00 · ණයට 5,905.00", netted across the visit. */
  function summarise(p: { cash: number; cheque: number; credit: number }): string {
    const bits: string[] = [];
    if (p.cash !== 0) bits.push(`${S.bill.byCash} ${formatMoney(Math.abs(p.cash).toFixed(2))}${p.cash < 0 ? ` (${S.combined.paidOut})` : ''}`);
    if (p.cheque !== 0) bits.push(`${S.bill.byCheque} ${formatMoney(Math.abs(p.cheque).toFixed(2))}${p.cheque < 0 ? ` (${S.combined.paidOut})` : ''}`);
    if (p.credit !== 0) bits.push(`${S.bill.onCredit} ${formatMoney(Math.abs(p.credit).toFixed(2))}`);
    return bits.join(' · ');
  }

  return (
    <form className="stack entry" onSubmit={saveAll} noValidate>
      {onBack && (
        <button type="button" className="btn btn--quiet btn--sm" onClick={onBack}>
          {S.customers.back}
        </button>
      )}

      <div className="entry__main stack">
        <section className="card">
          <h3 className="card__title">{S.combined.title}</h3>
          <p className="muted small">{S.combined.reviewHelp}</p>
          {customer && <p className="muted small">{t(S.combined.forCustomer, { name: customer.name })}</p>}
        </section>

        {lines.length === 0 && <p className="card empty">{S.combined.empty}</p>}

        {lines.length > 0 && (
          <ul className="card history history--plain">
            {lines.map((line) => (
              <li key={line.id} className="history__row">
                <div className="history__main">
                  <span className="history__title">
                    {line.kind === 'sale' ? S.combined.saleTag : S.combined.purchaseTag} · {line.label}
                  </span>
                  <span className="history__meta">
                    {line.kind === 'sale'
                      ? `${line.quantity} ${S.labels.units[line.unitType]} × ${formatMoney(line.price)}`
                      : `${line.quantityKg} KG × ${formatMoney(line.price)}`}
                  </span>
                  {/* How this line was paid, exactly as it was typed. */}
                  <span className="history__meta history__split">{describePayment(line, formatMoney)}</span>
                </div>
                <div className="history__side history__side--stack">
                  <span className="history__amount">{formatMoney(line.total)}</span>
                  <button type="button" className="btn btn--danger-quiet btn--sm" onClick={() => removeLine(line.id)}>
                    {S.combined.removeLine}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="entry__side stack">
        {lines.length > 0 && (
          <>
            <section className="card summary">
              <h4 className="summary__title">{S.combined.totals}</h4>
              <Row label={S.combined.salesTotal} value={salesTotal.toFixed(2)} />
              <Row label={S.combined.purchasesTotal} value={purchasesTotal.toFixed(2)} />

              <h4 className="summary__title">{S.combined.paymentSummary}</h4>
              <Row label={paid.cash >= 0 ? S.combined.cashIn : S.combined.cashOut} value={Math.abs(paid.cash).toFixed(2)} strong />
              {paid.cheque !== 0 && (
                <Row label={paid.cheque >= 0 ? S.combined.chequeIn : S.combined.chequeOut} value={Math.abs(paid.cheque).toFixed(2)} />
              )}
              {paid.credit !== 0 && (
                <Row label={paid.credit >= 0 ? S.combined.creditUp : S.combined.creditDown} value={Math.abs(paid.credit).toFixed(2)} />
              )}
            </section>

            {error && <p className="card form-error">{error}</p>}
            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
              {busy ? S.common.saving : S.combined.submit}
            </button>
            <button
              type="button"
              className="btn btn--danger-quiet btn--block btn--sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm(S.basket.discardConfirm)) {
                  clearBasket();
                  onBack?.();
                }
              }}
            >
              {S.basket.discard}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`summary__row ${strong ? 'summary__row--strong' : ''}`}>
      <span className="summary__label">{label}</span>
      <span className="summary__value">{formatMoney(value)}</span>
    </div>
  );
}
