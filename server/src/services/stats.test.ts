import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTotal } from '../lib/decimal';
import { summarise } from './statsSummary';

const noAllTime = {
  charcoalPurchasedKg: null,
  charcoalSoldKg: null,
  charcoalAdjustmentKg: null,
  creditSales: null,
  creditPurchases: null,
  receivedFromCustomers: null,
  paidToCustomers: null,
};

const base = {
  period: 'today' as const,
  from: new Date('2026-09-11T18:30:00Z'),
  now: new Date('2026-09-12T08:30:00Z'),
  charcoalCodes: new Set(['CHARCOAL']),
  payments: [],
  counts: { salesWithCheque: 1, salesWithCredit: 2, purchasesWithCheque: 1, purchasesWithCredit: 1 },
  allTime: noAllTime,
};

test('computeTotal rounds half-up to cents without float error', () => {
  assert.equal(computeTotal('0.1', '0.2').toFixed(2), '0.02');
  assert.equal(computeTotal('2.5', '650.50').toFixed(2), '1626.25');
  assert.equal(computeTotal('1.005', '1').toFixed(2), '1.01');
  assert.equal(computeTotal('3', '0.335').toFixed(2), '1.01');
});

test('cash balance = cash entries + cash sales − cash purchases; cheques excluded', () => {
  const s = summarise({
    ...base,
    sales: [
      { productCode: 'COCONUT_OIL', unitType: 'LITER', bottleSize: null, quantity: '10', cash: '6500.00', cheque: '0', credit: '0', total: '6500.00', count: 2 },
      { productCode: 'COCONUT_OIL', unitType: 'LITER', bottleSize: null, quantity: '100', cash: '0', cheque: '65000.00', credit: '0', total: '65000.00', count: 1 },
    ],
    purchases: [
      { material: 'COPRA', quantityKg: '50', cash: '4000.00', cheque: '0', credit: '0', total: '4000.00', count: 1 },
      { material: 'COPRA', quantityKg: '500', cash: '0', cheque: '40000.00', credit: '0', total: '40000.00', count: 1 },
    ],
    cash: [
      { type: 'OPENING_FLOAT', amount: '5000.00', count: 1 },
      { type: 'TOP_UP', amount: '1000.00', count: 1 },
    ],
  });
  assert.equal(s.cashBalance, '8500.00'); // 6000 + 6500 − 4000
  assert.equal(s.sales.total, '71500.00');
  assert.equal(s.sales.cheque, '65000.00');
  assert.equal(s.sales.chequeCount, 1);
  assert.equal(s.purchases.cheque, '40000.00');
  assert.equal(s.cash.entriesTotal, '6000.00');
});

test('liters include bottles; kg excludes charcoal; charcoal stock is all-time', () => {
  const s = summarise({
    ...base,
    sales: [
      { productCode: 'COCONUT_OIL', unitType: 'BOTTLE', bottleSize: 'QUARTER', quantity: '4', cash: '800.00', cheque: '0', credit: '0', total: '800.00', count: 1 },
      { productCode: 'RBD_OIL', unitType: 'BOTTLE', bottleSize: 'HALF', quantity: '3', cash: '900.00', cheque: '0', credit: '0', total: '900.00', count: 1 },
      { productCode: 'RBD_OIL', unitType: 'LITER', bottleSize: null, quantity: '2.5', cash: '1000.00', cheque: '0', credit: '0', total: '1000.00', count: 1 },
      { productCode: 'SUNFLOWER_OIL', unitType: 'KG', bottleSize: null, quantity: '7.250', cash: '3000.00', cheque: '0', credit: '0', total: '3000.00', count: 1 },
      { productCode: 'CHARCOAL', unitType: 'KG', bottleSize: null, quantity: '30', cash: '3000.00', cheque: '0', credit: '0', total: '3000.00', count: 1 },
    ],
    purchases: [],
    cash: [],
    allTime: { ...noAllTime, charcoalPurchasedKg: '1000', charcoalSoldKg: '420.5' },
  });
  assert.equal(s.litersSold, '5.000'); // 4×0.25 + 3×0.5 + 2.5
  assert.equal(s.kgSold, '7.250'); // charcoal's 30 KG not included
  assert.equal(s.charcoal.soldKg, '30.000');
  assert.equal(s.charcoal.stockKg, '579.500');
  const rbd = s.products.find((p) => p.productCode === 'RBD_OIL');
  assert.equal(rbd?.liters, '4.000');
  assert.equal(rbd?.bottles, '3');
});

test('empty period gives zeros, not nulls', () => {
  const s = summarise({ ...base, sales: [], purchases: [], cash: [] });
  assert.equal(s.cashBalance, '0.00');
  assert.equal(s.litersSold, '0.000');
  assert.equal(s.charcoal.stockKg, '0.000');
});

test('credit never touches the drawer, and expenses leave it', () => {
  const s = summarise({
    ...base,
    sales: [
      { productCode: 'COCONUT_OIL', unitType: 'LITER', bottleSize: null, quantity: '10', cash: '6500.00', cheque: '0', credit: '0', total: '6500.00', count: 1 },
      { productCode: 'COCONUT_OIL', unitType: 'LITER', bottleSize: null, quantity: '20', cash: '0', cheque: '0', credit: '13000.00', total: '13000.00', count: 2 },
    ],
    purchases: [{ material: 'COPRA', quantityKg: '100', cash: '0', cheque: '0', credit: '8000.00', total: '8000.00', count: 1 }],
    cash: [
      { type: 'OPENING_FLOAT', amount: '5000.00', count: 1 },
      { type: 'EXPENSE', amount: '750.00', count: 2 },
    ],
  });
  // 5000 opening − 750 expenses + 6500 cash sales. The 13000 credit is not money yet.
  assert.equal(s.cashBalance, '10750.00');
  assert.equal(s.cash.expenses, '750.00');
  assert.equal(s.cash.entriesTotal, '4250.00');
  assert.equal(s.sales.credit, '13000.00');
  assert.equal(s.sales.creditCount, 2);
  assert.equal(s.purchases.credit, '8000.00');
});

test('settling in cash moves the drawer, settling by cheque does not', () => {
  const s = summarise({
    ...base,
    sales: [],
    purchases: [],
    cash: [{ type: 'OPENING_FLOAT', amount: '1000.00', count: 1 }],
    payments: [
      { direction: 'RECEIVED', method: 'CASH', amount: '4000.00', count: 1 },
      { direction: 'RECEIVED', method: 'CHEQUE', amount: '9000.00', count: 1 },
      { direction: 'PAID', method: 'CASH', amount: '1500.00', count: 1 },
    ],
  });
  assert.equal(s.cash.customerReceived, '4000.00');
  assert.equal(s.cash.customerPaid, '1500.00');
  assert.equal(s.cashBalance, '3500.00'); // 1000 + 4000 − 1500; the cheque waits to clear
});

test('net receivable nets what customers owe against what the mill owes', () => {
  const s = summarise({
    ...base,
    sales: [],
    purchases: [],
    cash: [],
    allTime: {
      ...noAllTime,
      creditSales: '50000.00',
      receivedFromCustomers: '18000.00',
      creditPurchases: '12000.00',
      paidToCustomers: '2000.00',
    },
  });
  // (50000 − 18000) owed to us, (12000 − 2000) owed by us
  assert.equal(s.customers.netReceivable, '22000.00');
});

test('a charcoal correction moves the stock and "වෙනත්" stays out of the totals', () => {
  const s = summarise({
    ...base,
    sales: [
      { productCode: 'OTHER', unitType: 'KG', bottleSize: null, quantity: '25', cash: '1250.00', cheque: '0', credit: '0', total: '1250.00', count: 1 },
      { productCode: 'COCONUT_OIL', unitType: 'KG', bottleSize: null, quantity: '4', cash: '2600.00', cheque: '0', credit: '0', total: '2600.00', count: 1 },
    ],
    purchases: [],
    cash: [],
    allTime: { ...noAllTime, charcoalPurchasedKg: '500', charcoalSoldKg: '498.5', charcoalAdjustmentKg: '-1.5' },
  });
  assert.equal(s.charcoal.stockKg, '0.000'); // leftover 1.5 KG cleared to zero
  assert.equal(s.kgSold, '4.000'); // the 25 KG of "වෙනත්" is not mill output
  const other = s.products.find((p) => p.productCode === 'OTHER');
  assert.equal(other?.total, '1250.00'); // but it is still in the per-product breakdown
});

test('one transaction can be paid three ways at once', () => {
  const s = summarise({
    ...base,
    // Rs. 10,000 sale: 2,000 cash + 2,000 cheque + 6,000 on credit.
    sales: [
      {
        productCode: 'COCONUT_OIL',
        unitType: 'LITER',
        bottleSize: null,
        quantity: '15',
        cash: '2000.00',
        cheque: '2000.00',
        credit: '6000.00',
        total: '10000.00',
        count: 1,
      },
    ],
    purchases: [],
    cash: [{ type: 'OPENING_FLOAT', amount: '5000.00', count: 1 }],
  });
  assert.equal(s.sales.total, '10000.00');
  assert.equal(s.sales.cash, '2000.00');
  assert.equal(s.sales.cheque, '2000.00');
  assert.equal(s.sales.credit, '6000.00');
  // Only the cash part reaches the drawer.
  assert.equal(s.cashBalance, '7000.00');
});

test('empty bottles are part of the sale total and reported on their own', () => {
  const s = summarise({
    ...base,
    // 5 L at 810 = 4,050, plus 3 empty 1 L bottles at 20 = 60.
    sales: [
      {
        productCode: 'COCONUT_OIL',
        unitType: 'LITER',
        bottleSize: null,
        quantity: '5',
        cash: '4110.00',
        cheque: '0',
        credit: '0',
        containers: '60.00',
        total: '4110.00',
        count: 1,
      },
    ],
    purchases: [],
    cash: [],
  });
  assert.equal(s.sales.total, '4110.00');
  assert.equal(s.containerSales, '60.00');
  assert.equal(s.cashBalance, '4110.00');
  assert.equal(s.litersSold, '5.000'); // the bottles are not extra litres of oil
});
