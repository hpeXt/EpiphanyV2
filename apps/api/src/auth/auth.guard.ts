/**
 * @file auth.guard.ts
 * @description AuthGuard for Ed25519 signature verification
 * @see docs/stage01/api-contract.md#1
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Request } from 'express';
import { NonceService } from './nonce.service';
import {
  buildCanonicalMessage,
  verifySignature,
  isValidHex,
} from './crypto.util';

const TIMESTAMP_WINDOW_MS = 60_000; // 60 seconds

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly nonceService: NonceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Extract headers
    const pubkey = request.headers['x-pubkey'] as string | undefined;
    const signature = request.headers['x-signature'] as string | undefined;
    const timestampStr = request.headers['x-timestamp'] as string | undefined;
    const nonce = request.headers['x-nonce'] as string | undefined;

    // Validate required headers are present
    if (!pubkey || !signature || !timestampStr || !nonce) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Missing required signature headers',
      });
    }

    // Validate nonce format (must not contain '|')
    if (nonce.includes('|')) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'X-Nonce must not contain pipe character',
      });
    }

    // Validate pubkey format (64 hex chars = 32 bytes)
    if (!isValidHex(pubkey, 64)) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Invalid X-Pubkey format',
      });
    }

    // Validate signature format (128 hex chars = 64 bytes)
    if (!isValidHex(signature, 128)) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Invalid X-Signature format',
      });
    }

    // Validate timestamp format and window
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Invalid X-Timestamp format',
      });
    }

    const now = Date.now();
    if (Math.abs(now - timestamp) >= TIMESTAMP_WINDOW_MS) {
      throw new UnauthorizedException({
        code: 'TIMESTAMP_OUT_OF_RANGE',
        message: 'Timestamp is outside acceptable window',
      });
    }

    // Check nonce for replay protection
    const isNewNonce = await this.nonceService.checkAndMarkNonce(nonce);
    if (!isNewNonce) {
      throw new ConflictException({
        code: 'NONCE_REPLAY',
        message: 'Nonce has already been used',
      });
    }

    // Build canonical message
    // PATH must not include query string
    const path = request.path;
    const method = request.method;
    const rawBody = (request as any).rawBody as Buffer | undefined;

    const canonical = buildCanonicalMessage({
      method,
      path,
      timestamp: timestampStr,
      nonce,
      rawBody,
    });

    // Verify signature
    const isValid = verifySignature(pubkey, canonical, signature);
    if (!isValid) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Signature verification failed',
      });
    }

    // Attach pubkey to request for downstream use
    (request as any).pubkey = pubkey;

    return true;
  }
}
