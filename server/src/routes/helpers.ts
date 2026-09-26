import { Prisma } from '@prisma/client';
import { config } from '../config';
import { periodStart } from '../lib/period';
import type { listQuerySchema } from '../lib/validation';
import type { z } from 'zod';

export type ListQuery = z.infer<typeof listQuerySchema>;

/** WHERE + ORDER + cursor pagination shared by the three history endpoints. */
export function listArgs(q: ListQuery) {
  const from = periodStart(q.period, config.businessUtcOffsetMinutes);
  return {
    where: {
      ...(q.includeDeleted ? {} : { isDeleted: false }),
      ...(from ? { occurredAt: { gte: from } } : {}),
    },
    orderBy: [{ occurredAt: 'desc' as const }, { id: 'desc' as const }],
    take: q.limit + 1, // one extra to know if there's another page
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  };
}

export function page<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
