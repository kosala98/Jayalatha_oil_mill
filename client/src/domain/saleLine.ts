import { S } from '../i18n';
import type { BottleSize, UnitType } from './types';

/**
 * "2 ලීටර්", or for bottles "2 බෝතල් (1 L)": the count reads as a count and the size
 * follows it, never "2 1 L බෝතල්". `quantity` is already formatted by the caller.
 */
export function saleQuantity(quantity: string, unitType: UnitType, bottleSize?: BottleSize | null): string {
  const unit = `${quantity} ${S.labels.units[unitType]}`;
  return unitType === 'BOTTLE' && bottleSize ? `${unit} (${S.labels.bottleSizes[bottleSize]})` : unit;
}
