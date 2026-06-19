# CLAUDE.md — events-ting-api

Standalone **event-management API** (NestJS), being ported from the original T3-stack web
app. The design is fully specified in [`docs/`](./docs/); feature code is built **against
that contract**, not improvised.

## What this repo is

- **Package:** `events-ting-api` · NestJS 11 (Express) · TypeScript 5 · Yarn · Jest.
- **Config & logging (wired):** `@nestjs/config` (global) with validated env via
  `class-validator` in `src/config/env.validation.ts`; structured logging via `nestjs-pino`
  (`src/config/logger.config.ts`) — JSON in prod, pretty in dev, `x-request-id` correlation,
  header redaction. Log via the injected `Logger`/`PinoLogger` from `nestjs-pino`, never `console`.
- **Database (wired):** Prisma 6 + PostgreSQL. Global `PrismaModule`/`PrismaService`
  (`src/prisma/`); schema at `prisma/schema.prisma` grows **incrementally per feature slice**
  (only `User` so far). `DATABASE_URL` is **composed** from `DB_*` parts via dotenv expansion
  (`expandVariables: true`); edit the parts, not the URL. After schema changes run
  `yarn db:migrate` (dev) and `yarn db:generate`.
- **Auth (wired):** email+password register/login → JWT **access + refresh** (rotation;
  refresh digest stored on `User`). JWT payloads are **PII-free** (`sub` only); identity is
  resolved per request via `AuthUserService` from a **Redis read-through cache** (fail-open).
  A **global `JwtAuthGuard`** protects everything; opt out with `@Public()`. Get the caller
  with `@CurrentUser()`. Source in `src/auth/` + `src/common/{guards,decorators}`.
- **Cache (wired):** global Redis `CacheModule` (`@nestjs/cache-manager` + `@keyv/redis`),
  keys namespaced under `tix-ist` (see [[cache-global-prefix]] memory).
- **API docs (wired):** runtime OpenAPI generated from `@nestjs/swagger` decorators (CLI
  plugin enabled in `nest-cli.json`); served with Scalar at `/reference` + raw spec at
  `/openapi.json`, **non-production only** (`src/openapi/openapi.setup.ts`). Decorate new
  controllers with `@ApiTags`/`@ApiOperation`/`@ApiResponse` (and `@ApiBearerAuth` on
  protected routes). Note: this generated spec reflects _implemented_ endpoints; the
  hand-written `docs/openapi.yaml` remains the full design contract.
- **Status:** early build. Scaffold + design docs are in place; remaining feature modules are
  being implemented. Treat anything marked _(planned)_ in the docs as not-yet-wired.
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
- **Response format (standardized).** Success is wrapped by a global interceptor as
  `{ data }` (`{ data, meta: { nextCursor } }` for lists — return a `Paginated` from
  `src/common/pagination`); 204s stay body-less. Errors are **RFC 7807 problem+json** via a
  global filter (`src/common/filters`). Document responses with `@ApiStandardResponse(Dto)` /
  `@ApiPaginatedResponse(Dto)` / `@ApiProblemResponse(status)` from `src/common/decorators`,
  using response DTO classes (`*.dto.ts`) so the envelope shows up in `/reference`.
- **Public routes** live under `/public/*` and carry no auth.
- **Concurrency to preserve:** transactional row-lock in self-registration (no overselling);
  optimistic lock via `expectedUpdatedAt` in ticket assignment and schedule edits.
- **Drop the boilerplate** `post` router/module from the original; it isn't ported.

## How we build

- **TDD.** Every feature is built test-first: write a failing spec (`*.spec.ts` unit, or
  `test/*.e2e-spec.ts`) that captures the behavior from `docs/openapi.yaml` / the data model,
  watch it fail, implement the minimum to make it pass, then refactor. Don't write
  implementation before there's a red test for it. Jest is already configured (`yarn test`,
  `yarn test:watch`).
- **Conventional Commits**, enforced by commitlint (`@commitlint/config-conventional`) via the
  `commit-msg` hook. Use `type(scope): subject`, e.g. `feat(events): add create endpoint`.
- **Git hooks (husky):** `pre-commit` runs `lint-staged` (Prettier `--write` then ESLint
  `--fix` on staged `*.ts`; Prettier on staged json/md/yaml). `commit-msg` runs commitlint.
  Hooks self-install via the `prepare` script on `yarn install`.
- **Docker:** multi-stage `Dockerfile` — `development` (devDeps, pretty logs) and `production`
  (slim, non-root, JSON logs) targets, `NODE_ENV` baked per target, listen port from `PORT`.
  Base `docker-compose.yml` uses the **production** target; `docker-compose.override.yml`
  (auto-merged) switches the api to **development** for local work. Run dev:
  `docker compose --env-file .env.docker up`; prod-like: add `-f docker-compose.yml`.
  Config in committed `.env.docker` (no `NODE_ENV` there — the target decides).
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) — `lint:check` + `build` + unit `test`
  on push/PR (hermetic), plus commitlint on PRs. Use `yarn lint:check` (no `--fix`) for CI-style checks.

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

```
src/
  main.ts                # bootstrap: bufferLogs + Pino, ValidationPipe, Scalar (non-prod)
  app.module.ts          # root: Config, Logger, Prisma, Cache, Auth
  config/                # env.validation (typed env) + logger.config (pino options)
  prisma/                # global PrismaModule + PrismaService
  cache/                 # global Redis CacheModule (tix-ist namespace)
  auth/                  # register/login/refresh/logout, JWT strategies, guards, cached AuthUserService
  common/                # @Public()/@CurrentUser() decorators + JwtAuthGuard
  openapi/               # setupOpenApi() — Scalar reference + /openapi.json
prisma/                  # schema.prisma + migrations/ (create-only; apply with yarn db:deploy)
```

Still to come (see `docs/architecture.md` §7): feature modules per router (`users`,
`events`, `tickets`, …), `jobs/`, `integrations/{mail,storage,payment}/`, and the event/module
RBAC guards under `common/`.
