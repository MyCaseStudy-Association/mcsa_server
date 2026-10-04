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

## Shared accounts and buyer workspace

The Expo app (`../mcsa`) and Next.js webapp (`../webapp`) use this same server and database.

- Existing accounts migrate to `user`. Mobile registration remains contributor-only.
- `POST /auth/login` and `/auth/refresh` accept optional `client: "mobile" | "web"`. Mobile rejects buyer/admin accounts. Auth responses and `/auth/me` include `user.role` (`user`, `buyer`, `admin`). Roles are signed into access tokens; there is no public role-change endpoint. Existing tokens without a role retain contributor-only permissions until re-login.
- `POST /auth/register-buyer` creates a buyer and its owning account atomically. It accepts the normal name/email/password plus `legalName` and `categoryId`. Neither registration endpoint accepts a role or admin privileges.
- Web accepts all roles. Buyers land on their briefs; admins land on moderation; contributors keep their overview and use mobile to import chats.
- `GET/POST /buyer/briefs`: buyer-owned listing and validated draft creation. Admins can list all briefs; only buyers create. JSON uploads use the same validated create endpoint and cannot set ownership, escrow, pricing, or status.
- `POST /buyer/briefs/:briefRef/moderate`: admin-only `status: "live" | "paused"`. Activating requires an unexpired, escrow-committed brief. Admins set the USD quote; the owning buyer pays through Stripe Checkout, and a verified webhook commits funding before admin activation. See STRIPE_SETUP.md.
- `/briefs/push`, `/briefs/matches`, `/refinement/process`, `/valuation/estimate`, and consent revocation are contributor-only. The existing on-device import → de-identification → matching → selected submission → QA pipeline is preserved. `/packaging/batch` is restricted to admins; no buyer delivery entitlement flow is introduced.

### Moderator seed

Apply migrations with `npx prisma migrate deploy`, generate the client with `npm run prisma:generate`, then run `npx prisma db seed`.
`SEED_ADMIN_EMAIL` defaults to `admin@portibilify.local`. Optional `SEED_ADMIN_PASSWORD` must contain 12–128 characters. When omitted, a random password is generated and saved to `.seed-admin.json` with mode 0600 (gitignored); it is never logged. Existing admin credentials are never reset, and a matching non-admin email is never promoted. The existing Phase-0 sandbox buyer/brief seed also runs idempotently. Use the web login for the moderator.

Role checks: `src/auth/roles.spec.ts`; ownership and validation checks: `src/briefs/buyer-briefs.spec.ts`.

## Stripe payments

Buyer funding now uses Stripe Checkout and signed webhooks. Configure the server keys and webhook listener using [STRIPE_SETUP.md](STRIPE_SETUP.md). Missing Stripe configuration leaves checkout disabled while the rest of the server continues working.
