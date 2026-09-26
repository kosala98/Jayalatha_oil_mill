import { S } from '../i18n';

/**
 * The receipt the customer walks away with. Built from what was just recorded, so it
 * never disagrees with the books, and identified by a number the mill can look up
 * again months later when someone comes back with the paper in hand.
 */
export interface BillItem {
  side: 'in' | 'out';
  name: string;
  /** "100 KG × 485.00", "6 බෝතල් × 420.00" — what the figure is made of. */
  detail: string;
  amount: string;
  /** How this line was paid, when each line was paid its own way. */
  how?: string;
}

export interface BillData {
  billNo: string;
  at: string;
  customerName: string | null;
  customerPhone: string | null;
  items: BillItem[];
  /** Total of what the customer brought in (purchases from them). */
  inTotal: string;
  /** Total of what they took away (sales to them). */
  outTotal: string;
  /** What changes hands now. Positive: the customer pays. Negative: the mill pays. */
  net: string;
  /** "මුදලින් 2,000.00 · චෙක්පත් 4,000.00 (#778899) · ණයට 2,450.00" */
  how: string;
  /** Balances before and after, shown only when the bill is tied to a customer. */
  debtBefore: string | null;
  debtAfter: string | null;
  /** Bottle and litre equivalents, printed when a KG buyer asked for them. */
  conversion: { kgPrice: string; bottle: string; liter: string } | null;
  /** A settlement receipt reads differently from a sale. */
  kind: 'trade' | 'payment';
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * B-YYMMDD-XXXX. The date makes it findable in a day's pile of paper; the random tail
 * keeps two devices from landing on the same number while offline.
 */
export function newBillNo(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .replace(/-/g, '');
  let tail = '';
  const random = crypto.getRandomValues(new Uint8Array(4));
  for (const byte of random) tail += ALPHABET[byte % ALPHABET.length];
  return `B-${parts}-${tail}`;
}

/** Oil sold by the kilo, priced per bottle and per litre, for buyers who ask. */
export const BOTTLE_PER_KG = 1.5;
export const LITER_PER_KG = 1.105;

export function conversionFor(kgPrice: string): { kgPrice: string; bottle: string; liter: string } {
  const kg = Number(kgPrice || 0);
  return {
    kgPrice: kg.toFixed(2),
    bottle: (kg / BOTTLE_PER_KG).toFixed(2),
    liter: (kg / LITER_PER_KG).toFixed(2),
  };
}

/** "මුදලින් 2,000.00 · චෙක්පත් 4,000.00 (#778899) · ණයට 2,450.00" */
export function describePayment(
  parts: { cashAmount: string; chequeAmount: string; creditAmount: string; chequeNumber?: string | null; chequeDepositDate?: string | null },
  formatMoney: (v: string) => string,
): string {
  // A visit where the mill paid out nets negative; the bill says so in words above,
  // so only the parts that actually moved are listed here.
  const bits: string[] = [];
  if (Math.abs(Number(parts.cashAmount)) > 0) bits.push(`${S.bill.byCash} ${formatMoney(Math.abs(Number(parts.cashAmount)).toFixed(2))}`);
  if (Math.abs(Number(parts.chequeAmount)) > 0) {
    const cheque = [parts.chequeNumber ? `#${parts.chequeNumber}` : null, parts.chequeDepositDate ? `${S.bill.bankOn} ${parts.chequeDepositDate}` : null]
      .filter(Boolean)
      .join(', ');
    bits.push(`${S.bill.byCheque} ${formatMoney(Math.abs(Number(parts.chequeAmount)).toFixed(2))}${cheque ? ` (${cheque})` : ''}`);
  }
  if (Math.abs(Number(parts.creditAmount)) > 0) bits.push(`${S.bill.onCredit} ${formatMoney(Math.abs(Number(parts.creditAmount)).toFixed(2))}`);
  return bits.join(' · ');
}
