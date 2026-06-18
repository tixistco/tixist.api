# CLAUDE.md — events-ting-api

Standalone **event-management API** (NestJS), being ported from the original T3-stack web
app. The design is fully specified in [`docs/`](./docs/); feature code is built **against
that contract**, not improvised.

## What this repo is

- **Package:** `events-ting-api` · NestJS 11 (Express) · TypeScript 5 · Yarn · Jest.
- **Status:** early build. Scaffold + design docs are in place; feature modules, Prisma, and
  auth are being implemented. Treat anything marked _(planned)_ in the docs as not-yet-wired.
- **Source of truth for endpoints:** [`docs/openapi.yaml`](./docs/openapi.yaml) — 105 REST
  operations across 84 paths. Also see [`docs/data-model.md`](./docs/data-model.md) and
  [`docs/architecture.md`](./docs/architecture.md) (module decomposition, RBAC & request flows).
- **Reference app:** `../tixist-web-trpc` (the Next.js/tRPC original). Read it for behavior to
  port, but **do not modify it** — it's a separate repo.

## Conventions & key decisions

- **REST, not RPC.** Resource-oriented endpoints; non-CRUD actions use sub-paths
  (`POST /events/{id}/archive`). Implement to match `docs/openapi.yaml`.
- **Money = BigInt minor units**, default currency **NGN** (kobo). Never floats/decimals.
  Serialize over the wire as integer strings. See `docs/data-model.md#money-representation`.
- **Adapter pattern** for external integrations — code to an interface, with one concrete
  impl for now: `MailAdapter` → `ResendMailAdapter`, `StorageAdapter` → local (S3/R2 later),
  `PaymentProcessor` → free (Stripe/Paystack later). Nothing outside `integrations/<x>/`
  names the concrete provider. Email webhook is provider-agnostic: `POST /webhooks/email`.
- **Auth:** JWT bearer (reuse the bcrypt `User.password` hash) + two-layer event RBAC —
  `EventAccessGuard`, `@RequireModule(...)`, `OwnerGuard`. Modules: `OVERVIEW, ATTENDEES,
  TICKETS, SCHEDULE, SPEAKERS, CFP, COMMUNICATIONS, CHECKIN` (assignable); `SETTINGS` is
  owner-only. Owners bypass module checks.
- **Public routes** live under `/public/*` and carry no auth.
- **Concurrency to preserve:** transactional row-lock in self-registration (no overselling);
  optimistic lock via `expectedUpdatedAt` in ticket assignment and schedule edits.
- **Drop the boilerplate** `post` router/module from the original; it isn't ported.

## Commands

```bash
yarn install
yarn start:dev      # watch mode (http://localhost:3000)
yarn build          # compile to dist/
yarn start:prod     # node dist/main
yarn lint           # eslint --fix
yarn test           # unit (jest)
yarn test:e2e       # e2e
yarn test:cov       # coverage
```

Work the OpenAPI contract directly when useful:
```bash
npx @redocly/cli lint docs/openapi.yaml
npx openapi-typescript docs/openapi.yaml -o src/generated/api-types.ts
```

## Layout

`src/` is the current NestJS scaffold (`app.module.ts`, `main.ts`). The target module
layout (PrismaModule, AuthModule, common guards, feature modules per router, `jobs/`,
`integrations/{mail,storage,payment}/`) is described in `docs/architecture.md` §7.
