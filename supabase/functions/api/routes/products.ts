import { Hono } from 'hono';
import { type Row, sql } from '../db.ts';
import type { AppEnv } from '../lib/http.ts';

export const productsRouter = new Hono<AppEnv>();

/** Public: the counter needs the catalog to render the sale form (cached by the service worker). */
productsRouter.get('/', async (c) => {
  const products = await sql<Row[]>`
    SELECT code, name_si, name_en, is_charcoal, allowed_units::text[] AS allowed_units, sort_order
    FROM products WHERE active = true
    ORDER BY sort_order ASC`;
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(products);
});
