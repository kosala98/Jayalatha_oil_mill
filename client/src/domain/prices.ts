import type { BottleSize, PurchaseMaterial, UnitType } from './types';

/**
 * Price ids are built, never stored by hand, so the sale screen and the price screen
 * can never disagree about what a row is called.
 */
export function salePriceId(productCode: string, unitType: UnitType, bottleSize?: BottleSize | null): string {
  return unitType === 'BOTTLE' && bottleSize
    ? `sale:${productCode}:BOTTLE:${bottleSize}`
    : `sale:${productCode}:${unitType}`;
}

export function purchasePriceId(material: PurchaseMaterial): string {
  return `purchase:${material}`;
}

export type PriceMap = Record<string, string>;

/**
 * Empty containers: a bottle of each size, and the can ("ගැලුම") for KG sales.
 * Same price book as everything else, so the counter sets them in one place.
 */
export function containerPriceId(unitType: UnitType, bottleSize?: BottleSize | null): string {
  if (unitType === 'KG') return 'container:CAN';
  return `container:BOTTLE:${unitType === 'BOTTLE' && bottleSize ? bottleSize : 'ONE'}`;
}

export const CONTAINER_PRICE_IDS = ['container:BOTTLE:QUARTER', 'container:BOTTLE:HALF', 'container:BOTTLE:ONE', 'container:CAN'] as const;
