import { S } from '../i18n';
import { checkPositive, previewTotal } from '../lib/numbers';

/**
 * How one transaction was paid for. Any mix of the three is allowed, as long as the
 * parts add up to the total — Rs. 2,000 cash + Rs. 2,000 cheque + Rs. 6,000 on credit
 * for a Rs. 10,000 sale is an ordinary day at the mill.
 */
export type PaymentMode = 'CASH' | 'CHEQUE' | 'CREDIT' | 'SPLIT';

export interface PaymentValue {
  mode: PaymentMode;
  /** Only read in SPLIT mode; the single modes put the whole total in one part. */
  cashAmount: string;
  chequeAmount: string;
  creditAmount: string;
  chequeNumber: string;
  /** YYYY-MM-DD. Required whenever there is a cheque part. */
  chequeDepositDate: string;
  customerId: string | null;
}

export interface PaymentErrors {
  parts?: string;
  chequeNumber?: string;
  chequeDepositDate?: string;
  customerId?: string;
}

/** Today in Sri Lanka, as YYYY-MM-DD — the day a cheque is usually banked. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function emptyPayment(): PaymentValue {
  return {
    mode: 'CASH',
    cashAmount: '',
    chequeAmount: '',
    creditAmount: '',
    chequeNumber: '',
    chequeDepositDate: todayIso(),
    customerId: null,
  };
}

const money = (v: string) => {
  const parsed = checkPositive(v, 2);
  return parsed.ok ? parsed.value : '0';
};

/** The three amounts to send, given the mode and the transaction total. */
export function splitParts(v: PaymentValue, total: string): { cashAmount: string; chequeAmount: string; creditAmount: string } {
  const whole = total && total !== '0' ? total : '0';
  switch (v.mode) {
    case 'CASH':
      return { cashAmount: whole, chequeAmount: '0', creditAmount: '0' };
    case 'CHEQUE':
      return { cashAmount: '0', chequeAmount: whole, creditAmount: '0' };
    case 'CREDIT':
      return { cashAmount: '0', chequeAmount: '0', creditAmount: whole };
    default:
      return { cashAmount: money(v.cashAmount), chequeAmount: money(v.chequeAmount), creditAmount: money(v.creditAmount) };
  }
}

/** What is still unaccounted for in a split. Negative means the parts overshoot. */
export function remainder(v: PaymentValue, total: string): number {
  const parts = splitParts(v, total);
  return Number(total || 0) - (Number(parts.cashAmount) + Number(parts.chequeAmount) + Number(parts.creditAmount));
}

export function validatePayment(v: PaymentValue, total: string): PaymentErrors | null {
  const errors: PaymentErrors = {};
  const parts = splitParts(v, total);
  const hasCheque = Number(parts.chequeAmount) > 0;
  const hasCredit = Number(parts.creditAmount) > 0;

  if (v.mode === 'SPLIT' && Math.abs(remainder(v, total)) >= 0.005) {
    errors.parts = S.validation.partsMismatch;
  }
  if (hasCheque) {
    if (!v.chequeNumber.trim()) errors.chequeNumber = S.validation.cheque;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.chequeDepositDate)) errors.chequeDepositDate = S.validation.depositDate;
  }
  // A debt nobody owes is not a debt.
  if (hasCredit && !v.customerId) errors.customerId = S.validation.customer;
  return Object.keys(errors).length > 0 ? errors : null;
}

/** The payment fields the API expects. Cheque details are dropped without a cheque part. */
export function paymentPayload(v: PaymentValue, total: string) {
  const parts = splitParts(v, total);
  const hasCheque = Number(parts.chequeAmount) > 0;
  return {
    ...parts,
    chequeNumber: hasCheque ? v.chequeNumber.trim() : null,
    chequeDepositDate: hasCheque ? v.chequeDepositDate : null,
    customerId: v.customerId,
  };
}

export { previewTotal };
