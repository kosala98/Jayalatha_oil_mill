import { useState } from 'react';
import { type PaymentErrors, type PaymentMode, type PaymentValue, remainder, splitParts } from '../domain/payment';
import type { Customer } from '../domain/types';
import { S, t } from '../i18n';
import { formatMoney } from '../lib/numbers';
import { CustomerPicker } from './CustomerPicker';
import { Field, NumberField } from './Field';
import { Segmented } from './Segmented';

interface Props {
  value: PaymentValue;
  onChange(next: PaymentValue): void;
  errors?: PaymentErrors | null;
  /** The transaction total, so a single-mode choice can take all of it. */
  total: string;
  customers: Customer[];
  onCustomerCreated(c: Customer): void;
}

const MODES = [
  { value: 'CASH', label: S.labels.payment.CASH },
  { value: 'CHEQUE', label: S.labels.payment.CHEQUE },
  { value: 'CREDIT', label: S.labels.payment.CREDIT },
  { value: 'SPLIT', label: S.common.splitPayment },
] as const;

/**
 * Payment method, plus whatever that method needs. The first three modes put the
 * whole total in one place; බෙදා-ගෙවීම opens three boxes with a running remainder,
 * so the cashier can see at a glance what is still unaccounted for.
 */
export function PaymentFields({ value, onChange, errors, total, customers, onCustomerCreated }: Props) {
  const [showCustomer, setShowCustomer] = useState(false);
  const set = (patch: Partial<PaymentValue>) => onChange({ ...value, ...patch });

  const parts = splitParts(value, total);
  const hasCheque = Number(parts.chequeAmount) > 0;
  const hasCredit = Number(parts.creditAmount) > 0;
  const left = remainder(value, total);
  // Credit needs a customer: show the picker as soon as ණය is chosen, even before a
  // quantity (and so a total) has been typed.
  const customerVisible = hasCredit || value.mode === 'CREDIT' || showCustomer || value.customerId !== null;

  return (
    <>
      <Segmented
        label={S.common.payment}
        options={MODES}
        value={value.mode}
        onChange={(m: PaymentMode) => set({ mode: m })}
      />

      {value.mode === 'SPLIT' && (
        <div className="split">
          <NumberField
            label={S.labels.payment.CASH}
            value={value.cashAmount}
            onChange={(v) => set({ cashAmount: v })}
            prefix={S.common.rs}
          />
          <NumberField
            label={S.labels.payment.CHEQUE}
            value={value.chequeAmount}
            onChange={(v) => set({ chequeAmount: v })}
            prefix={S.common.rs}
          />
          <NumberField
            label={S.labels.payment.CREDIT}
            value={value.creditAmount}
            onChange={(v) => set({ creditAmount: v })}
            prefix={S.common.rs}
          />
          <p className={`split__remainder ${Math.abs(left) < 0.005 ? 'is-balanced' : ''}`}>
            {Math.abs(left) < 0.005
              ? S.common.splitBalanced
              : left > 0
                ? t(S.common.splitLeft, { amount: formatMoney(left.toFixed(2)) })
                : t(S.common.splitOver, { amount: formatMoney(Math.abs(left).toFixed(2)) })}
          </p>
          {errors?.parts && <p className="field__error">{errors.parts}</p>}
        </div>
      )}

      {hasCheque && (
        <div className="field-row">
          <Field
            label={S.common.chequeNumber}
            value={value.chequeNumber}
            onChange={(v) => set({ chequeNumber: v })}
            error={errors?.chequeNumber}
            maxLength={40}
            autoCapitalize="characters"
          />
          <Field
            label={S.common.depositDate}
            value={value.chequeDepositDate}
            onChange={(v) => set({ chequeDepositDate: v })}
            error={errors?.chequeDepositDate}
            type="date"
          />
        </div>
      )}

      {customerVisible ? (
        <CustomerPicker
          customers={customers}
          value={value.customerId}
          onChange={(id) => set({ customerId: id })}
          onCreated={onCustomerCreated}
          error={errors?.customerId}
          required={hasCredit}
        />
      ) : (
        <button type="button" className="btn btn--quiet btn--block btn--sm" onClick={() => setShowCustomer(true)}>
          {S.common.customerPick}
        </button>
      )}
    </>
  );
}
