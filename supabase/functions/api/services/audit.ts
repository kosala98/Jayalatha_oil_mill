import type { Db } from '../db.ts';
import type { RequestContext } from '../lib/http.ts';
import { toJson } from '../lib/http.ts';
import type { AuditAction, AuditEntity } from '../lib/types.ts';

interface AuditInput {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  ctx: RequestContext;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Must be called with the same transaction as the change it records. */
export async function writeAudit(tx: Db, input: AuditInput): Promise<void> {
  const json = (v: unknown) => (v === undefined ? null : tx.json(toJson(v) as Parameters<typeof tx.json>[0]));
  await tx`
    INSERT INTO audit_logs (id, action, entity, entity_id, actor, device_id, ip, user_agent, before, after, reason)
    VALUES (
      gen_random_uuid(), ${input.action}, ${input.entity}, ${input.entityId}, ${input.ctx.actor},
      ${input.ctx.deviceId}, ${input.ctx.ip}, ${input.ctx.userAgent},
      ${json(input.before)}, ${json(input.after)}, ${input.reason ?? null}
    )`;
}
