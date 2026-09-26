import 'express';
import type { PinRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireSession / requireAdmin / requireFullAdmin. */
      auth?: { role: PinRole; expiresAt: number; temporary: boolean };
    }
  }
}

export {};
