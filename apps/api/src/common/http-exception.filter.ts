/**
 * @file http-exception.filter.ts
 * @description Global HTTP exception filter for consistent error responses
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

interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

type HealthStatus = 'ok' | 'fail';
type HealthResult = {
  ok: boolean;
  db: HealthStatus;
  redis: HealthStatus;
  timestamp: string;
};

function isErrorBody(obj: unknown): obj is ErrorBody {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'error' in obj &&
    typeof (obj as ErrorBody).error === 'object' &&
    (obj as ErrorBody).error !== null &&
    'code' in (obj as ErrorBody).error &&
    'message' in (obj as ErrorBody).error
  );
}

function isHealthResult(obj: unknown): obj is HealthResult {
  if (typeof obj !== 'object' || obj === null) return false;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.ok !== 'boolean') return false;
  if (rec.db !== 'ok' && rec.db !== 'fail') return false;
  if (rec.redis !== 'ok' && rec.redis !== 'fail') return false;
  return typeof rec.timestamp === 'string';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorBody: ErrorBody = {
      error: {
        code: 'BAD_REQUEST',
        message: 'Internal server error',
      },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Allow non-error structured responses for endpoints like /health.
      if (isHealthResult(exceptionResponse)) {
        response.status(status).json(exceptionResponse);
        return;
      }

      if (isErrorBody(exceptionResponse)) {
        errorBody = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        if (resp.message) {
          const message = Array.isArray(resp.message)
            ? resp.message.join(', ')
            : String(resp.message);
          errorBody = {
            error: {
              code: 'BAD_REQUEST',
              message,
            },
          };
        }
      } else if (typeof exceptionResponse === 'string') {
        errorBody = {
          error: {
            code: 'BAD_REQUEST',
            message: exceptionResponse,
          },
        };
      }
    }

    response.status(status).json(errorBody);
  }
}
