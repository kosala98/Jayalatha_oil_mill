import type { Product } from './types';

/**
 * Bundled copy of the fixed catalog so the sale screen works on a first-ever offline
 * launch. The server's /api/products (seeded from the same list) replaces it when reachable.
 */
export const FALLBACK_PRODUCTS: Product[] = [
  { code: 'COCONUT_OIL', nameSi: 'පොල් තෙල්', nameEn: 'Coconut oil', isCharcoal: false, allowedUnits: ['LITER', 'KG', 'BOTTLE'], sortOrder: 1 },
  { code: 'RBD_OIL', nameSi: 'RBD තෙල්', nameEn: 'RBD oil', isCharcoal: false, allowedUnits: ['LITER', 'KG', 'BOTTLE'], sortOrder: 2 },
  { code: 'SUNFLOWER_OIL', nameSi: 'සූරියකාන්ත තෙල්', nameEn: 'Sunflower oil', isCharcoal: false, allowedUnits: ['LITER', 'KG', 'BOTTLE'], sortOrder: 3 },
  { code: 'FARM_OIL', nameSi: 'Farm තෙල්', nameEn: 'Farm oil', isCharcoal: false, allowedUnits: ['LITER', 'KG', 'BOTTLE'], sortOrder: 4 },
  { code: 'WHITE_COCONUT_OIL', nameSi: 'සුදු පොල් තෙල්', nameEn: 'White coconut oil', isCharcoal: false, allowedUnits: ['LITER', 'KG', 'BOTTLE'], sortOrder: 5 },
  { code: 'CHARCOAL', nameSi: 'පොල්කටු අඟුරු', nameEn: 'Coconut-shell charcoal (bulk)', isCharcoal: true, allowedUnits: ['KG'], sortOrder: 6 },
  { code: 'OTHER', nameSi: 'වෙනත්', nameEn: 'Other (custom item)', isCharcoal: false, allowedUnits: ['LITER', 'KG', 'BOTTLE'], sortOrder: 7 },
];

/** Free-text sale line: needs its own name typed in. */
export const OTHER_PRODUCT_CODE = 'OTHER';

export const BOTTLE_SIZES = ['QUARTER', 'HALF', 'ONE'] as const;
