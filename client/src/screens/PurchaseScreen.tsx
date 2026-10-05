import { type FormEvent, useEffect, useState } from 'react';
import { Field, NumberField } from '../components/Field';
import { PaymentFields } from '../components/PaymentFields';
import { Readout } from '../components/Readout';
import { Segmented } from '../components/Segmented';
import { type PaymentErrors, type PaymentValue, emptyPayment, paymentPayload, splitParts, validatePayment } from '../domain/payment';
import type { Deduction, DeductionKind, PurchaseInput, PurchaseMaterial } from '../domain/types';
import { purchasePriceId } from '../domain/prices';
import { newBillNo, describePayment } from '../domain/bill';
import { presentBill } from '../lib/buildBill';
import { S } from '../i18n';
import { checkPositive, formatMoney, previewTotal } from '../lib/numbers';
import { useCustomers } from '../lib/useCustomers';
import { applyPrices, usePrices } from '../lib/usePrices';
import { api } from '../api/endpoints';
import { useSubmit } from '../lib/useSubmit';
import { BasketStrip } from '../components/BasketStrip';
import { RecentEntries } from '../components/RecentEntries';
import { useToast } from '../components/Toast';
import { addLine, basketNet, basketPayments, useBasket } from '../domain/basket';
import { goToTab } from '../lib/navigation';
import { uuid } from '../lib/ids';

type Errors = Partial<Record<'customName' | 'quantity' | 'price', string>>;

const MATERIALS = (['COPRA', 'CHARCOAL', 'OTHER'] as const).map((m) => ({ value: m, label: S.labels.materials[m] }));

export function PurchaseScreen() {
  const [material, setMaterial] = useState<PurchaseMaterial>('COPRA');
  const [customName, setCustomName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [payment, setPayment] = useState<PaymentValue>(emptyPayment);
  const [errors, setErrors] = useState<Errors>({});
  const [paymentErrors, setPaymentErrors] = useState<PaymentErrors | null>(null);
  const { customers, addLocal } = useCustomers();
  const { prices } = usePrices();
  const toast = useToast();
  const [keepPrice, setKeepPrice] = useState(true);
  // Only the kinds actually used get typed in; the rest stay empty.
  const [deductions, setDeductions] = useState<Record<DeductionKind, string>>({
    MOISTURE: '',
    SACK: '',
    SPOILED: '',
    DUST: '',
    OTHER: '',
  });
  const priceId = purchasePriceId(material);
  const bookPrice = prices[priceId] ?? '';

  useEffect(() => {
    setPrice(bookPrice);
    setKeepPrice(true);
  }, [priceId, bookPrice]);
  const { save, busy, error, clearError } = useSubmit('purchase', S.purchase.saved);

  // With deductions in play the typed weight is the scale reading, and the price
  // applies to what is left after them.
  const deductionList: Deduction[] = (Object.entries(deductions) as [DeductionKind, string][])
    .filter(([, kg]) => Number(kg || 0) > 0)
    .map(([kind, kg]) => ({ kind, kg: String(Number(kg)) }));
  const deductedKg = deductionList.reduce((acc, d) => acc + Number(d.kg), 0);
  const usingDeductions = deductedKg > 0;
  const grossKg = Number(quantity || 0);
  const netKg = usingDeductions ? Math.round((grossKg - deductedKg) * 1000) / 1000 : grossKg;
  const total = previewTotal(netKg > 0 ? String(netKg) : '', price);

  function validate(): PurchaseInput | null {
    const e: Errors = {};
    if (material === 'OTHER' && !customName.trim()) e.customName = S.validation.customName;
    const q = checkPositive(quantity, 3);
    if (!q.ok) e.quantity = q.reason === 'decimals' ? S.validation.tooManyDecimals : S.validation.quantity;
    const p = checkPositive(price, 2);
    if (!p.ok) e.price = p.reason === 'decimals' ? S.validation.tooManyDecimals : S.validation.price;
    const pe = validatePayment(payment, total);
    setErrors(e);
    setPaymentErrors(pe);
    if (!q.ok || !p.ok || pe || Object.keys(e).length) return null;
    if (usingDeductions && netKg <= 0) {
      setErrors({ ...e, quantity: S.deductions.tooMuch });
      return null;
    }
    return {
      material,
      customName: material === 'OTHER' ? customName.trim() : null,
      billNo: newBillNo(),
      quantityKg: usingDeductions ? String(netKg) : q.value,
      grossKg: usingDeductions ? q.value : undefined,
      deductions: usingDeductions ? deductionList : undefined,
      pricePerKg: p.value,
      ...paymentPayload(payment, total),
    };
  }

  /**
   * "The copra is in, now he wants oil." Keeps this purchase aside as part of one
   * visit and moves to the sale screen, instead of saving it on its own and
   * settling the same customer twice.
   */
  function addToVisit(thenGo: boolean) {
    const input = validate();
    if (!input) return;
    addLine({
      id: uuid(),
      kind: 'purchase',
      // Whatever was typed here is what gets recorded — the visit only groups the lines.
      cashAmount: input.cashAmount,
      chequeAmount: input.chequeAmount,
      creditAmount: input.creditAmount,
      chequeNumber: input.chequeNumber,
      chequeDepositDate: input.chequeDepositDate,
      customerId: input.customerId,
      material: input.material,
      label: input.customName ?? S.labels.materials[input.material],
      customName: input.customName,
      grossKg: input.grossKg,
      deductions: input.deductions,
      quantityKg: input.quantityKg,
      price: input.pricePerKg,
      total: total ?? '0',
    });
    setQuantity('');
    setDeductions({ MOISTURE: '', SACK: '', SPOILED: '', DUST: '', OTHER: '' });
    setPayment(emptyPayment());
    toast(S.basket.added, 'success');
    if (thenGo) goToTab('sale');
  }

  const visitLines = useBasket();
  const formParts = splitParts(payment, total);
  const visitPaid = (() => {
    const base = basketPayments(visitLines);
    const sign = -1;
    return {
      cash: Math.round((base.cash + sign * Number(formParts.cashAmount || 0)) * 100) / 100,
      cheque: Math.round((base.cheque + sign * Number(formParts.chequeAmount || 0)) * 100) / 100,
      credit: Math.round((base.credit + sign * Number(formParts.creditAmount || 0)) * 100) / 100,
    };
  })();
  const breakdown = [
    {
      label: visitPaid.cash >= 0 ? S.combined.cashIn : S.combined.cashOut,
      amount: Math.abs(visitPaid.cash).toFixed(2),
      strong: true,
    },
    ...(visitPaid.cheque !== 0
      ? [{ label: visitPaid.cheque >= 0 ? S.combined.chequeIn : S.combined.chequeOut, amount: Math.abs(visitPaid.cheque).toFixed(2) }]
      : []),
    ...(visitPaid.credit !== 0
      ? [{ label: visitPaid.credit >= 0 ? S.combined.creditUp : S.combined.creditDown, amount: Math.abs(visitPaid.credit).toFixed(2) }]
      : []),
  ];
  const visitNet = Math.round((basketNet(visitLines) - Number(total || 0)) * 100) / 100;

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    clearError();
    const input = validate();
    if (!input) return;
    const parts = paymentPayload(payment, total);
    if (await save(input)) {
      void presentBill({
        billNo: input.billNo!,
        customerId: input.customerId,
        items: [
          {
            side: 'in' as const,
            name: input.customName ?? S.labels.materials[input.material],
            detail: usingDeductions
              ? `${S.deductions.gross} ${quantity} KG − ${S.deductions.totalDeducted} ${deductedKg} = ${netKg} KG × ${formatMoney(input.pricePerKg)}`
              : `${input.quantityKg} KG × ${formatMoney(input.pricePerKg)}`,
            amount: total ?? '0',
          },
        ],
        inTotal: total ?? '0',
        outTotal: '0',
        net: total ?? '0',
        how: describePayment(parts, formatMoney),
        // A credit purchase means the mill owes them, so the balance moves down.
        balanceEffect: -Number(parts.creditAmount),
      });

      const typed = checkPositive(price, 2);
      if (keepPrice && typed.ok && typed.value !== bookPrice) {
        void api
          .savePrices([{ id: priceId, amount: typed.value }])
          .then((r) => applyPrices(Object.fromEntries(r.prices.map((p) => [p.id, String(p.amount)]))))
          .catch(() => {
            /* offline: the purchase is what matters */
          });
      }
      setQuantity('');
      setDeductions({ MOISTURE: '', SACK: '', SPOILED: '', DUST: '', OTHER: '' });
      setPayment(emptyPayment());
      setPaymentErrors(null);
    }
  }

  return (
    <form className="stack entry" onSubmit={onSubmit} noValidate>
      <BasketStrip />
      <div className="entry__main stack">
        <section className="card">
          <Segmented label={S.purchase.item} options={MATERIALS} value={material} onChange={setMaterial} />
          {material === 'OTHER' && (
            <Field
              label={S.purchase.customName}
              placeholder={S.purchase.customNamePlaceholder}
              value={customName}
              onChange={setCustomName}
              error={errors.customName}
              maxLength={80}
            />
          )}
          <div className="field-row">
            <NumberField label={S.purchase.quantityKg} value={quantity} onChange={setQuantity} error={errors.quantity} suffix="KG" />
            <NumberField label={S.purchase.pricePerKg} value={price} onChange={setPrice} error={errors.price} />
          </div>
        </section>

        <details className="drawer" open={usingDeductions}>
          <summary className="drawer__summary">{S.deductions.title}</summary>
          <p className="muted small">{S.deductions.help}</p>
          <div className="split">
            {(['MOISTURE', 'SACK', 'SPOILED', 'DUST', 'OTHER'] as DeductionKind[]).map((kind) => (
              <NumberField
                key={kind}
                label={S.deductions.kinds[kind]}
                value={deductions[kind]}
                onChange={(v) => setDeductions((d) => ({ ...d, [kind]: v }))}
                suffix="KG"
              />
            ))}
          </div>
          {usingDeductions && (
            <p className={`split__remainder ${netKg > 0 ? 'is-balanced' : ''}`}>
              {S.deductions.totalDeducted}: {deductedKg} KG · {S.deductions.net}: {netKg > 0 ? netKg : 0} KG
            </p>
          )}
        </details>
      </div>

      <div className="entry__side stack">
        {/* Mid-visit the big figure is what is still owed either way, with the line
            being typed kept in view above it — including before it is added. */}
        {visitLines.length > 0 ? (
          <Readout
            label={visitNet === 0 ? S.combined.balanced : visitNet > 0 ? S.combined.customerPays : S.combined.weOwe}
            amount={Math.abs(visitNet).toFixed(2)}
            sub={{ label: S.common.total, amount: total || null }}
            breakdown={breakdown}
            note={S.basket.includesThisLine}
          />
        ) : (
          <Readout
            label={S.common.total}
            amount={total}
            breakdown={payment.mode === 'SPLIT' ? breakdown : undefined}
          />
        )}

        <section className="card">
          {price !== '' && price !== bookPrice && (
            <label className="price-note">
              <input type="checkbox" checked={keepPrice} onChange={(e) => setKeepPrice(e.target.checked)} />
              {S.prices.keepPrice}
            </label>
          )}

          <PaymentFields
            total={total ?? ''}
            value={payment}
            onChange={(next) => {
              setPayment(next);
              setPaymentErrors(null); // changing the method clears a complaint about the old one
            }}
            errors={paymentErrors}
            customers={customers}
            onCustomerCreated={addLocal}
          />
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {visitLines.length > 0 ? (
          // Mid-visit everything typed belongs to the visit; it is settled once, at the end.
          <button type="button" className="btn btn--primary btn--block btn--lg" onClick={() => addToVisit(false)}>
            {S.basket.addToVisit}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => addToVisit(true)}>
              {S.basket.addSale}
            </button>
            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
              {busy ? S.common.saving : S.purchase.submit}
            </button>
          </>
        )}
      </div>

      <RecentEntries kind="purchase" />
    </form>
  );
}

