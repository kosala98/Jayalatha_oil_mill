import { Hono } from 'hono';
import { cols, isUniqueViolation, type Row, transaction } from '../db.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { type AppEnv, contextFrom, readJson } from '../lib/http.ts';
import { createCashEntrySchema, deleteSchema, idParamSchema, listQuerySchema } from '../lib/validation.ts';
import { requireAdmin, requireSession } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { findByClientId, listRows } from './helpers.ts';

export const cashEntriesRouter = new Hono<AppEnv>();

cashEntriesRouter.post('/', requireSession, async (c) => {
  const input = createCashEntrySchema.parse(await readJson(c));
  const ctx = contextFrom(c);

  const existing = await findByClientId('cash_entries', input.clientId);
  if (existing) return c.json(existing, 200);

  try {
    const entry = await transaction(async (tx) => {
      const [created] = await tx<Row[]>`
        INSERT INTO cash_entries (id, client_id, type, amount, note, occurred_at, device_id)
        VALUES (gen_random_uuid(), ${input.clientId}, ${input.type}, ${input.amount}, ${input.note},
                ${input.occurredAt}, ${ctx.deviceId})
        RETURNING ${cols(tx, 'cash_entries')}`;
      await writeAudit(tx, { action: 'CREATE', entity: 'CASH_ENTRY', entityId: created!.id, ctx, after: created });
      return created!;
    });
    return c.json(entry, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findByClientId('cash_entries', input.clientId);
      if (winner) return c.json(winner, 200);
    }
    throw err;
  }
});

cashEntriesRouter.get('/', requireAdmin, async (c) => {
  const q = listQuerySchema.parse(c.req.query());
  return c.json(await listRows('cash_entries', q));
});

cashEntriesRouter.delete('/:id', requireAdmin, async (c) => {
  const id = idParamSchema.parse(c.req.param('id'));
  const { reason } = deleteSchema.parse((await readJson(c)) ?? {});
  const ctx = contextFrom(c);

  const deleted = await transaction(async (tx) => {
    const [before] = await tx<Row[]>`SELECT ${cols(tx, 'cash_entries')} FROM cash_entries WHERE id = ${id}`;
    if (!before) throw notFound('Cash entry');
    if (before.isDeleted) throw new HttpError(409, 'ALREADY_DELETED', 'This cash entry is already deleted');

    const [after] = await tx<Row[]>`
      UPDATE cash_entries SET is_deleted = true, deleted_at = now(), delete_reason = ${reason}
      WHERE id = ${id} AND is_deleted = false
      RETURNING ${cols(tx, 'cash_entries')}`;
    if (!after) throw new HttpError(409, 'ALREADY_DELETED', 'This cash entry is already deleted');

    await writeAudit(tx, { action: 'DELETE', entity: 'CASH_ENTRY', entityId: id, ctx, before, after, reason });
    return after;
  });
  return c.json(deleted);
});
