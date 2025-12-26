import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';

// Note: Using in-memory store by default.
// For production with multiple server instances, consider adding Redis store:
// npm install rate-limit-redis
// Then configure RedisStore in this file.

/**
 * Login Rate Limiter - Strict limits for brute-force protection
 * 5 attempts per 15 minutes per IP
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten Fenster
  max: 5, // Max 5 Versuche
  message: {
    error: 'Zu viele Login-Versuche. Bitte warte 15 Minuten.',
    retryAfter: 15,
  },
  standardHeaders: true, // RateLimit-* Headers in Response
  legacyHeaders: false, // Disable X-RateLimit-* Headers
  skipSuccessfulRequests: true, // Erfolgreiche Logins zählen nicht gegen das Limit
  handler: (_req, res) => {
    logger.warn('Login rate limit exceeded');
    res.status(429).json({
      error: 'Zu viele Login-Versuche. Bitte warte 15 Minuten.',
      retryAfter: 15,
    });
  },
});

/**
 * Register Rate Limiter - Moderate limits for spam protection
 * 3 attempts per hour per IP
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 Stunde
  max: 3, // Max 3 Registrierungen pro Stunde
  message: {
    error: 'Zu viele Registrierungsversuche. Bitte warte 1 Stunde.',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    logger.warn('Register rate limit exceeded');
    res.status(429).json({
      error: 'Zu viele Registrierungsversuche. Bitte warte 1 Stunde.',
      retryAfter: 60,
    });
  },
});

/**
 * General API Rate Limiter - For other endpoints if needed
 * 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Zu viele Anfragen. Bitte warte einen Moment.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
