import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config';
import { prisma } from './db';
import { HttpError } from './lib/errors';
import { apiLimiter } from './middleware/rateLimit';
import { authRouter } from './routes/auth';
import { billsRouter } from './routes/bills';
import { cashEntriesRouter } from './routes/cashEntries';
import { charcoalRouter, chequesRouter } from './routes/cheques';
import { customerPaymentsRouter, customersRouter } from './routes/customers';
import { pricesRouter } from './routes/prices';
import { productsRouter } from './routes/products';
import { purchasesRouter } from './routes/purchases';
import { salesRouter } from './routes/sales';
import { statsRouter } from './routes/stats';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      // The SPA (single-server mode) only loads its own bundled assets and fonts.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
        },
      },
    }),
  );

  if (config.corsOrigins.length > 0) {
    app.use(
      '/api',
      cors({
        origin: config.corsOrigins,
        methods: ['GET', 'POST', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
        maxAge: 600,
      }),
    );
  }

  app.use('/api', express.json({ limit: '32kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api', apiLimiter);
  app.use('/api/products', productsRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/purchases', purchasesRouter);
  app.use('/api/cash-entries', cashEntriesRouter);
  app.use('/api/prices', pricesRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/customer-payments', customerPaymentsRouter);
  app.use('/api/bills', billsRouter);
  app.use('/api/cheques', chequesRouter);
  app.use('/api/charcoal', charcoalRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/auth', authRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'No such endpoint')));

  // Optional single-server mode: serve the built React app from the same origin.
  if (config.serveClientDir) {
    const dir = path.resolve(config.serveClientDir);
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, filePath) {
          // Hashed assets can be cached forever; the SW and HTML must always revalidate.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.set('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
      return;
    }
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' } });
  });

  return app;
}
