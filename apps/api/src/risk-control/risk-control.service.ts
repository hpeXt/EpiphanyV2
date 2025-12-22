import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';

import { PrismaService } from '../infrastructure/prisma.module.js';
import { RedisService } from '../infrastructure/redis.module.js';
import type { RiskControlEndpoint } from './risk-control.decorator.js';

type RateLimitScope = 'pubkey' | 'ip';

export interface RateLimitCheckResult {
  limited: boolean;
  scope?: RateLimitScope;
  retryAfterSeconds?: number;
  windowSeconds: number;
  limit?: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return fallback;
  return parsed;
}

function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  return ip;
}

function parseForwardedFor(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(',')[0]?.trim();
  if (!first) return null;
  return normalizeIp(first);
}

@Injectable()
export class RiskControlService {
  private readonly windowSeconds: number;
  private readonly ipHashSalt: string;

  private readonly endpointLimits: Record<
    RiskControlEndpoint,
    { pubkeyLimit: number; ipLimit: number }
  >;

  private readonly incrWithTtlScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {current, ttl}
`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.windowSeconds = parsePositiveInt(process.env.RISK_RL_WINDOW_SECONDS, 60);
    this.ipHashSalt = process.env.RISK_IP_HASH_SALT ?? 'epiphany-dev';

    this.endpointLimits = {
      createArgument: {
        pubkeyLimit: parseNonNegativeInt(process.env.RISK_RL_CREATE_ARGUMENT_PUBKEY_LIMIT, 10),
        ipLimit: parseNonNegativeInt(process.env.RISK_RL_CREATE_ARGUMENT_IP_LIMIT, 20),
      },
      setVotes: {
        pubkeyLimit: parseNonNegativeInt(process.env.RISK_RL_SET_VOTES_PUBKEY_LIMIT, 30),
        ipLimit: parseNonNegativeInt(process.env.RISK_RL_SET_VOTES_IP_LIMIT, 60),
      },
      topicCommands: {
        pubkeyLimit: parseNonNegativeInt(process.env.RISK_RL_COMMANDS_PUBKEY_LIMIT, 20),
        ipLimit: parseNonNegativeInt(process.env.RISK_RL_COMMANDS_IP_LIMIT, 40),
      },
    };
  }

  getClientIp(req: Request): string | null {
    const fromForwarded = parseForwardedFor(req.headers['x-forwarded-for'] as string | undefined);
    if (fromForwarded) return fromForwarded;

    const realIp = req.headers['x-real-ip'] as string | undefined;
    if (realIp) return normalizeIp(realIp.trim());

    const ip = (req.ip || req.socket.remoteAddress || '').trim();
    if (!ip) return null;
    return normalizeIp(ip);
  }

  async resolveTopicIdByArgumentId(argumentId: string): Promise<string | null> {
    const argument = await this.prisma.argument.findUnique({
      where: { id: argumentId },
      select: { topicId: true },
    });
    return argument?.topicId ?? null;
  }

  async assertNotBlacklisted(topicId: string, pubkeyHex: string): Promise<void> {
    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');
    const hit = await this.prisma.topicPubkeyBlacklist.findFirst({
      where: { topicId, pubkey: pubkeyBytes },
      select: { topicId: true },
    });

    if (hit) {
      throw new ForbiddenException({
        error: {
          code: 'TOPIC_PUBKEY_BLACKLISTED',
          message: 'Pubkey is blacklisted in this topic',
        },
      });
    }
  }

  async checkRateLimit(params: {
    endpoint: RiskControlEndpoint;
    topicId: string;
    pubkeyHex: string;
    ip: string | null;
  }): Promise<RateLimitCheckResult> {
    const limits = this.endpointLimits[params.endpoint];

    // 0 means disabled (non-negative parsing).
    if (limits.pubkeyLimit === 0 && limits.ipLimit === 0) {
      return { limited: false, windowSeconds: this.windowSeconds };
    }

    if (limits.pubkeyLimit > 0) {
      const key = this.getPubkeyKey(params.endpoint, params.topicId, params.pubkeyHex);
      const { count, ttlSeconds } = await this.incrWithWindow(key);
      if (count > limits.pubkeyLimit) {
        return {
          limited: true,
          scope: 'pubkey',
          limit: limits.pubkeyLimit,
          windowSeconds: this.windowSeconds,
          retryAfterSeconds: ttlSeconds,
        };
      }
    }

    if (limits.ipLimit > 0 && params.ip) {
      const ipHash = this.hashIp(params.topicId, params.ip);
      const key = this.getIpKey(params.endpoint, params.topicId, ipHash);
      const { count, ttlSeconds } = await this.incrWithWindow(key);
      if (count > limits.ipLimit) {
        return {
          limited: true,
          scope: 'ip',
          limit: limits.ipLimit,
          windowSeconds: this.windowSeconds,
          retryAfterSeconds: ttlSeconds,
        };
      }
    }

    return { limited: false, windowSeconds: this.windowSeconds };
  }

  private hashIp(topicId: string, ip: string): string {
    return createHmac('sha256', this.ipHashSalt)
      .update(`${topicId}|${ip}`, 'utf8')
      .digest('hex');
  }

  private getPubkeyKey(endpoint: RiskControlEndpoint, topicId: string, pubkeyHex: string): string {
    return `rl:v1:pk:${endpoint}:${topicId}:${pubkeyHex.toLowerCase()}`;
  }

  private getIpKey(endpoint: RiskControlEndpoint, topicId: string, ipHash: string): string {
    return `rl:v1:ip:${endpoint}:${topicId}:${ipHash}`;
  }

  private async incrWithWindow(key: string): Promise<{ count: number; ttlSeconds: number }> {
    const result = (await this.redis.eval(
      this.incrWithTtlScript,
      1,
      key,
      String(this.windowSeconds),
    )) as unknown;

    const [countRaw, ttlRaw] = Array.isArray(result) ? result : [null, null];
    const count = typeof countRaw === 'number' ? countRaw : Number.parseInt(String(countRaw), 10);
    const ttl = typeof ttlRaw === 'number' ? ttlRaw : Number.parseInt(String(ttlRaw), 10);

    const ttlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : this.windowSeconds;
    return { count, ttlSeconds };
  }
}

