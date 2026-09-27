export type UnitType = 'LITER' | 'KG' | 'BOTTLE';
export type BottleSize = 'QUARTER' | 'HALF' | 'ONE';
export type PaymentMethod = 'CASH' | 'CHEQUE' | 'CREDIT';
/** Settling a debt is only ever cash or cheque. */
export type SettlementMethod = 'CASH' | 'CHEQUE';
export type PaymentDirection = 'RECEIVED' | 'PAID';
export type PurchaseMaterial = 'COPRA' | 'CHARCOAL' | 'OTHER';
export type CashEntryType = 'OPENING_FLOAT' | 'TOP_UP' | 'EXPENSE';
export type Period = 'today' | 'week' | 'month' | 'year' | 'all';

export interface Product {
  code: string;
  nameSi: string;
  nameEn: string;
  isCharcoal: boolean;
  allowedUnits: UnitType[];
  sortOrder: number;
}

interface SoftDeletable {
  id: string;
  clientId: string;
  occurredAt: string;
  createdAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
  deleteReason: string | null;
}

/** Decimal fields arrive as strings from the API — never parsed into floats for maths. */
export interface Sale extends SoftDeletable {
  productCode: string;
  unitType: UnitType;
  bottleSize: BottleSize | null;
  quantity: string;
  pricePerUnit: string;
  customName: string | null;
  /** Empty bottles or cans sold with the oil. */
  containerCount: number;
  containerPrice: string;
  containerTotal: string;
  total: string;
  /** One transaction, up to three ways of paying for it. They add up to total. */
  cashAmount: string;
  chequeAmount: string;
  creditAmount: string;
  chequeNumber: string | null;
  chequeDepositDate: string | null;
  customerId: string | null;
}

export type DeductionKind = 'MOISTURE' | 'SACK' | 'SPOILED' | 'DUST' | 'OTHER';
export interface Deduction {
  kind: DeductionKind;
  kg: string;
}

export interface Purchase extends SoftDeletable {
  material: PurchaseMaterial;
  customName: string | null;
  /** Scale reading before deductions; null when nothing was deducted. */
  grossKg: string | null;
  deductionKg: string;
  deductions: Deduction[] | null;
  /** Net weight — what the price was applied to. */
  quantityKg: string;
  pricePerKg: string;
  total: string;
  cashAmount: string;
  chequeAmount: string;
  creditAmount: string;
  chequeNumber: string | null;
  chequeDepositDate: string | null;
  customerId: string | null;
}

export interface CashEntry extends SoftDeletable {
  type: CashEntryType;
  amount: string;
  note: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Stats {
  period: Period;
  from: string | null;
  generatedAt: string;
  cashBalance: string;
  cash: {
    openingFloat: string;
    topUps: string;
    expenses: string;
    entriesTotal: string;
    cashSales: string;
    cashPurchases: string;
    customerReceived: string;
    customerPaid: string;
  };
  sales: { total: string; cash: string; cheque: string; credit: string; count: number; chequeCount: number; creditCount: number };
  purchases: {
    total: string;
    cash: string;
    cheque: string;
    credit: string;
    count: number;
    chequeCount: number;
    creditCount: number;
    byMaterial: { material: PurchaseMaterial; quantityKg: string; total: string; count: number }[];
  };
  litersSold: string;
  kgSold: string;
  charcoal: { soldKg: string; purchasedKg: string; adjustmentKg: string; stockKg: string };
  customers: { creditSales: string; creditPurchases: string; received: string; paid: string; netReceivable: string };
  products: { productCode: string; liters: string; kg: string; bottles: string; total: string; count: number }[];
}

// ---- Create payloads (clientId + occurredAt are added by the outbox) ----
/** How a sale or purchase is paid: the three parts always add up to its total. */
export interface PaymentParts {
  cashAmount: string;
  chequeAmount: string;
  creditAmount: string;
  chequeNumber: string | null;
  chequeDepositDate: string | null;
  customerId: string | null;
}
export interface SaleInput extends PaymentParts {
  /** Ties this row to the printed receipt. */
  billNo?: string;
  productCode: string;
  unitType: UnitType;
  bottleSize: BottleSize | null;
  /** Required for the "වෙනත්" product, null otherwise. */
  customName: string | null;
  quantity: string;
  pricePerUnit: string;
  /** Empty bottles or cans sold with the oil. */
  containerCount: number;
  containerPrice: string;
}
export interface PurchaseInput extends PaymentParts {
  billNo?: string;
  material: PurchaseMaterial;
  customName: string | null;
  /** Scale reading, sent only when weight was deducted. */
  grossKg?: string;
  deductions?: Deduction[];
  /** Net weight: what the price applies to. */
  quantityKg: string;
  pricePerKg: string;
}
export interface CashEntryInput {
  type: CashEntryType;
  amount: string;
  note: string | null;
}


/** A daily customer who buys or sells on credit and settles later. */
export interface Customer {
  id: string;
  clientId: string;
  name: string;
  phone: string | null;
  note: string | null;
  createdAt: string;
  isDeleted: boolean;
  /** Positive: they owe the mill. Negative: the mill owes them. */
  balance: string;
  /** Business done with them, whatever way it was paid for. */
  salesTotal: string;
  salesCash: string;
  salesCheque: string;
  purchasesTotal: string;
  purchasesCash: string;
  purchasesCheque: string;
  creditSales: string;
  creditPurchases: string;
  received: string;
  paid: string;
  /** Cash we lent him — he owes it back. */
  loanGiven: string;
  /** Cash he lent us — we owe it back. */
  loanTaken: string;
}

export type PaymentKind = 'SETTLEMENT' | 'LOAN';

export interface LedgerEntry {
  kind: 'sale' | 'purchase' | 'payment' | 'loan';
  id: string;
  occurredAt: string;
  amount: string;
  /** How that amount was settled — a row can be part cash, part cheque, part credit. */
  cashAmount: string;
  chequeAmount: string;
  creditAmount: string;
  chequeNumber: string | null;
  /** Product code, material, or the direction of a settlement. */
  detail: string;
  /** What was weighed or measured — absent on payments and loans. */
  quantity?: string;
  unitType?: UnitType;
  bottleSize?: BottleSize | null;
  unitPrice?: string;
  note?: string | null;
}

export interface CustomerProfile extends Customer {
  ledger: LedgerEntry[];
}

export interface ChequeItem {
  id: string;
  kind: 'sale' | 'purchase' | 'payment';
  direction: 'IN' | 'OUT';
  chequeNumber: string | null;
  depositDate: string | null;
  amount: string;
  occurredAt: string;
  detail: string;
  customer: { id: string; name: string } | null;
}

export interface ChequeDay {
  from: string;
  to: string;
  incomingTotal: string;
  outgoingTotal: string;
  items: ChequeItem[];
}

export interface TemporaryAccess {
  id: string;
  deviceId: string;
  expiresAt: string;
  reason: string | null;
}
