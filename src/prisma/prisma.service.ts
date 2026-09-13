import { readFileSync } from 'node:fs';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

type PoolConfig = Exclude<ConstructorParameters<typeof PrismaPg>[0], string>;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    super({ adapter: new PrismaPg(buildPoolConfig(configService)) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Two clients read DATABASE_URL. The Prisma CLI (migrations) accepts
 * `sslmode=require` as-is; the runtime `pg` driver treats it as verify-full
 * and rejects a provider-specific CA it has never seen (Aiven's project CA).
 *
 * With DATABASE_SSL_CA_PATH set we hand that CA to the driver explicitly and
 * drop `sslmode` from the URL the driver sees — `pg` lets URL parameters
 * override explicit options, and any `sslmode` resets `ssl` to `{}`, which
 * would silently discard the CA. Verification stays ON: the chain is checked
 * against the CA and the hostname against the certificate.
 */
function buildPoolConfig(config: ConfigService): PoolConfig {
  const connectionString = config.getOrThrow<string>('DATABASE_URL');
  const caPath = config.get<string>('DATABASE_SSL_CA_PATH');
  if (!caPath) return { connectionString };

  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true },
  };
}
