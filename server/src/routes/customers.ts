import { Router } from 'express';
import { prisma } from '../db';
import { HttpError, notFound } from '../lib/errors';
import { contextFrom } from '../lib/http';
import {
  createCustomerPaymentSchema,
  createCustomerSchema,
  customerLedgerQuerySchema,
  customerListQuerySchema,
  deleteSchema,
  idParamSchema,
  updateCustomerSchema,
} from '../lib/validation';
import { requireAdmin, requireSession } from '../middleware/auth';
import { writeAudit } from '../services/audit';
import { balanceFor, balancesFor, requireLiveCustomer } from '../services/customers';
import { isUniqueViolation } from './helpers';

export const customersRouter = Router();

/**
 * The counter needs the customer list to record a credit sale and to answer
 * "how much do I owe?", so reads here are device-authenticated rather than
 * admin-only. Editing and deleting a customer still needs the admin.
 */

customersRouter.get('/', requireSession, async (req, res) => {
  const q = customerListQuerySchema.parse(req.query);
  const customers = await prisma.customer.findMany({
    where: {
      ...(q.includeDeleted ? {} : { isDeleted: false }),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}),
    },
    orderBy: [{ name: 'asc' }],
    take: q.limit,
  });
  const balances = await balancesFor(prisma, customers.map((c) => c.id));
  res.json(customers.map((c) => ({ ...c, ...balances.get(c.id) })));
});

customersRouter.post('/', requireSession, async (req, res) => {
  const input = createCustomerSchema.parse(req.body);
  const ctx = contextFrom(req);

  const existing = await prisma.customer.findUnique({ where: { clientId: input.clientId } });
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          clientId: input.clientId,
          name: input.name,
          phone: input.phone,
          note: input.note,
          installId: contextFrom(req).deviceId,
        },
      });
      await writeAudit(tx, { action: 'CREATE', entity: 'CUSTOMER', entityId: created.id, ctx, after: created });
      return created;
    });
    res.status(201).json(customer);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const bySameSend = await prisma.customer.findUnique({ where: { clientId: input.clientId } });
      if (bySameSend) {
        res.status(200).json(bySameSend);
        return;
      }
      // Two "Sunil" rows would split one ledger in two.
      throw new HttpError(409, 'CUSTOMER_EXISTS', 'A customer with this name already exists');
    }
    throw err;
  }
});

/** Profile: who they are, what they owe, and the transactions behind that number. */
customersRouter.get('/:id', requireSession, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const q = customerLedgerQuerySchema.parse(req.query);

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw notFound('Customer');

  const [balance, sales, purchases, payments] = await Promise.all([
    balanceFor(prisma, id),
    prisma.sale.findMany({
      where: { customerId: id, isDeleted: false },
      orderBy: { occurredAt: 'desc' },
      take: q.limit,
    }),
    prisma.purchase.findMany({
      where: { customerId: id, isDeleted: false },
      orderBy: { occurredAt: 'desc' },
      take: q.limit,
    }),
    prisma.customerPayment.findMany({
      where: { customerId: id, isDeleted: false },
      orderBy: { occurredAt: 'desc' },
      take: q.limit,
    }),
  ]);

  // One list in time order is how the customer thinks about it.
  const ledger = [
    ...sales.map((s) => ({
      kind: 'sale' as const,
      id: s.id,
      occurredAt: s.occurredAt,
      amount: s.total,
      cashAmount: s.cashAmount,
      chequeAmount: s.chequeAmount,
      creditAmount: s.creditAmount,
      chequeNumber: s.chequeNumber,
      detail: s.customName ?? s.productCode,
      // What actually left the mill, so the row can be read without opening anything.
      quantity: s.quantity,
      unitType: s.unitType,
      bottleSize: s.bottleSize,
      unitPrice: s.pricePerUnit,
    })),
    ...purchases.map((p) => ({
      kind: 'purchase' as const,
      id: p.id,
      occurredAt: p.occurredAt,
      amount: p.total,
      cashAmount: p.cashAmount,
      chequeAmount: p.chequeAmount,
      creditAmount: p.creditAmount,
      chequeNumber: p.chequeNumber,
      detail: p.customName ?? p.material,
      quantity: p.quantityKg,
      unitType: 'KG' as const,
      bottleSize: null,
      unitPrice: p.pricePerKg,
    })),
    ...payments.map((p) => ({
      kind: p.kind === 'LOAN' ? ('loan' as const) : ('payment' as const),
      id: p.id,
      occurredAt: p.occurredAt,
      amount: p.amount,
      cashAmount: p.method === 'CASH' ? p.amount : '0',
      chequeAmount: p.method === 'CHEQUE' ? p.amount : '0',
      creditAmount: '0',
      chequeNumber: p.chequeNumber,
      detail: p.direction,
      note: p.note,
    })),
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, q.limit);

  res.json({ ...customer, ...balance, ledger });
});

customersRouter.patch('/:id', requireAdmin, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const input = updateCustomerSchema.parse(req.body);
  const ctx = contextFrom(req);

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw notFound('Customer');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This customer is deleted');
    const after = await tx.customer.update({ where: { id }, data: input });
    await writeAudit(tx, { action: 'UPDATE', entity: 'CUSTOMER', entityId: id, ctx, before, after });
    return after;
  });

  res.json(updated);
});

/** Deleting hides the customer from the pickers. Refused while they still owe. */
customersRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = deleteSchema.parse(req.body ?? {});
  const ctx = contextFrom(req);

  const deleted = await prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw notFound('Customer');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This customer is already deleted');

    const balance = await balanceFor(tx, id);
    if (balance.balance !== '0.00') {
      throw new HttpError(409, 'CUSTOMER_HAS_BALANCE', 'Settle the balance before removing this customer', {
        balance: balance.balance,
      });
    }

    const after = await tx.customer.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deleteReason: reason },
    });
    await writeAudit(tx, { action: 'DELETE', entity: 'CUSTOMER', entityId: id, ctx, before, after, reason });
    return after;
  });

  res.json(deleted);
});

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------
export const customerPaymentsRouter = Router();

customerPaymentsRouter.post('/', requireSession, async (req, res) => {
  const input = createCustomerPaymentSchema.parse(req.body);
  const ctx = contextFrom(req);

  const existing = await prisma.customerPayment.findUnique({ where: { clientId: input.clientId } });
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      await requireLiveCustomer(tx, input.customerId);
      const created = await tx.customerPayment.create({
        data: {
          clientId: input.clientId,
          customerId: input.customerId,
          billNo: input.billNo,
          kind: input.kind,
          direction: input.direction,
          method: input.method,
          amount: input.amount,
          chequeNumber: input.chequeNumber,
          chequeDepositDate: input.chequeDepositDate,
          note: input.note,
          occurredAt: input.occurredAt,
          installId: contextFrom(req).deviceId,
        },
      });
      await writeAudit(tx, { action: 'CREATE', entity: 'CUSTOMER_PAYMENT', entityId: created.id, ctx, after: created });
      return created;
    });
    res.status(201).json(payment);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await prisma.customerPayment.findUnique({ where: { clientId: input.clientId } });
      if (winner) {
        res.status(200).json(winner);
        return;
      }
    }
    throw err;
  }
});

customerPaymentsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = idParamSchema.parse(req.params.id);
  const { reason } = deleteSchema.parse(req.body ?? {});
  const ctx = contextFrom(req);

  const deleted = await prisma.$transaction(async (tx) => {
    const before = await tx.customerPayment.findUnique({ where: { id } });
    if (!before) throw notFound('Payment');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This payment is already deleted');
    const after = await tx.customerPayment.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deleteReason: reason },
    });
    await writeAudit(tx, { action: 'DELETE', entity: 'CUSTOMER_PAYMENT', entityId: id, ctx, before, after, reason });
    return after;
  });

  res.json(deleted);
});
