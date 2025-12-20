/**
 * @file raw-body.middleware.ts
 * @description Middleware to capture raw body for BODY_HASH verification
 * @see docs/crypto.md#4.4
 */
import { json, Request, Response, NextFunction } from 'express';

declare module 'express' {
  interface Request {
    rawBody?: Buffer;
  }
}

/**
 * Express middleware that captures the raw request body before JSON parsing.
 * The raw body is stored on `req.rawBody` for later use in signature verification.
 */
export const RawBodyMiddleware = json({
  verify: (req: Request, _res: Response, buf: Buffer) => {
    req.rawBody = buf;
  },
});
