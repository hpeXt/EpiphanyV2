/**
 * @file auth.guard.ts
 * @description Ed25519 signature verification guard
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service.js';

export const SIGNATURE_REQUIRED = 'signatureRequired';
export const RequireSignature = () => SetMetadata(SIGNATURE_REQUIRED, true);

// Extend Express Request to include rawBody
declare module 'express' {
  interface Request {
    rawBody?: string;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isSignatureRequired = this.reflector.get<boolean>(
      SIGNATURE_REQUIRED,
      context.getHandler(),
    );

    if (!isSignatureRequired) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    const pubkey = request.headers['x-pubkey'] as string | undefined;
    const signature = request.headers['x-signature'] as string | undefined;
    const timestamp = request.headers['x-timestamp'] as string | undefined;
    const nonce = request.headers['x-nonce'] as string | undefined;

    if (!pubkey || !signature || !timestamp || !nonce) {
      throw new UnauthorizedException({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Missing required signature headers',
        },
      });
    }

    const result = await this.authService.verifySignature({
      method: request.method,
      path: request.originalUrl,
      timestamp,
      nonce,
      rawBody: request.rawBody || '',
      pubkey,
      signature,
    });

    if (!result.valid) {
      switch (result.errorCode) {
        case 'TIMESTAMP_OUT_OF_RANGE':
          throw new UnauthorizedException({
            error: {
              code: 'TIMESTAMP_OUT_OF_RANGE',
              message: result.message,
            },
          });
        case 'NONCE_REPLAY':
          throw new ConflictException({
            error: {
              code: 'NONCE_REPLAY',
              message: result.message,
            },
          });
        case 'BAD_REQUEST':
          throw new BadRequestException({
            error: {
              code: 'BAD_REQUEST',
              message: result.message,
            },
          });
        default:
          throw new UnauthorizedException({
            error: {
              code: 'INVALID_SIGNATURE',
              message: result.message,
            },
          });
      }
    }

    // Attach pubkey to request for downstream use
    (request as Request & { pubkey?: string }).pubkey = pubkey;

    return true;
  }
}
