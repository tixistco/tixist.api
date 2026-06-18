# Standalone API — design docs

Documentation for extracting the event-management API out of the Next.js/tRPC app
into a standalone **NestJS** service.

| Doc | What it covers |
|---|---|
| [`data-model.md`](./data-model.md) | Every Prisma entity, field, relation, enum, JSON-typed column, index, and cascade rule. The schema reference for the port. |
| [`architecture.md`](./architecture.md) | Current vs. target architecture, NestJS module decomposition, auth/RBAC flow, key request flows, background jobs, suggested layout. Diagrams in Mermaid. |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1 contract. 105 operations across 84 paths mapping all 74 tRPC procedures + REST routes to a resource-oriented REST API. |

## Design decisions baked in

- **REST, not RPC.** tRPC procedures map to resource-oriented endpoints; non-CRUD
  actions use sub-paths (`POST /events/{id}/archive`, `POST /cfp/{id}/close`).
- **JWT bearer auth** replaces NextAuth. The `User.password` bcrypt hash is reused; the
  `Account`/`Session`/`VerificationToken` adapter tables can be dropped.
- **Two-layer authz** mirrors `src/server/api/permissions.ts`: a JWT guard for identity,
  then event-scoped guards (`EventAccessGuard`, `@RequireModule(...)`, `OwnerGuard`).
- **Public surface** (event discovery, self-registration, public CFP, ticket lookup) is
  marked `security: []` and lives under `/public/*` where it accepts no credentials.
- **Email, storage, and payment stay adapter-based** — code to an interface, with Resend /
  local / free as the first implementations. Storage and payment are already abstracted in
  source; email is newly put behind a `MailAdapter` (source calls Resend directly), so
  local→S3, free→Stripe/Paystack, and Resend→another email provider all remain config swaps.

## Known gaps to close during the build

1. **Email webhook signature verification** (`POST /webhooks/email`) is a TODO in the source — implement it in the provider adapter.
2. **Rate limiting** on public endpoints (registration, CFP submission) — env flags
   exist (`RATE_LIMIT_*`) but enforcement is not wired.
3. **Payment** is free-tickets-only (MVP). The `PaymentProcessor` interface and the
   dormant `Registration.payment*` fields are the seams for Stripe/Paystack.
4. **Concurrency**: preserve the transactional row-lock in self-registration and the
   optimistic-lock (`expectedUpdatedAt`) in ticket assignment and schedule edits.

## Validate the spec

```bash
npx @redocly/cli lint docs/openapi.yaml
# or preview:
npx @redocly/cli preview-docs docs/openapi.yaml
```

The contract can also seed the NestJS build directly:

```bash
# generate DTOs/clients from the contract
npx openapi-typescript docs/openapi.yaml -o src/generated/api-types.ts
```
