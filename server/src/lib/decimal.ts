import Decimal from 'decimal.js';

// One configured Decimal for all money maths. Never use JS floats for money.
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

/** Accepts decimal.js values, Prisma.Decimal, strings, numbers, null (=0). */
export function toDec(value: unknown): Dec {
  if (value === null || value === undefined) return new Dec(0);
  if (typeof value === 'string' || typeof value === 'number') return new Dec(value);
  // Prisma.Decimal is a separate decimal.js copy — go through its string form.
  return new Dec(String(value));
}

/** total = round(quantity × price, 2), half-up. Mirrors the DB CHECK constraint. */
/** Empty bottles or cans sold with the oil: count × price, rounded like everything else. */
export function computeContainerTotal(count: number, price: unknown): Dec {
  return toDec(count).times(toDec(price)).toDecimalPlaces(2, Dec.ROUND_HALF_UP);
}

export function computeTotal(quantity: unknown, price: unknown): Dec {
  return toDec(quantity).times(toDec(price)).toDecimalPlaces(2, Dec.ROUND_HALF_UP);
}

export const money = (d: Dec): string => d.toFixed(2);
export const qty = (d: Dec): string => d.toFixed(3);
