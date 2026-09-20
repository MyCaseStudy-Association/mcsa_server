# Portibilify API server

NestJS 11 + Prisma 7 (Postgres) + JWT auth + Swagger. Stages 6–7 of the Portibilify pipeline: server-side de-identification, packaging, consent receipts. The only client is the Expo app in the sibling repository `mcsa_app/`.

Engineering rules, directory structure and the API contract live in [CLAUDE.md](CLAUDE.md).

## Setup (once per machine)

```bash
npm install
npm run env:init          # builds .env from .env.example; generates secrets locally
```

`env:init` prints which variables it generated, kept, or still need a value. Two things come from the Aiven console (project → PostgreSQL service → Overview):

1. **Service URI** → paste into `.env` as `DATABASE_URL` (keep `sslmode=require`).
2. **CA certificate → Download** → save into the repo root; `env:init` files it as `certs/aiven-ca.pem` (gitignored), which `DATABASE_SSL_CA_PATH` points at.

Then create the schema and start:

```bash
npm run prisma:generate
npx prisma migrate deploy     # applies prisma/migrations to DATABASE_URL
npx prisma db seed            # Phase-0: one sandbox buyer + one live brief (idempotent)
npm run start:dev             # http://localhost:6000  (Swagger UI at /api)
```

`.env` is never committed and never hand-edited except for `DATABASE_URL`. Re-running `env:init` is safe; it never overwrites a set value.

## Commands

```bash
npm run start:dev        # nest --watch on PORT (6000) + BROWSER_SAFE_PORT (6001)
npm run build            # nest build -> dist/
npm run lint             # eslint --fix
npm run format           # prettier --write src/ test/
npm test                 # unit tests (src/**/*.spec.ts)
npm run test:e2e         # test/*.e2e-spec.ts
npm run prisma:generate  # after ANY schema.prisma change
npm run prisma:studio    # browse the proof store
docker compose -f docker-compose.presidio.yml up -d   # optional Presidio detector (DETECTOR=presidio)
```

## Environment variables

Documented in [.env.example](.env.example) and the table in [CLAUDE.md](CLAUDE.md#environment-variables). Rotate secrets with `npm run env:init -- --rotate=NAME[,NAME]`; rotate everything before the first production deploy.

## Privacy

The proof store holds fingerprints, hashes, attestations, consent receipts and de-identified prompts only. Raw prompt content and matched entity text are never persisted, logged, or returned (CLAUDE.md rule 16). Detection runs in-zone: the mock detector or self-hosted Presidio, never a cloud API.
