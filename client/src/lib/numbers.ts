/**
 * Client-side number handling. Inputs stay as strings end-to-end; the server is the
 * authority for totals. The preview total here uses BigInt fixed-point so the cashier
 * never sees float noise like 1626.2499999.
 */

export type NumCheck = { ok: true; value: string } | { ok: false; reason: 'empty' | 'invalid' | 'zero' | 'decimals' };

/** Accepts "12", "12.5", ".5", "1,250.00" (commas stripped). */
export function checkPositive(raw: string, maxDecimals: number): NumCheck {
  const s = raw.replace(/,/g, '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { ok: false, reason: 'invalid' };
  const [, frac = ''] = s.split('.');
  if (frac.length > maxDecimals) return { ok: false, reason: 'decimals' };
  const normalised = (s.startsWith('.') ? `0${s}` : s).replace(/\.$/, '');
  if (!/[1-9]/.test(normalised)) return { ok: false, reason: 'zero' };
  return { ok: true, value: normalised };
}

function toScaled(value: string, scale: number): bigint {
  const [i = '0', f = ''] = value.split('.');
  return BigInt(i || '0') * 10n ** BigInt(scale) + BigInt((f + '0'.repeat(scale)).slice(0, scale) || '0');
}

/**
 * Net weight from two scale readings, exact to the gram: total − empty container.
 * Null unless both are valid weights (up to 3 decimals) and the total is the heavier.
 */
export function netWeight(totalRaw: string, emptyRaw: string): string | null {
  const total = checkPositive(totalRaw, 3);
  const empty = checkPositive(emptyRaw, 3);
  if (!total.ok || !empty.ok) return null;
  const grams = toScaled(total.value, 3) - toScaled(empty.value, 3);
  if (grams <= 0n) return null;
  const whole = grams / 1000n;
  const frac = (grams % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** round(qty × price, 2) half-up — same rule as the server and the DB CHECK constraint. */
export function previewTotal(qtyRaw: string, priceRaw: string): string | null {
  const q = checkPositive(qtyRaw, 3);
  const p = checkPositive(priceRaw, 2);
  if (!q.ok || !p.ok) return null;
  const product = toScaled(q.value, 3) * toScaled(p.value, 2); // scale 5
  const cents = (product + 500n) / 1000n; // → scale 2, half-up
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

const qtyFmt = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/** "1234567.5" → "1,234,567.50". Display only. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0.00';
  const [i = '0', f = ''] = String(value).split('.');
  const neg = i.startsWith('-');
  const digits = neg ? i.slice(1) : i;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}.${(f + '00').slice(0, 2)}`;
}

export function formatQty(value: string | number): string {
  return qtyFmt.format(Number(value));
}

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false });

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

/**
 * Full stamp for a ledger row: the year matters once a debt has been carried for
 * months, and the time separates two deliveries on the same day.
 */
const stampDateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
export const formatStamp = (iso: string) => `${stampDateFmt.format(new Date(iso))} · ${timeFmt.format(new Date(iso))}`;
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
