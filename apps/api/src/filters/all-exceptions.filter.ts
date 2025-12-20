/**
 * @file all-exceptions.filter.ts
 * @description Unified exception filter for API error responses
 * @see docs/api-contract.md#2.2
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import type { ErrorCode } from '@epiphany/shared-contracts';

interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error: ApiError = {
      code: 'BAD_REQUEST',
      message: 'Internal server error',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;

        // If the response already has our error structure
        if (resp.code && typeof resp.code === 'string') {
          error = {
            code: resp.code as ErrorCode,
            message:
              typeof resp.message === 'string'
                ? resp.message
                : exception.message,
            details: resp.details as Record<string, unknown> | undefined,
          };
        } else if (resp.error && typeof resp.error === 'object') {
          // Already wrapped in { error: ... }
          const innerError = resp.error as Record<string, unknown>;
          error = {
            code: (innerError.code as ErrorCode) || 'BAD_REQUEST',
            message:
              (innerError.message as string) || exception.message,
            details: innerError.details as Record<string, unknown> | undefined,
          };
        } else {
          // NestJS default format: { message, error, statusCode }
          error = {
            code: this.statusToCode(status),
            message:
              typeof resp.message === 'string'
                ? resp.message
                : Array.isArray(resp.message)
                  ? resp.message[0]
                  : exception.message,
          };
        }
      } else {
        error = {
          code: this.statusToCode(status),
          message:
            typeof exceptionResponse === 'string'
              ? exceptionResponse
              : exception.message,
        };
      }
    }

    // Always return { error: { code, message, details? } }
    const responseBody: { error: ApiError } = { error };

    // Remove undefined details
    if (responseBody.error.details === undefined) {
      delete responseBody.error.details;
    }

    response.status(status).json(responseBody);
  }

  private statusToCode(status: number): ErrorCode {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'INVALID_SIGNATURE';
      case 403:
        return 'NOT_TOPIC_OWNER';
      case 404:
        return 'TOPIC_NOT_FOUND';
      case 409:
        return 'NONCE_REPLAY';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'BAD_REQUEST';
    }
  }
}
