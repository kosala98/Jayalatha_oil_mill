import { Router } from 'express';
import { prisma } from '../db';

export const productsRouter = Router();

/** Public: the counter needs the catalog to render the sale form (cached by the service worker). */
productsRouter.get('/', async (_req, res) => {
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    select: { code: true, nameSi: true, nameEn: true, isCharcoal: true, allowedUnits: true, sortOrder: true },
  });
  res.set('Cache-Control', 'public, max-age=300');
  res.json(products);
});
