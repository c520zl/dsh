import './config/bootstrap';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { APP_CONFIG, loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  loadConfig();
  const adapter = new FastifyAdapter({
    trustProxy: process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1',
    genReqId: () => `req_${randomUUID()}`,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const config = app.get<ReturnType<typeof loadConfig>>(APP_CONFIG);
  await app.listen({ port: config.port, host: config.host });
  app
    .get(Logger)
    .log(`Todo API listening on http://${config.host}:${config.port}/v1 (env=${config.nodeEnv})`);
}

bootstrap().catch((error: unknown) => {
  // Startup failures must be loud and terminate the process.
  console.error('Fatal startup error', error);
  process.exit(1);
});
