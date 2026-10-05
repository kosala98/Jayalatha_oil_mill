import { z } from 'zod';
import { config } from '../config.ts';
import { HttpError } from './errors.ts';
import { OTHER_PRODUCT_CODE } from './catalog.ts';
import { Dec } from './decimal.ts';
import { periodSchema } from './period.ts';

/**
 * Positive decimal given as string or number, with bounded precision and magnitude.
 * Normalised to a plain string (e.g. "12.500") so no float ever reaches the maths.
 */
function positiveDecimal(label: string, maxDecimals: number, max: string) {
  const pattern = new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDecimals}})?$`);
  return z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => pattern.test(v), {
      message: `${label} must be a number with at most ${maxDecimals} decimal places`,
    })
    .refine((v) => pattern.test(v) && new Dec(v).gt(0), { message: `${label} must be greater than 0` })
    .refine((v) => pattern.test(v) && new Dec(v).lte(max), { message: `${label} must be at most ${max}` });
}

export const QTY_MAX = '1000000'; // 1,000 tonnes / 1,000,000 L / bottles
export const PRICE_MAX = '10000000'; // Rs. 10 million per unit
export const AMOUNT_MAX = '100000000'; // Rs. 100 million per cash entry

/** Same shape, but 0 is allowed — a counted stock of zero is the common case. */
function nonNegativeDecimal(label: string, maxDecimals: number, max: string) {
  const pattern = new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDecimals}})?$`);
  return z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => pattern.test(v), { message: `${label} must be a number with at most ${maxDecimals} decimal places` })
    .refine((v) => pattern.test(v) && new Dec(v).lte(max), { message: `${label} must be at most ${max}` });
}

const quantity = positiveDecimal('Quantity', 3, QTY_MAX);
const price = positiveDecimal('Price', 2, PRICE_MAX);

const optionalTrimmed = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));

/** When the transaction happened. Defaults to server time. Bounded to stop silly backdating. */
const occurredAt = z
  .string()
  .datetime({ offset: true })
  .optional()
  .transform((v, ctx) => {
    const now = Date.now();
    if (!v) return new Date(now);
    const t = new Date(v);
    if (t.getTime() > now + 5 * 60_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'occurredAt is in the future' });
      return z.NEVER;
    }
    if (t.getTime() < now - config.maxBackdateDays * 86_400_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `occurredAt is more than ${config.maxBackdateDays} days old`,
      });
      return z.NEVER;
    }
    return t;
  });

/** Calendar date, no time zone: the day the cheque may be banked. */
const depositDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Deposit date must be YYYY-MM-DD')
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (!v) return true;
    const t = Date.parse(`${v}T00:00:00Z`);
    if (Number.isNaN(t)) return false;
    const years = 3 * 365 * 86_400_000;
    return t > Date.now() - years && t < Date.now() + years;
  }, 'Deposit date is out of range');

/** Any part of a split may be zero, so these are amounts, not positive amounts. */
const part = nonNegativeDecimal('Amount', 2, AMOUNT_MAX).default('0');

/**
 * One transaction, up to three ways of paying for it. The parts must add up to the
 * total the server computes from quantity × price — never to a figure the client sends.
 */
const payment = {
  cashAmount: part,
  chequeAmount: part,
  creditAmount: part,
  chequeNumber: optionalTrimmed(40),
  chequeDepositDate: depositDate,
  /** Required as soon as any of it is on credit — a debt needs a debtor. */
  customerId: z.string().uuid().optional().nullable(),
};

interface PaymentParts {
  cashAmount: string;
  chequeAmount: string;
  creditAmount: string;
  chequeNumber: string | null;
  chequeDepositDate: string | null;
  customerId?: string | null;
}

function checkPayment(v: PaymentParts, ctx: z.RefinementCtx): void {
  const cheque = new Dec(v.chequeAmount);
  const credit = new Dec(v.creditAmount);
  const sum = new Dec(v.cashAmount).plus(cheque).plus(credit);

  if (sum.lte(0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cashAmount'], message: 'Enter how the transaction was paid' });
  }
  if (cheque.gt(0)) {
    if (!v.chequeNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chequeNumber'], message: 'Cheque number is required' });
    }
    if (!v.chequeDepositDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chequeDepositDate'], message: 'Deposit date is required' });
    }
  }
  if (credit.gt(0) && !v.customerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customerId'], message: 'A customer is required for a credit part' });
  }
}

/** Cheque-only fields are dropped when there is no cheque part. */
function chequeFields(v: PaymentParts) {
  const isCheque = new Dec(v.chequeAmount).gt(0);
  return {
    chequeNumber: isCheque ? v.chequeNumber : null,
    // Kept as 'YYYY-MM-DD' and cast to DATE in SQL, so no time zone can shift the day.
    chequeDepositDate: isCheque ? v.chequeDepositDate : null,
  };
}

/** The parts must match the total the server computed, to the cent. */
export function assertPartsMatchTotal(parts: { cashAmount: string; chequeAmount: string; creditAmount: string }, total: Dec): void {
  const sum = new Dec(parts.cashAmount).plus(parts.chequeAmount).plus(parts.creditAmount);
  if (!sum.equals(total)) {
    throw new HttpError(400, 'PAYMENT_PARTS_MISMATCH', 'The payment parts do not add up to the total', {
      total: total.toFixed(2),
      parts: sum.toFixed(2),
    });
  }
}

export const createSaleSchema = z
  .object({
    clientId: z.string().uuid(),
    productCode: z.string().min(1).max(64),
    unitType: z.enum(['LITER', 'KG', 'BOTTLE']),
    bottleSize: z.enum(['QUARTER', 'HALF', 'ONE']).optional().nullable(),
  /** Ties the rows of one counter visit to a single printed bill. */
  billNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, 'Malformed bill number').optional(),
    /** Required when productCode is OTHER ("වෙනත්"). */
    customName: optionalTrimmed(80),
    /** Empty bottles or cans sold with the oil, when the customer brought none. */
    containerCount: z.coerce.number().int().min(0).max(10_000).default(0),
    containerPrice: nonNegativeDecimal('Container price', 2, PRICE_MAX).default('0'),
    quantity,
    pricePerUnit: price,
    ...payment,
    occurredAt,
  })
  .superRefine((v, ctx) => {
    checkPayment(v, ctx);
    if (v.containerCount > 0 && new Dec(v.containerPrice).lte(0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['containerPrice'], message: 'Enter the price of one empty container' });
    }
    if (v.productCode === OTHER_PRODUCT_CODE && !v.customName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customName'], message: 'Item name is required for "other"' });
    }
    if (v.unitType === 'BOTTLE') {
      if (!v.bottleSize) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bottleSize'], message: 'Bottle size is required' });
      }
      // Part bottles are allowed (customers ask for 1.5 bottles); up to 3 decimals, like any quantity.
    }
  })
  .transform((v) => ({
    ...v,
    bottleSize: v.unitType === 'BOTTLE' ? v.bottleSize ?? null : null,
    customName: v.productCode === OTHER_PRODUCT_CODE ? v.customName : null,
    customerId: v.customerId ?? null,
    ...chequeFields(v),
  }));

export const createPurchaseSchema = z
  .object({
    clientId: z.string().uuid(),
    material: z.enum(['COPRA', 'CHARCOAL', 'OTHER']),
    customName: optionalTrimmed(80),
  /** Ties the rows of one counter visit to a single printed bill. */
  billNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, 'Malformed bill number').optional(),
    /** Scale reading. Omit when nothing is being deducted. */
    grossKg: nonNegativeDecimal('Gross weight', 3, QTY_MAX).optional(),
    deductions: z
      .array(
        z.object({
          kind: z.enum(['MOISTURE', 'SACK', 'SPOILED', 'DUST', 'OTHER']),
          kg: nonNegativeDecimal('Deduction', 3, QTY_MAX),
        }),
      )
      .max(6)
      .optional(),
    /** Net weight — what the price is applied to. */
    quantityKg: quantity,
    pricePerKg: price,
    ...payment,
    occurredAt,
  })
  .superRefine((v, ctx) => {
    checkPayment(v, ctx);
    // The net weight must be exactly what is left after the deductions, or the
    // figure on the receipt can't be explained to the person who brought the copra.
    const deductionKg = (v.deductions ?? []).reduce((acc, d) => acc.plus(new Dec(d.kg)), new Dec(0));
    if (v.grossKg === undefined && deductionKg.gt(0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['grossKg'], message: 'Enter the weight on the scale' });
    }
    if (v.grossKg !== undefined) {
      const net = new Dec(v.grossKg).minus(deductionKg);
      if (net.lte(0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deductions'], message: 'The deductions leave nothing to pay for' });
      } else if (!net.equals(new Dec(v.quantityKg))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantityKg'], message: 'Net weight must be gross minus the deductions' });
      }
    }
    if (v.material === 'OTHER' && !v.customName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customName'], message: 'Item name is required for "other"' });
    }
  })
  .transform((v) => ({
    ...v,
    grossKg: v.grossKg ?? null,
    deductions: v.deductions?.length ? v.deductions : null,
    deductionKg: (v.deductions ?? []).reduce((acc, d) => acc.plus(new Dec(d.kg)), new Dec(0)).toFixed(3),
    customName: v.material === 'OTHER' ? v.customName : null,
    customerId: v.customerId ?? null,
    ...chequeFields(v),
  }));

export const createCashEntrySchema = z
  .object({
    clientId: z.string().uuid(),
    type: z.enum(['OPENING_FLOAT', 'TOP_UP', 'EXPENSE']),
    amount: positiveDecimal('Amount', 2, AMOUNT_MAX),
    note: optionalTrimmed(200),
    occurredAt,
  })
  .superRefine((v, ctx) => {
    // An expense without a purpose is an unexplained hole in the drawer.
    if (v.type === 'EXPENSE' && (!v.note || v.note.length < 3)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Say what the expense was for (at least 3 characters)' });
    }
  });

// ---------- customers ----------

const customerName = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ' '))
  .pipe(z.string().min(2, 'A customer name is required').max(80));

export const createCustomerSchema = z.object({
  clientId: z.string().uuid(),
  name: customerName,
  phone: optionalTrimmed(20),
  note: optionalTrimmed(200),
});

export const updateCustomerSchema = z.object({
  name: customerName,
  phone: optionalTrimmed(20),
  note: optionalTrimmed(200),
});

export const createCustomerPaymentSchema = z
  .object({
    clientId: z.string().uuid(),
    customerId: z.string().uuid(),
  /** Ties the rows of one counter visit to a single printed bill. */
  billNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, 'Malformed bill number').optional(),
    /** SETTLEMENT: paying for goods taken. LOAN: cash lent either way. */
    kind: z.enum(['SETTLEMENT', 'LOAN']).default('SETTLEMENT'),
    direction: z.enum(['RECEIVED', 'PAID']),
    /** Settling a debt with more credit is not a payment. */
    method: z.enum(['CASH', 'CHEQUE']),
    amount: positiveDecimal('Amount', 2, AMOUNT_MAX),
    chequeNumber: optionalTrimmed(40),
    chequeDepositDate: depositDate,
    note: optionalTrimmed(200),
    occurredAt,
  })
  .superRefine((v, ctx) => {
    // A settlement is paid one way; only its cheque details need checking.
    if (v.method !== 'CHEQUE') return;
    if (!v.chequeNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chequeNumber'], message: 'Cheque number is required' });
    }
    if (!v.chequeDepositDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chequeDepositDate'], message: 'Deposit date is required' });
    }
  })
  .transform((v) => ({
    ...v,
    chequeNumber: v.method === 'CHEQUE' ? v.chequeNumber : null,
    chequeDepositDate: v.method === 'CHEQUE' ? v.chequeDepositDate : null,
  }));

export const customerListQuerySchema = z.object({
  q: optionalTrimmed(80),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  includeDeleted: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const customerLedgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------- cheques due for deposit ----------

export const chequeQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional(),
  })
  .transform((v) => ({
    from: new Date(`${v.from}T00:00:00.000Z`),
    // Inclusive of the whole "to" day.
    to: new Date(`${v.to ?? v.from}T00:00:00.000Z`),
  }));

// ---------- charcoal stock correction ----------

export const charcoalAdjustmentSchema = z.object({
  clientId: z.string().uuid(),
  /** What is actually in the store right now. 0 clears a leftover difference. */
  countedKg: nonNegativeDecimal('Counted stock', 3, QTY_MAX),
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required').max(300),
  occurredAt,
});

// ---------- temporary admin access ----------

export const grantAccessSchema = z.object({
  minutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(480, 'At most 8 hours'),
  reason: optionalTrimmed(200),
});

export const deleteSchema = z.object({
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required').max(300),
});

export const idParamSchema = z.string().uuid();

export const listQuerySchema = z.object({
  period: periodSchema.default('today'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().uuid().optional(),
  includeDeleted: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const statsQuerySchema = z.object({ period: periodSchema.default('today') });

/** Typed at sign-in; stored lower-case. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'Username must be 3 to 40 letters, digits, dots, dashes or underscores');

/** A PIN such as "1234" is a valid password; so is anything longer, up to 64 characters. */
export const passwordSchema = z.string().min(4, 'Password must be at least 4 characters').max(64);


// ---------- price book ----------

/** "sale:COCONUT_OIL:LITER", "sale:RBD_OIL:BOTTLE:HALF", "purchase:COPRA". */
const priceId = z
  .string()
  .trim()
  .regex(/^[a-z]+:[A-Z_]+(:[A-Z_]+){0,2}$/, 'Malformed price id')
  .max(80);

export const savePricesSchema = z.object({
  prices: z
    .array(z.object({ id: priceId, amount: positiveDecimal('Price', 2, PRICE_MAX) }))
    .min(1)
    .max(200),
});
