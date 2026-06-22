# Roadmap — events-ting-api

Build order and status tracker for porting the T3-stack app into this standalone NestJS API.
Each feature slice is built **test-first** against [`openapi.yaml`](./openapi.yaml) and
[`data-model.md`](./data-model.md); the module decomposition lives in
[`architecture.md §2`](./architecture.md#2-module-decomposition-nestjs).

**Legend:** ✅ done · 🟡 partial (see notes) · ⬜ not started

---

## Phase 0 — Foundation _(complete)_

Cross-cutting infrastructure every feature builds on.

- ✅ Config — `@nestjs/config`, validated env (`class-validator`), composed `DATABASE_URL`
- ✅ Structured logging — `nestjs-pino` (JSON prod / pretty dev, `x-request-id`, redaction)
- ✅ Prisma module — global `PrismaModule`/`PrismaService`; schema grows per slice
- ✅ Auth — JWT access+refresh (rotation), global `JwtAuthGuard`, `@Public()`/`@CurrentUser()`
- ✅ Cache — global Redis `CacheModule` (`tix-ist` namespace), `AuthUserService` read-through
- ✅ Response format — `{ data, meta }` envelope + RFC 7807 `problem+json`; `@Api*Response` decorators
- ✅ API docs — `@nestjs/swagger` CLI plugin + Scalar `/reference` + tag registry
- ✅ Docker — multi-stage (dev/prod targets) + compose override
- ✅ CI — GitHub Actions (`lint:check` + `build` + `test` + commitlint)
- ✅ Hardening + versioning — helmet, CORS, Redis throttler, `x-powered-by` off, URI `/v1`

---

## Phase 1 — Identity & the root resource

Establishes the user surface, the core `Event` resource, and the RBAC that gates everything after.

- 🟡 **Users / `/me`** — `GET`/`PATCH /me`, `POST /me/change-password` done.
  Deferred (need Event/Registration): `DELETE /me`, `GET /me/events-summary`, profile event/attendee counts.
- 🟡 **Events** — `Event` model + organizer CRUD (create/list-mine/status-counts/get/update/delete),
  `draft → published → archived` flow (`archive`/`restore`), custom fields, and a public discovery
  surface (`/public/events`, `/public/events/{slug}` — published only). Ownership is an `organizerId`
  check for now (swaps to RBAC guards in the next slice). Deferred: `GET /events/{id}/metrics` and
  list relation-counts (need ticketing/registration models). _Unblocks most later modules._
- 🟡 **Team + RBAC (`PermissionsModule`)** — `TeamMember`/`Invitation` models + enums; the three
  guards (`EventAccessGuard`, `ModuleGuard`+`@RequireModule(...)`, `OwnerGuard`) + `@CurrentMembership()`.
  Event creation now writes an `ACTIVE`/`OWNER` `TeamMember` (existing events backfilled in the
  migration); Events routes are guard-gated (read = any member, mutate = owner). Team endpoints:
  invite, accept/decline (token), list members, `team/me`, `/me/memberships`, update permissions,
  remove, cancel. Deferred: invite **emails** (needs Mail adapter, Phase 5), **audit logging**
  (`AuditLog`, Phase 5), per-action rate limits (global throttler covers it for now), resend, and the
  declined/expired invitation lists.

> After Phase 1, revisit the deferred `/me` and Events items (now that the models exist).

---

## Phase 2 — Ticketing core

The purchase path. Registration is the concurrency-critical flow (row-lock, no overselling).

- ⬜ **TicketTypes** — tiers: name, price (BigInt minor units, NGN), quantity, sale window
- ⬜ **Registrations** — public self-registration (transactional row-lock), organizer add/list/cancel/export
- ⬜ **Tickets** — issued admission tickets, QR identity, optimistic-locked assignment (`expectedUpdatedAt`)
- ⬜ **Attendees** — custom-field responses, email state, CSV import, list export

---

## Phase 3 — Program

- ⬜ **Schedule** — sessions/tracks/timing, overlap detection, optimistic-locked edits
- ⬜ **Speakers** — speaker profiles + assignment to sessions
- ⬜ **CFP** — public proposal submission, organizer review, accept/reject (accept → speaker profile)

---

## Phase 4 — Engagement & operations

- ⬜ **Communications** — email campaigns to attendee segments + delivery analytics
- ⬜ **CheckIn** — on-site check-in by ticket number / QR (idempotent), live metrics
- ⬜ **Uploads** — file uploads via pluggable `StorageAdapter`
- ⬜ **Webhooks** — inbound provider webhooks (e.g. `POST /webhooks/email`), signature-verified
- ⬜ **Jobs** — scheduler-triggered maintenance (close expired CFPs, send campaigns, expire invitations)

---

## Phase 5 — Integrations & cross-cutting

Code to interfaces; one concrete impl now (adapter pattern, nothing outside `integrations/<x>/`
names the provider).

- ⬜ **Mail adapter** — `MailAdapter` → `ResendMailAdapter`
- ⬜ **Storage adapter** — local first (S3/R2 later)
- ⬜ **Payment processor** — free first (Stripe/Paystack later)
- ⬜ **Audit log** — `AuditModule` (team/security-relevant actions)
- ⬜ **Email-OTP passwordless login** — OTP issue/verify on top of auth
- ⬜ **Federated auth** — external identity providers

---

## Phase 6 — Productionization

- ⬜ Apply migrations to a real DB (`yarn db:deploy`)
- ⬜ e2e tests + CI service containers (Postgres/Redis)
- ⬜ Deployment — image registry + push, runtime secrets, environment config

---

## Working agreement

- **TDD** per slice: red spec → minimal impl → refactor.
- Schema grows **incrementally** — only add models for the slice in flight.
- Commit split: `build(deps)` (if any) then `feat(<scope>)`.
- Keep this file current: flip the box and add a one-line note when a slice lands or is deferred.
