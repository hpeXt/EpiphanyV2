import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function parseCorsOrigin(value: string): boolean | string[] {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();

  if (!normalized || lower === '*' || lower === 'true') return true;

  const origins = normalized
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length ? origins : true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigin = process.env.CORS_ORIGIN;

  if (corsOrigin) {
    app.enableCors({
      origin: parseCorsOrigin(corsOrigin),
      credentials: process.env.CORS_CREDENTIALS === 'true',
    });
  } else if (process.env.NODE_ENV !== 'production') {
    app.enableCors();
  }

  await app.listen(process.env.API_PORT ?? process.env.PORT ?? 3001);
}
bootstrap();
