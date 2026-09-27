import type { Context } from 'hono';
import { config } from '../config.ts';
import { HttpError } from './errors.ts';
import type { ActorType, PinRole } from './types.ts';

export interface Auth {
  userId: string;
  username: string;
  role: PinRole;
  expiresAt: number;
  temporary: boolean;
}

/** Hono context variables. `auth` is set by requireSession / requireAdmin / requireFullAdmin. */
export type AppEnv = { Variables: { auth?: Auth } };
export type Ctx = Context<AppEnv>;

export interface RequestContext {
  actor: ActorType;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** Client IP as seen by the Supabase edge: the first hop in X-Forwarded-For. */
export function clientIp(c: Ctx): string | null {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip') || null;
}

export function contextFrom(c: Ctx): RequestContext {
  // The self-reported per-install id; only a well-formed UUID is kept.
  const rawDevice = c.req.header('x-device-id');
  const deviceId = rawDevice && /^[0-9a-fA-F-]{36}$/.test(rawDevice) ? rawDevice : null;
  return {
    actor: c.get('auth')?.role === 'ADMIN' ? 'ADMIN' : 'COUNTER',
    deviceId,
    ip: clientIp(c),
    userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
  };
}

/** Deleted/restored rows for audit: plain JSON (Dates → ISO). */
export function toJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The request body as JSON, with the limits express.json() used to apply.
 * An empty body reads as undefined.
 */
export async function readJson(c: Ctx): Promise<unknown> {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > config.maxBodyBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}
