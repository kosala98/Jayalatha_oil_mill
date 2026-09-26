import { type FormEvent, useEffect, useState } from 'react';
import { Field, NumberField } from '../components/Field';
import { PaymentFields } from '../components/PaymentFields';
import { Readout } from '../components/Readout';
import { Segmented } from '../components/Segmented';
import { BOTTLE_SIZES, OTHER_PRODUCT_CODE } from '../domain/catalog';
import { type PaymentErrors, type PaymentValue, emptyPayment, paymentPayload, splitParts, validatePayment } from '../domain/payment';
import type { BottleSize, SaleInput, UnitType } from '../domain/types';
import { containerPriceId, salePriceId } from '../domain/prices';
import { newBillNo, describePayment } from '../domain/bill';
import { presentBill } from '../lib/buildBill';
import { S } from '../i18n';
import { checkPositive, formatMoney, previewTotal } from '../lib/numbers';
import { useCustomers } from '../lib/useCustomers';
import { applyPrices, usePrices } from '../lib/usePrices';
import { useProducts } from '../lib/useProducts';
import { useSubmit } from '../lib/useSubmit';
import { BasketStrip } from '../components/BasketStrip';
import { useToast } from '../components/Toast';
import { addLine, basketNet, basketPayments, useBasket } from '../domain/basket';
import { goToTab } from '../lib/navigation';
import { uuid } from '../lib/ids';
import { api } from '../api/endpoints';

type Errors = Partial<Record<'quantity' | 'price' | 'bottleSize' | 'customName' | 'containerPrice', string>>;

const PRICE_LABEL: Record<UnitType, string> = {
  LITER: S.sale.pricePerLiter,
  KG: S.sale.pricePerKg,
  BOTTLE: S.sale.pricePerBottle,
};

export function SaleScreen() {
  const products = useProducts();
  const [productCode, setProductCode] = useState(products[0]?.code ?? '');
  const [unitType, setUnitType] = useState<UnitType>('LITER');
  const [bottleSize, setBottleSize] = useState<BottleSize>('ONE');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [customName, setCustomName] = useState('');
  const [containerCount, setContainerCount] = useState('');
  const [containerPrice, setContainerPrice] = useState('');
  const [payment, setPayment] = useState<PaymentValue>(emptyPayment);
  const [errors, setErrors] = useState<Errors>({});
  const [paymentErrors, setPaymentErrors] = useState<PaymentErrors | null>(null);
  const { customers, addLocal } = useCustomers();
  const { prices } = usePrices();
  const toast = useToast();
  // A price typed here is kept in the book unless the cashier says it is a one-off.
  const [keepPrice, setKeepPrice] = useState(true);
  // KG buyers often ask what that works out to per bottle and per litre.
  const [showConversion, setShowConversion] = useState(false);
  const { save, busy, error, clearError } = useSubmit('sale', S.sale.saved);

  const product = products.find((p) => p.code === productCode) ?? products[0];
  const priceId = product ? salePriceId(product.code, unitType, unitType === 'BOTTLE' ? bottleSize : null) : '';
  const bookPrice = prices[priceId] ?? '';
  const containerId = containerPriceId(unitType, bottleSize);
  const bookContainerPrice = prices[containerId] ?? '';
  const isCan = unitType === 'KG';

  // The empty container costs what the price book says, unless the counter overrides it.
  useEffect(() => {
    setContainerPrice(bookContainerPrice);
  }, [containerId, bookContainerPrice]);

  // Filling the day's price in saves the cashier typing it on every single sale.
  useEffect(() => {
    setPrice(bookPrice);
    setKeepPrice(true);
  }, [priceId, bookPrice]);

  // Charcoal is KG-only; snap the unit when the product can't be sold the current way.
  useEffect(() => {
    if (product && !product.allowedUnits.includes(unitType)) setUnitType(product.allowedUnits[0] ?? 'KG');
  }, [product, unitType]);

  const isBottle = unitType === 'BOTTLE';
  const isOther = product?.code === OTHER_PRODUCT_CODE;
  const goodsTotal = previewTotal(quantity, price);
  const containersTotal = previewTotal(containerCount, containerPrice);
  const total = previewTotal(
    '1',
    (Number(goodsTotal || 0) + Number(containersTotal || 0)).toFixed(2),
  );

  function validate(): SaleInput | null {
    const e: Errors = {};
    const q = checkPositive(quantity, isBottle ? 0 : 3);
    if (!q.ok) e.quantity = isBottle && q.reason === 'decimals' ? S.validation.wholeBottles : S.validation.quantity;
    const p = checkPositive(price, 2);
    if (!p.ok) e.price = p.reason === 'decimals' ? S.validation.tooManyDecimals : S.validation.price;
    if (isOther && customName.trim().length < 1) e.customName = S.validation.customName;
    // Someone typed a bottle count but no price for them.
    if (Number(containerCount || 0) > 0 && !checkPositive(containerPrice, 2).ok) {
      e.containerPrice = S.validation.price;
    }
    const pe = validatePayment(payment, total);
    setErrors(e);
    setPaymentErrors(pe);
    if (!q.ok || !p.ok || pe || Object.keys(e).length || !product) return null;
    return {
      productCode: product.code,
      unitType,
      bottleSize: isBottle ? bottleSize : null,
      customName: isOther ? customName.trim() : null,
      quantity: q.value,
      pricePerUnit: p.value,
      containerCount: Number(containerCount || 0),
      containerPrice: containerCount && Number(containerCount) > 0 ? (containerPrice || '0') : '0',
      billNo: newBillNo(),
      ...paymentPayload(payment, total),
    };
  }

  /** The other direction: he is taking oil, and there is copra still to weigh. */
  function addToVisit(thenGo: boolean) {
    const input = validate();
    if (!input || !product) return;
    addLine({
      id: uuid(),
      kind: 'sale',
      // Whatever was typed here is what gets recorded — the visit only groups the lines.
      cashAmount: input.cashAmount,
      chequeAmount: input.chequeAmount,
      creditAmount: input.creditAmount,
      chequeNumber: input.chequeNumber,
      chequeDepositDate: input.chequeDepositDate,
      customerId: input.customerId,
      productCode: product.code,
      label: input.customName ?? product.nameSi,
      unitType: input.unitType,
      bottleSize: input.bottleSize,
      customName: input.customName,
      quantity: input.quantity,
      price: input.pricePerUnit,
      containerCount: input.containerCount,
      containerPrice: input.containerPrice,
      total,
    });
    setQuantity('');
    setCustomName('');
    setContainerCount('');
    setPayment(emptyPayment());
    toast(S.basket.added, 'success');
    if (thenGo) goToTab('purchase');
  }

  const visitLines = useBasket();
  const formParts = splitParts(payment, total);
  const visitPaid = (() => {
    const base = basketPayments(visitLines);
    const sign = 1;
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
  const visitNet = Math.round((basketNet(visitLines) + Number(total || 0)) * 100) / 100;

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    clearError();
    const input = validate();
    if (!input) return;
    const parts = paymentPayload(payment, total);
    if (await save(input)) {
      // The customer walks away with this, so it is built from what was just recorded.
      const items = [
        {
          side: 'out' as const,
          name: input.customName ?? product?.nameSi ?? '',
          detail: `${input.quantity} ${
            input.unitType === 'BOTTLE' && input.bottleSize
              ? `${S.labels.bottleSizes[input.bottleSize]} ${S.labels.units.BOTTLE}`
              : S.labels.units[input.unitType]
          } × ${formatMoney(input.pricePerUnit)}`,
          amount: goodsTotal,
        },
        ...(Number(containerCount || 0) > 0
          ? [
              {
                side: 'out' as const,
                name: unitType === 'KG' ? S.sale.containerCountCan : S.sale.containerCountBottle,
                detail: `${containerCount} × ${formatMoney(containerPrice || '0')}`,
                amount: containersTotal,
              },
            ]
          : []),
      ];
      void presentBill({
        billNo: input.billNo!,
        customerId: input.customerId,
        items,
        inTotal: '0',
        outTotal: total,
        net: total,
        how: describePayment(parts, formatMoney),
        balanceEffect: Number(parts.creditAmount),
        kgPriceForConversion: showConversion && unitType === 'KG' ? price : null,
      });

      // Keep product, unit and price — the next customer usually buys the same thing.
      // A new price becomes the standing price, so the next sale is already filled in.
      const typed = checkPositive(price, 2);
      if (keepPrice && priceId && typed.ok && typed.value !== bookPrice) {
        void api
          .savePrices([{ id: priceId, amount: typed.value }])
          .then((r) => applyPrices(Object.fromEntries(r.prices.map((p) => [p.id, String(p.amount)]))))
          .catch(() => {
            /* offline: the sale is what matters, the price book can wait */
          });
      }
      setQuantity('');
      setCustomName('');
      setContainerCount('');
      setPayment(emptyPayment());
      setPaymentErrors(null);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <BasketStrip />
      <section className="card">
        <div className="field">
          <span className="field__label" id="product-label">
            {S.sale.product}
          </span>
          <div role="radiogroup" aria-labelledby="product-label" className="product-grid">
            {products.map((p) => (
              <button
                key={p.code}
                type="button"
                role="radio"
                aria-checked={p.code === product?.code}
                className={`product-chip ${p.isCharcoal ? 'product-chip--charcoal' : ''}`}
                onClick={() => setProductCode(p.code)}
              >
                {p.nameSi}
              </button>
            ))}
          </div>
        </div>

        {isOther && (
          <Field
            label={S.sale.otherName}
            value={customName}
            onChange={setCustomName}
            error={errors.customName}
            placeholder={S.sale.otherNamePlaceholder}
            maxLength={80}
          />
        )}

        {product && product.allowedUnits.length > 1 && (
          <Segmented
            label={S.sale.unit}
            options={product.allowedUnits.map((u) => ({ value: u, label: S.labels.units[u] }))}
            value={unitType}
            onChange={setUnitType}
          />
        )}

        {isBottle && (
          <Segmented
            label={S.sale.bottleSize}
            options={BOTTLE_SIZES.map((b) => ({ value: b, label: S.labels.bottleSizes[b] }))}
            value={bottleSize}
            onChange={setBottleSize}
          />
        )}

        <div className="field-row">
          <NumberField
            label={isBottle ? S.sale.quantityBottles : S.sale.quantity}
            value={quantity}
            onChange={setQuantity}
            error={errors.quantity}
            integer={isBottle}
            suffix={isBottle ? undefined : S.labels.units[unitType]}
          />
          <NumberField label={PRICE_LABEL[unitType]} value={price} onChange={setPrice} error={errors.price} />
        </div>
      </section>

      <details className="drawer" open={containerCount !== ''}>
        <summary className="drawer__summary">{S.sale.containers}</summary>
        <p className="muted small">{S.sale.containersHelp}</p>
        <div className="field-row">
          <NumberField
            integer
            label={isCan ? S.sale.containerCountCan : S.sale.containerCountBottle}
            value={containerCount}
            onChange={setContainerCount}
          />
          <NumberField
            label={isCan ? S.sale.containerPriceCan : S.sale.containerPriceBottle}
            value={containerPrice}
            onChange={setContainerPrice}
            error={errors.containerPrice}
            prefix={S.common.rs}
          />
        </div>
        {Number(containersTotal || 0) > 0 && (
          <p className="muted small">
            {S.sale.containerTotal}: {S.common.rs} {containersTotal}
          </p>
        )}
      </details>

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
        {unitType === 'KG' && (
          <label className="price-note">
            <input type="checkbox" checked={showConversion} onChange={(e) => setShowConversion(e.target.checked)} />
            {S.bill.conversionOnBill}
          </label>
        )}

        {price !== '' && price !== bookPrice && (
          <label className="price-note">
            <input type="checkbox" checked={keepPrice} onChange={(e) => setKeepPrice(e.target.checked)} />
            {S.prices.keepPrice}
          </label>
        )}

        <PaymentFields
          total={total}
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
            {S.basket.addPurchase}
          </button>
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? S.common.saving : S.sale.submit}
          </button>
        </>
      )}
    </form>
  );
}

