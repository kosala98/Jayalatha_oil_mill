import { Router } from 'express';
import { statsQuerySchema } from '../lib/validation';
import { requireAdmin } from '../middleware/auth';
import { computeStats } from '../services/stats';

export const statsRouter = Router();

statsRouter.get('/', requireAdmin, async (req, res) => {
  const { period } = statsQuerySchema.parse(req.query);
  res.json(await computeStats(period));
});
