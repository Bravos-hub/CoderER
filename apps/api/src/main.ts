import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded, type Express } from 'express';
import helmet from 'helmet';
import { loadApiConfig } from '@codeer/config';
import { logger } from '@codeer/logger';
import { AppModule } from './app.module.js';
import { createApiAuthMiddleware } from './security/api-auth.middleware.js';
import { createRequestContextMiddleware } from './security/request-context.middleware.js';
import { SecureExceptionFilter } from './security/secure-exception.filter.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const express = app.getHttpAdapter().getInstance() as Express;

  express.disable('x-powered-by');
  if (config.API_TRUST_PROXY) express.set('trust proxy', 1);

  app.use(helmet());
  app.use(json({ limit: config.API_BODY_LIMIT, strict: true }));
  app.use(urlencoded({ extended: false, limit: config.API_BODY_LIMIT, parameterLimit: 100 }));
  app.use(
    createRequestContextMiddleware({
      requireTenantContext: config.API_REQUIRE_TENANT_CONTEXT,
      defaultOrganizationId: config.DEFAULT_ORGANIZATION_ID,
      requireSignedContext: config.API_REQUIRE_SIGNED_CONTEXT,
      signingSecrets: [
        config.REQUEST_CONTEXT_SIGNING_SECRET,
        config.REQUEST_CONTEXT_SIGNING_SECRET_PREVIOUS,
      ].filter((secret): secret is string => Boolean(secret)),
      signatureMaxAgeSeconds: config.REQUEST_CONTEXT_MAX_AGE_SECONDS,
    }),
  );
  app.use(
    createApiAuthMiddleware({
      mode: config.API_AUTH_MODE,
      apiKey: config.CODEER_API_KEY,
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.CORS_ALLOWED_ORIGINS,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-request-id',
      'x-correlation-id',
      'x-codeer-organization-id',
      'x-codeer-actor-id',
      'x-codeer-actor-type',
      'x-codeer-actor-roles',
      'x-codeer-context-timestamp',
      'x-codeer-context-signature',
    ],
    exposedHeaders: ['x-request-id', 'x-correlation-id'],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new SecureExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.API_PORT, '0.0.0.0');
  logger.info(
    {
      port: config.API_PORT,
      authentication: config.API_AUTH_MODE,
      allowedOriginCount: config.CORS_ALLOWED_ORIGINS.length,
    },
    'CodeER API listening',
  );
}

void bootstrap();
