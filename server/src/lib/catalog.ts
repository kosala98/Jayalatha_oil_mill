import type { BottleSize, UnitType } from '@prisma/client';
import { Dec } from './decimal';

/** Liters in one bottle of each size — used to convert bottle sales into liters sold. */
export const BOTTLE_LITERS: Record<BottleSize, Dec> = {
  QUARTER: new Dec('0.25'),
  HALF: new Dec('0.5'),
  ONE: new Dec('1'),
};

export interface CatalogProduct {
  code: string;
  nameSi: string;
  nameEn: string;
  isCharcoal: boolean;
  allowedUnits: UnitType[];
  sortOrder: number;
}

const OIL_UNITS: UnitType[] = ['LITER', 'KG', 'BOTTLE'];

/** Free-text sale line. Needs its own name, and stays out of the litre/KG totals. */
export const OTHER_PRODUCT_CODE = 'OTHER';

/** The fixed catalog. Seeded into the products table. */
export const PRODUCT_CATALOG: CatalogProduct[] = [
  { code: 'COCONUT_OIL', nameSi: 'පොල් තෙල්', nameEn: 'Coconut oil', isCharcoal: false, allowedUnits: OIL_UNITS, sortOrder: 1 },
  { code: 'RBD_OIL', nameSi: 'RBD තෙල්', nameEn: 'RBD oil', isCharcoal: false, allowedUnits: OIL_UNITS, sortOrder: 2 },
  { code: 'SUNFLOWER_OIL', nameSi: 'සූරියකාන්ත තෙල්', nameEn: 'Sunflower oil', isCharcoal: false, allowedUnits: OIL_UNITS, sortOrder: 3 },
  { code: 'FARM_OIL', nameSi: 'Farm තෙල්', nameEn: 'Farm oil', isCharcoal: false, allowedUnits: OIL_UNITS, sortOrder: 4 },
  { code: 'WHITE_COCONUT_OIL', nameSi: 'සුදු පොල් තෙල්', nameEn: 'White coconut oil', isCharcoal: false, allowedUnits: OIL_UNITS, sortOrder: 5 },
  { code: 'CHARCOAL', nameSi: 'පොල්කටු අඟුරු', nameEn: 'Coconut-shell charcoal (bulk)', isCharcoal: true, allowedUnits: ['KG'], sortOrder: 6 },
  { code: OTHER_PRODUCT_CODE, nameSi: 'වෙනත්', nameEn: 'Other (custom item)', isCharcoal: false, allowedUnits: OIL_UNITS, sortOrder: 7 },
];
