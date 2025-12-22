/**
 * @file errors.test.ts
 * @description Tests for ErrorResponse schema
 * @see docs/stage01/api-contract.md#2.2
 */
import {
  zErrorResponse,
  type ErrorResponse,
  ERROR_CODES,
} from '../index.js';

describe('ErrorResponse', () => {
  const validErrorCodes = [
    'BAD_REQUEST',
    'INVALID_SIGNATURE',
    'TIMESTAMP_OUT_OF_RANGE',
    'NONCE_REPLAY',
    'NOT_TOPIC_OWNER',
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

  it('should parse a valid error response', () => {
    const fixture: ErrorResponse = {
      error: {
        code: 'INVALID_SIGNATURE',
        message: '签名验证失败',
      },
    };

    const result = zErrorResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should parse error response with details', () => {
    const fixture: ErrorResponse = {
      error: {
        code: 'BAD_REQUEST',
        message: 'Validation failed',
        details: { field: 'body', reason: 'required' },
      },
    };

    const result = zErrorResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it.each(validErrorCodes)('should accept error code: %s', (code) => {
    const fixture = {
      error: {
        code,
        message: 'Test message',
      },
    };

    const result = zErrorResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should reject invalid error codes', () => {
    const fixture = {
      error: {
        code: 'UNKNOWN_ERROR_CODE',
        message: 'Test message',
      },
    };

    const result = zErrorResponse.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('should export ERROR_CODES constant', () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining(validErrorCodes));
    expect(ERROR_CODES.length).toBe(validErrorCodes.length);
  });
});
