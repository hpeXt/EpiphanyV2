import { Injectable } from '@nestjs/common';
import net from 'node:net';

type HealthStatus = 'ok' | 'fail';

export type HealthResult = {
  ok: boolean;
  db: HealthStatus;
  redis: HealthStatus;
  timestamp: string;
};

function finishOnce<T>(fn: (value: T) => void) {
  let called = false;
  return (value: T) => {
    if (called) return;
    called = true;
    fn(value);
  };
}

async function probeRedisPing(opts: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const done = finishOnce(resolve);
    const socket = net.createConnection({ host: opts.host, port: opts.port });

    const timeout = setTimeout(() => {
      socket.destroy();
      done(false);
    }, opts.timeoutMs);

    socket.once('error', () => {
      clearTimeout(timeout);
      done(false);
    });

    socket.once('connect', () => {
      socket.write('*1\r\n$4\r\nPING\r\n');
    });

    socket.once('data', (data) => {
      clearTimeout(timeout);
      socket.end();
      done(data.toString('utf8').includes('PONG'));
    });

    socket.once('close', () => {
      clearTimeout(timeout);
      done(false);
    });
  });
}

async function probePostgresSslRequest(opts: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const done = finishOnce(resolve);
    const socket = net.createConnection({ host: opts.host, port: opts.port });

    const timeout = setTimeout(() => {
      socket.destroy();
      done(false);
    }, opts.timeoutMs);

    socket.once('error', () => {
      clearTimeout(timeout);
      done(false);
    });

    socket.once('connect', () => {
      const packet = Buffer.alloc(8);
      packet.writeInt32BE(8, 0);
      packet.writeInt32BE(80877103, 4);
      socket.write(packet);
    });

    socket.once('data', (data) => {
      clearTimeout(timeout);
      socket.end();
      const firstByte = data[0];
      done(firstByte === 0x53 || firstByte === 0x4e);
    });

    socket.once('close', () => {
      clearTimeout(timeout);
      done(false);
    });
  });
}

function getHostPortFromUrl(rawUrl: string, defaultPort: number) {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const port = url.port ? Number(url.port) : defaultPort;
  return { host, port };
}

@Injectable()
export class HealthService {
  async check(): Promise<HealthResult> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const ok = db === 'ok' && redis === 'ok';
    return { ok, db, redis, timestamp: new Date().toISOString() };
  }

  private async checkDb(): Promise<HealthStatus> {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) return 'fail';

    try {
      const { host, port } = getHostPortFromUrl(rawUrl, 5432);
      const ok = await probePostgresSslRequest({ host, port, timeoutMs: 800 });
      return ok ? 'ok' : 'fail';
    } catch {
      return 'fail';
    }
  }

  private async checkRedis(): Promise<HealthStatus> {
    const rawUrl = process.env.REDIS_URL;
    if (!rawUrl) return 'fail';

    try {
      const { host, port } = getHostPortFromUrl(rawUrl, 6379);
      const ok = await probeRedisPing({ host, port, timeoutMs: 500 });
      return ok ? 'ok' : 'fail';
    } catch {
      return 'fail';
    }
  }
}

