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
