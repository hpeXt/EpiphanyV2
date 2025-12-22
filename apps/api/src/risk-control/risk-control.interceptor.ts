import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { RISK_CONTROL_OPTIONS, type RiskControlOptions } from './risk-control.decorator.js';
import { RiskControlService } from './risk-control.service.js';

@Injectable()
export class RiskControlInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly risk: RiskControlService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const options = this.reflector.get<RiskControlOptions>(
      RISK_CONTROL_OPTIONS,
      context.getHandler(),
    );
    if (!options) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { nonceReplay?: boolean }>();
    const res = http.getResponse<Response>();

    const pubkeyHeader = req.headers['x-pubkey'];
    const pubkeyHex =
      (typeof pubkeyHeader === 'string' ? pubkeyHeader : undefined) ??
      (req as Request & { pubkey?: string }).pubkey;

    if (!pubkeyHex) return next.handle();

    let topicId: string | null = null;
    if (options.topicResolver.kind === 'param') {
      topicId = req.params[options.topicResolver.paramName] ?? null;
    } else if (options.topicResolver.kind === 'argumentIdParam') {
      const argumentId = req.params[options.topicResolver.paramName];
      if (argumentId) {
        topicId = await this.risk.resolveTopicIdByArgumentId(argumentId);
      }
    }

    if (!topicId) return next.handle();

    // Topic blacklist affects only user write endpoints (createArgument/setVotes).
    if (options.endpoint !== 'topicCommands') {
      await this.risk.assertNotBlacklisted(topicId, pubkeyHex);
    }

    // Preserve strong idempotency: allow setVotes retries (nonce replay) to reach VotesService cache.
    if (options.endpoint === 'setVotes' && req.nonceReplay) {
      return next.handle();
    }

    const ip = this.risk.getClientIp(req);
    const rateLimit = await this.risk.checkRateLimit({
      endpoint: options.endpoint,
      topicId,
      pubkeyHex,
      ip,
    });

    if (rateLimit.limited) {
      if (rateLimit.retryAfterSeconds) {
        res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      }

      const details: Record<string, unknown> = {
        scope: rateLimit.scope,
        windowSeconds: rateLimit.windowSeconds,
      };
      if (rateLimit.limit !== undefined) details.limit = rateLimit.limit;
      if (rateLimit.retryAfterSeconds !== undefined) {
        details.retryAfterSeconds = rateLimit.retryAfterSeconds;
      }

      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Rate limit exceeded',
            details,
          },
        },
        429,
      );
    }

    return next.handle();
  }
}

