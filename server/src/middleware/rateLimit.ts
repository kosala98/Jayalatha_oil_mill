import rateLimit from 'express-rate-limit';

/** Per-IP limit on PIN attempts. A global DB-backed lockout also applies (see admin route). */
export const pinLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many PIN attempts. Try again in 15 minutes.' },
  },
});

/** Loose ceiling on everything else, to blunt scripted abuse. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
});

/** Per-IP limit on pairing-code guesses. Codes are ~39 bits and expire in 10 minutes. */
export const pairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many pairing attempts. Try again in 15 minutes.' },
  },
});
