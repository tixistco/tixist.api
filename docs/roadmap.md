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

- 🟡 **Users / `/me`** — `GET`/`PATCH /me` (profile now includes `eventCount`/`registrationCount`),
  `POST /me/change-password`, `GET /me/events-summary` (total/active/archived events + total attendees).
  Deferred: `DELETE /me` — account deletion is its own slice (the `Restrict` FKs on `Event.organizer`,
  `TeamMember.invitedBy` and `Invitation.sentBy` need a transfer/cascade story, not just a count).
- 🟡 **Events** — `Event` model + organizer CRUD (create/list-mine/status-counts/get/update/delete),
  `draft → published → archived` flow (`archive`/`restore`), custom fields, and a public discovery
  surface (`/public/events`, `/public/events/{slug}` — published only). Ownership is an `organizerId`
  check for now (swaps to RBAC guards in the next slice). `GET /events/{id}/metrics` (member) rolls
  up registrations/tickets/assignment/check-in. Deferred: per-event list relation-counts (low value —
  `metrics` covers it). _Unblocks most later modules._
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

- 🟡 **TicketTypes** — tiers (name, price BigInt minor units/NGN, quantity, sale window): create
  (TICKETS module) + list (event access) under `/events/{eventId}/ticket-types`; get/update/delete
  under `/ticket-types/{id}` (in-service module check); public on-sale list at
  `/public/events/{slug}/ticket-types`. First money model → global `BigInt`→string JSON
  serialization. Inventory (`available = quantity − sold`) is derived; `soldCount()` now sums
  registration quantities (live as of the Registrations slice). Note: the MVP "price must be 0"
  rule from the source app is **not** enforced — non-zero prices are allowed (payment is a no-op
  until the processor lands; paid tiers just aren't registrable yet).
- 🟡 **Registrations** — concurrency-safe public self-registration (`POST /public/registrations`):
  the tier row is locked `FOR UPDATE` before counting, so capacity can't be oversold; organizer
  list (ATTENDEES) at `/events/{eventId}/registrations`, get (event access) + cancel/hard-delete
  (ATTENDEES) at `/registrations/{id}`. **Only free tiers are registrable** (paid blocked) until
  the processor lands; `paymentStatus` defaults to `free`. This wires `TicketTypesService.soldCount()`
  to real data — availability is now live. Deferred: organizer manual-add, CSV export, resend
  confirmation, public buyer self-service (lookup / by-id), email-status webhook, and custom-field
  responses (Attendee slice).
- 🟡 **Tickets** — `Ticket` model; a free registration now mints `quantity` unassigned tickets in
  the same locked transaction (`ticketNumber` + high-entropy `qrCodeData`). Reads: organizer list
  (`@RequireModule('ATTENDEES')`) at `/events/{eventId}/tickets` (filter by tier/assigned/checked-in),
  get at `/tickets/{id}` (event access), public lookup at `/public/tickets/{ticketNumber}`. Register
  now returns the order **plus its tickets**. Assignment (optimistic-locked, cutoff-gated) landed in
  the Attendees slice. Deferred: **check-in** (CheckIn slice) and QR-image rendering.
- 🟡 **Attendees** — `Attendee` model (1:1 with `Ticket`); wires the deferred `Ticket.attendee` FK.
  Ticket **assignment**: `POST`/`DELETE /tickets/{id}/assignee` — buyer-or-`TICKETS` authz, **cutoff-gated**
  (`assignment-cutoff.ts`), **optimistic-locked** on `expectedUpdatedAt` (409 on mismatch),
  **custom-field validation** (`custom-fields.ts`: required + option membership); reassignment replaces
  the attendee, unassign blocked once checked in. Reads: organizer list (`@RequireModule('ATTENDEES')`)
  at `/events/{eventId}/attendees` (filter email-status + name/email search), get at `/attendees/{id}`.
  Deferred: CSV import/export, email-status webhook, attendee-update endpoint, assignment emails,
  advanced custom-field rules (regex/length/selection counts).

---

## Phase 3 — Program

- ⬜ **Schedule** — sessions/tracks/timing, overlap detection, optimistic-locked edits
- ⬜ **Speakers** — speaker profiles + assignment to sessions
- ⬜ **CFP** — public proposal submission, organizer review, accept/reject (accept → speaker profile)

---

## Phase 4 — Engagement & operations

- ⬜ **Communications** — email campaigns to attendee segments + delivery analytics
- 🟡 **CheckIn** — on-site check-in under `/events/{eventId}/check-in` (all `@RequireModule('CHECKIN')`):
  `POST` checks a ticket in by number **or** QR, scoped to the event, **idempotent** (already-checked-in
  is a no-op returning `alreadyCheckedIn`), stamping `checkedInBy`; `GET .../ticket/{ticketNumber}`
  for the pre-check-in confirmation; `GET .../metrics` (total / checked-in / remaining / % + 10 most
  recent); `GET .../attendees` is the door-staff **roster search** — match by ticket number, attendee
  **email** or name (case-insensitive), optional checked-in filter, cursor-paginated. No new model —
  uses the `Ticket` check-in columns. Completes the ticket lifecycle (issue → assign → check in).
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
