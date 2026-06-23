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
  (`User`, `Event`, `TeamMember`, `Invitation`, `TicketType`, `Registration`, `Ticket`, `Attendee` so far). `DATABASE_URL` is **composed** from `DB_*` parts via dotenv expansion
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
  plugin with `introspectComments` in `nest-cli.json`); served with Scalar at `/reference` +
  raw spec at `/openapi.json`, **non-production only** (`src/openapi/openapi.setup.ts`).
  Document the surface with **JSDoc**: a controller method's comment → operation `summary`,
  its `@remarks` → `description`; DTO property comments → field `description` (+ `@example`).
  Tags come from the central registry `src/openapi/api-tags.ts` — reference `@ApiTags(ApiTag.X)`
  and add new tags (with full descriptions) there. Still decorate responses with
  `@ApiStandardResponse`/`@ApiProblemResponse` and `@ApiBearerAuth` on protected routes.
  This generated spec reflects _implemented_ endpoints; the hand-written `docs/openapi.yaml`
  remains the full design contract.
- **Events (wired):** the root resource. Organizer CRUD under `/events` (owner-scoped by
  `organizerId`): create (unique slug), list-mine (cursor + status filter), `status-counts`, get,
  update, `archive`/`restore`, delete; anonymous discovery under `/public/events` +
  `/public/events/{slug}` (`@Public()`, published & non-archived only). Source in `src/events/`.
  Event-scoped routes are RBAC-guarded: read = any active member (`EventAccessGuard`), mutate =
  owner (`OwnerGuard`). Creating an event also writes the creator's `ACTIVE`/`OWNER` `TeamMember`
  in the same transaction. `GET /events/{id}/metrics` (member) rolls up registrations/tickets/
  assignment/check-in. Deferred: per-event list relation-counts (low value — `metrics` covers it).
- **Team & RBAC (wired):** event-scoped authorization in `src/permissions/` — `PermissionsService`
  (`checkEventAccess`/`checkModuleAccess`/`checkIsOwner`) behind three guards: `EventAccessGuard`
  (active member), `ModuleGuard` + `@RequireModule(ModuleName)` (owners bypass, collaborators need
  the module), `OwnerGuard` (owner-only). Resolve the caller's row with `@CurrentMembership()`.
  Guards read the event id from the `:eventId` route param (falling back to `:id`); flat `/team/*`
  routes do the owner check in `TeamService` via `PermissionsService`. Team management in `src/team/`:
  invite (owner), accept/decline by token, list members, `events/{eventId}/team/me`,
  `/me/memberships`, update permissions, remove, cancel. The tenant boundary is the **event** (no org
  layer); a user can own some events and collaborate on others. Deferred: invite emails + audit log
  (Phase 5), per-action rate limits, resend, declined/expired lists.
- **TicketTypes (wired):** purchasable tiers in `src/ticket-types/`. Create (`@RequireModule('TICKETS')`)
  and list (member) under `/events/{eventId}/ticket-types`; get/update/delete under `/ticket-types/{id}`
  (module check done in-service via `PermissionsService`); public on-sale list at
  `/public/events/{slug}/ticket-types`. This is the **first money model** — `price` is BigInt minor
  units (NGN), and `src/common/serialization/bigint.ts` (imported in `main.ts`) makes every BigInt
  JSON-serialize as an integer **string**. Inventory (`available = quantity − sold`) is derived;
  `TicketTypesService.soldCount()` sums registration quantities (live since the Registrations slice).
  The quantity-floor/price-lock/delete guards key off it. The source app's MVP "price must be 0" rule
  is **not** enforced.
- **Registrations (wired):** orders/purchases in `src/registrations/`. **Concurrency-safe** public
  self-registration at `POST /public/registrations` (`@Public()`): inside a transaction the tier row
  is locked `SELECT … FOR UPDATE` (raw) **before** counting, so concurrent registrations serialize and
  capacity can't be oversold (Postgres forbids `FOR UPDATE` + `GROUP BY`, hence lock-then-count, not a
  joined aggregate). Organizer list (`@RequireModule('ATTENDEES')`) at `/events/{eventId}/registrations`;
  get (event access) + `POST /registrations/{id}/cancel` (ATTENDEES, **hard-delete** → frees the slot).
  **Only free tiers of a published event are registrable** (paid blocked) until the processor lands;
  `paymentStatus` defaults to `free` (payment fields dormant). A successful registration **mints its
  tickets** (see Tickets) in the same transaction and returns the order **plus** its tickets. Deferred:
  organizer manual-add, CSV export, resend, public buyer self-service, email-status webhook,
  custom-field responses (Attendees).
- **Tickets (wired):** issued admission tokens in `src/tickets/`, one per seat. Minted (unassigned)
  when a free registration is created — `RegistrationsService` calls `buildTicketRows()`
  (`tickets/ticket-identity.ts`) inside the locked txn to `createMany` `quantity` rows, each with a
  human-readable `ticketNumber` (`TKT-…`) and a high-entropy `qrCodeData` payload (the QR encodes
  this; image rendering is a client concern). Reads: organizer list (`@RequireModule('ATTENDEES')`)
  at `/events/{eventId}/tickets` (filter tier/assigned/checked-in), get at `/tickets/{id}` (event
  access), public lookup at `/public/tickets/{ticketNumber}` (the number is the holder's credential).
  **Assignment** lives here too: `POST`/`DELETE /tickets/{id}/assignee` (see Attendees). **Check-in**
  is in the CheckIn slice. Deferred: QR-image rendering. Inventory `soldCount` stays registration-based
  (1:1 with tickets, so equal).
- **CheckIn (wired):** on-site check-in in `src/check-in/`, all `@RequireModule('CHECKIN')` under
  `/events/{eventId}/check-in`. `POST` checks a ticket in by `ticketNumber` **or** `qrCodeData`
  (scoped to the event) — **idempotent**: an already-checked-in ticket returns success with
  `alreadyCheckedIn: true` and isn't re-stamped; otherwise sets `isCheckedIn`/`checkedInAt`/`checkedInBy`.
  `GET .../ticket/{ticketNumber}` is the pre-check-in confirmation; `GET .../metrics` gives live
  counts (total/checked-in/remaining/%) + the 10 most recent; `GET .../attendees` is the door-staff
  roster search (by ticket number, attendee **email** or name; optional checked-in filter). No new
  model (uses the `Ticket` columns). This completes the ticket lifecycle: issue → assign → check in.
- **Attendees (wired):** the person who attends (distinct from the buyer), 1:1 with a `Ticket`, in
  `src/attendees/`. Created on **ticket assignment** (`TicketsService.assign`/`unassign`): authz is
  buyer-or-`TICKETS`; **cutoff-gated** (`events/assignment-cutoff.ts` from the event's
  `assignmentCutoff*`), **optimistic-locked** on the ticket's `updatedAt` via `expectedUpdatedAt`
  (409 on mismatch), and `customData` is validated against the event's `customFields`
  (`events/custom-fields.ts` — required + option membership). Reassignment replaces the attendee;
  unassign is blocked once checked in and deletes the attendee. Reads: organizer list
  (`@RequireModule('ATTENDEES')`) at `/events/{eventId}/attendees` (filter `emailStatus` + name/email
  search, scoped via the 1:1 ticket), get at `/attendees/{id}`. Deferred: CSV import/export,
  email-status webhook, attendee-update endpoint, assignment emails, advanced custom-field rules.
- **Users / `/me` (wired):** the authenticated caller's own profile — `GET /me` (profile),
  `PATCH /me` (update name/email/image; email change checks uniqueness, resets `emailVerified`,
  and evicts the auth cache), `POST /me/change-password`. `GET /me` includes `eventCount`/
  `registrationCount`; `GET /me/events-summary` rolls up total/active/archived events + total
  attendees. Source in `src/users/`. `DELETE /me` is **deferred** to its own slice — account
  deletion needs a transfer/cascade story for the `Restrict` FKs (`Event.organizer`,
  `TeamMember.invitedBy`, `Invitation.sentBy`), not just an active-events count.
- **Status:** early build. Scaffold + design docs are in place; remaining feature modules are
  being implemented. Treat anything marked _(planned)_ in the docs as not-yet-wired.
- **Source of truth for endpoints:** [`docs/openapi.yaml`](./docs/openapi.yaml) — 105 REST
  operations across 84 paths. Also see [`docs/data-model.md`](./docs/data-model.md) and
  [`docs/architecture.md`](./docs/architecture.md) (module decomposition, RBAC & request flows).
- **Build order & status:** [`docs/roadmap.md`](./docs/roadmap.md) — the phased slice plan; keep
  it current (flip the checkbox + add a one-line note) whenever a slice lands or is deferred.
- **Reference app:** `../tixist-web-trpc` (the Next.js/tRPC original). Read it for behavior to
  port, but **do not modify it** — it's a separate repo.

## Conventions & key decisions

- **REST, not RPC.** Resource-oriented endpoints; non-CRUD actions use sub-paths
  (`POST /events/{id}/archive`). Implement to match `docs/openapi.yaml`.
- **No magic strings.** Never hard-code a domain value (statuses, roles, module names, currency)
  as a bare string literal in services/controllers/DTOs. Reference a named constant so a typo is a
  compile error: **DB enums** use the Prisma-generated objects (`TeamRole.OWNER`,
  `TeamMemberStatus.ACTIVE`, `InvitationStatus.PENDING`); **plain-string columns** use the per-module
  const objects (`EventStatus`/`LocationType`/`AssignmentCutoffType` in `events/event.constants.ts`,
  `PaymentStatus` in `registrations/registration.constants.ts`, `DEFAULT_CURRENCY` in
  `ticket-types/ticket-type.constants.ts`); **module names** use `Module.*` from
  `permissions/permissions.types.ts`. Derive `@IsIn` arrays / `@IsEnum` from those, never re-list literals.
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
- **Routing & hardening (wired in `main.ts`).** Routes are **URI-versioned** under `/v1`
  (`enableVersioning`, `defaultVersion: '1'`); the health route is `@Version(VERSION_NEUTRAL)`
  at `/`, and the Scalar docs stay unversioned (raw adapter routes). helmet (CSP off in
  non-prod so `/reference` renders), env-driven CORS (`resolveCorsOptions`), `x-powered-by`
  disabled, `enableShutdownHooks`, and a strict `ValidationPipe` (`forbidNonWhitelisted`). A
  global Redis-backed `ThrottlerGuard` rate-limits everything; use `@SkipThrottle()` to exempt.
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
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) — `lint:check` + `typecheck` + `build` +
  unit `test` on push/PR (hermetic), plus commitlint on PRs. `yarn typecheck` (`tsc --noEmit`)
  is the **only** thing that type-checks `*.spec.ts` — `nest build` excludes specs and ts-jest runs
  transpile-only (`isolatedModules`), so without it spec type errors slip through. Run it after
  touching specs/DTOs.

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
  users/                 # /me: profile (get/update), change-password
  events/                # organizer CRUD + status flow + public discovery (/public/events)
  ticket-types/          # purchasable tiers (BigInt price); event-scoped + flat + public
  registrations/         # concurrency-safe self-registration (FOR UPDATE) + organizer list/cancel
  tickets/               # admission tickets: issuance, identity, list/get/lookup, assign/unassign
  attendees/             # attendee (1:1 ticket); list/get — created via ticket assignment
  check-in/              # on-site check-in (idempotent) + live metrics (CHECKIN module)
  permissions/           # event RBAC: PermissionsService + EventAccess/Module/Owner guards
  team/                  # team membership + invitation lifecycle (invite/accept/decline/manage)
  common/                # @Public()/@CurrentUser() decorators + JwtAuthGuard
  openapi/               # setupOpenApi() — Scalar reference + /openapi.json
prisma/                  # schema.prisma + migrations/ (create-only; apply with yarn db:deploy)
```

Still to come (see `docs/architecture.md` §7): feature modules per router (`users`,
`events`, `tickets`, …), `jobs/`, `integrations/{mail,storage,payment}/`, and the event/module
RBAC guards under `common/`.
