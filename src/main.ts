import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createServer } from 'node:http';
import { AppModule } from './app.module';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:8082',
  'http://127.0.0.1:8082',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
];
const DEFAULT_PORT = 6000;
const DEFAULT_BROWSER_SAFE_PORT = 6001;

function getAllowedCorsOrigins() {
  return new Set([
    ...DEFAULT_CORS_ORIGINS,
    ...(process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);
}

function isLocalhostOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedCorsOrigins = getAllowedCorsOrigins();

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedCorsOrigins.has(origin) || isLocalhostOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MCSA Server API')
    .setDescription('Authentication and application API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const browserSafePort = Number(process.env.BROWSER_SAFE_PORT ?? DEFAULT_BROWSER_SAFE_PORT);

  await app.listen(port);

  if (browserSafePort !== port) {
    const expressApp = app.getHttpAdapter().getInstance();
    createServer(expressApp).listen(browserSafePort);
  }
}
void bootstrap();
