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
  username?: string;
  password?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port });
    const done = finishOnce((ok: boolean) => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(ok);
    });

    const timeout = setTimeout(() => done(false), opts.timeoutMs);

    socket.once('error', () => done(false));

    function respArray(args: string[]): Buffer {
      const chunks: Buffer[] = [];
      chunks.push(Buffer.from(`*${args.length}\r\n`, 'utf8'));
      for (const arg of args) {
        const argBytes = Buffer.from(arg, 'utf8');
        chunks.push(Buffer.from(`$${argBytes.length}\r\n`, 'utf8'));
        chunks.push(argBytes);
        chunks.push(Buffer.from('\r\n', 'utf8'));
      }
      return Buffer.concat(chunks);
    }

    socket.once('connect', () => {
      if (opts.password) {
        if (opts.username) {
          socket.write(respArray(['AUTH', opts.username, opts.password]));
        } else {
          socket.write(respArray(['AUTH', opts.password]));
        }
      }
      socket.write(respArray(['PING']));
    });

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString('utf8');
      if (buffer.includes('PONG')) done(true);
      if (buffer.includes('NOAUTH')) done(false);
      if (buffer.includes('WRONGPASS')) done(false);
    });

    socket.once('close', () => done(false));
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
      const url = new URL(rawUrl);
      const host = url.hostname;
      const port = url.port ? Number(url.port) : 6379;
      const username = url.username ? decodeURIComponent(url.username) : undefined;
      const password = url.password ? decodeURIComponent(url.password) : undefined;

      const ok = await probeRedisPing({
        host,
        port,
        timeoutMs: 500,
        username,
        password,
      });
      return ok ? 'ok' : 'fail';
    } catch {
      return 'fail';
    }
  }
}
