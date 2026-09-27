import { Hono } from 'hono';
import type { AppEnv } from '../lib/http.ts';
import { statsQuerySchema } from '../lib/validation.ts';
import { requireAdmin } from '../middleware/auth.ts';
import { computeStats } from '../services/stats.ts';

export const statsRouter = new Hono<AppEnv>();

statsRouter.get('/', requireAdmin, async (c) => {
  const { period } = statsQuerySchema.parse(c.req.query());
  return c.json(await computeStats(period));
});
