/**
 * @file errors.ts
 * @description Error response schema
 * @see docs/stage01/api-contract.md#2.2
 */
import { z } from 'zod';

/**
 * All valid error codes (v1.0)
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'INVALID_SIGNATURE',
  'TIMESTAMP_OUT_OF_RANGE',
  'NONCE_REPLAY',
  'NOT_TOPIC_OWNER',
  'NOT_ARGUMENT_AUTHOR',
  'TOPIC_PUBKEY_BLACKLISTED',
  'TOPIC_NOT_FOUND',
  'ARGUMENT_NOT_FOUND',
  'TOPIC_STATUS_DISALLOWS_WRITE',
  'ARGUMENT_PRUNED_INCREASE_FORBIDDEN',
  'INSUFFICIENT_BALANCE',
  'CLAIM_TOKEN_INVALID',
  'CLAIM_TOKEN_EXPIRED',
  'RATE_LIMITED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const zErrorCode = z.enum(ERROR_CODES);

export const zErrorResponse = z.object({
  error: z.object({
    code: zErrorCode,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ErrorResponse = z.infer<typeof zErrorResponse>;
