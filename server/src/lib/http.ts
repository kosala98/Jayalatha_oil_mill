import type { Request } from 'express';
import type { ActorType } from '@prisma/client';

export interface RequestContext {
  actor: ActorType;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export function contextFrom(req: Request): RequestContext {
  // A verified paired device wins over the self-reported per-install id.
  const rawDevice = req.get('x-device-id');
  const deviceId = rawDevice && /^[0-9a-fA-F-]{36}$/.test(rawDevice) ? rawDevice : null;
  return {
    actor: req.auth?.role === 'ADMIN' ? 'ADMIN' : 'COUNTER',
    deviceId,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  };
}

/** Deleted/restored rows for audit: plain JSON (Decimals → strings, Dates → ISO). */
export function toJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}
