import type { AuditAction, AuditEntity, Prisma } from '@prisma/client';
import type { RequestContext } from '../lib/http';
import { toJson } from '../lib/http';

interface AuditInput {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  ctx: RequestContext;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Must be called with the same transaction client as the change it records. */
export async function writeAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      actor: input.ctx.actor,
      deviceId: input.ctx.deviceId,
      ip: input.ctx.ip,
      userAgent: input.ctx.userAgent,
      before: input.before === undefined ? undefined : (toJson(input.before) as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (toJson(input.after) as Prisma.InputJsonValue),
      reason: input.reason ?? null,
    },
  });
}
