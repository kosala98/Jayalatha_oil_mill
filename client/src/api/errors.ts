import { S, t } from '../i18n';
import { ApiError } from './http';

/** Turn any thrown error into a Sinhala sentence for the cashier. */
export function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return S.common.notSaved;
  if (err.isNetwork) return S.errors.NETWORK;
  const details = (err.details ?? {}) as Record<string, unknown>;
  switch (err.code) {
    case 'INSUFFICIENT_CHARCOAL_STOCK':
      return t(S.errors.INSUFFICIENT_CHARCOAL_STOCK, { available: String(details.availableKg ?? '0') });
    case 'PIN_LOCKED':
      return t(S.errors.PIN_LOCKED, { minutes: Math.max(1, Math.ceil(Number(details.retryAfterSec ?? 900) / 60)) });
    case 'VALIDATION_ERROR':
    case 'WRONG_PIN':
    case 'WRONG_CREDENTIALS':
    case 'TOO_MANY_ATTEMPTS':
    case 'ALREADY_DELETED':
    case 'SESSION_REQUIRED':
    case 'ADMIN_REQUIRED':
    case 'PAYMENT_PARTS_MISMATCH':
      return S.errors[err.code];
    default:
      return t(S.errors.UNKNOWN, { code: err.code });
  }
}
