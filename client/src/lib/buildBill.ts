import { api } from '../api/endpoints';
import type { BillData, BillItem } from '../domain/bill';
import { conversionFor, describePayment } from '../domain/bill';
import { showBill } from '../domain/billStore';
import { formatMoney } from './numbers';

/**
 * Turns what was just recorded into the receipt, and fills in the two debt lines by
 * asking the server where the customer stands now. "Before" is derived by undoing
 * this bill's own effect, so the two lines always explain each other.
 */
export async function presentBill(input: {
  billNo: string;
  customerId: string | null;
  items: BillItem[];
  inTotal: string;
  outTotal: string;
  net: string;
  how: string;
  /** How this bill moved the customer's balance: + they owe more, − they owe less. */
  balanceEffect: number;
  kgPriceForConversion?: string | null;
  kind?: 'trade' | 'payment';
}): Promise<void> {
  let customerName: string | null = null;
  let customerPhone: string | null = null;
  let debtAfter: string | null = null;
  let debtBefore: string | null = null;

  if (input.customerId) {
    try {
      const profile = await api.customer(input.customerId);
      customerName = profile.name;
      customerPhone = profile.phone;
      debtAfter = profile.balance;
      debtBefore = (Number(profile.balance) - input.balanceEffect).toFixed(2);
    } catch {
      // Offline, or the profile could not be read: print the bill without the debt box
      // rather than making the customer wait at the counter.
    }
  }

  showBill({
    billNo: input.billNo,
    at: new Date().toISOString(),
    customerName,
    customerPhone,
    items: input.items,
    inTotal: input.inTotal,
    outTotal: input.outTotal,
    net: input.net,
    how: input.how,
    debtBefore,
    debtAfter,
    conversion: input.kgPriceForConversion ? conversionFor(input.kgPriceForConversion) : null,
    kind: input.kind ?? 'trade',
  });
}

export { describePayment, formatMoney };
