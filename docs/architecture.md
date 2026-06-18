# Architecture — Standalone API (NestJS target)

This document describes the architecture of the standalone API extracted from the
existing Next.js/tRPC application, expressed as a **NestJS** service. It covers the
current (source) architecture, the target architecture, the module decomposition,
request/permission flows, and the background jobs.

**Diagram legend** — nodes are colour-coded by role: 🟦 **clients / feature modules**
(blue), 🟩 **NestJS app & core providers** (green), 🟧 **datastore — PostgreSQL** (amber),
🟪 **external services — Resend, storage** (purple), **background jobs / scheduler** (teal),
and **future / dormant — payments, Stripe/Paystack** (dashed slate).

---

## 1. Current vs. target

### Current (source) — Next.js monolith

```mermaid
graph TD
  Browser["Browser (React UI)"]
  subgraph Next["Next.js app (Vercel)"]
    RSC["React Server Components / pages"]
    TRPC["tRPC router (/api/trpc)"]
    REST["REST routes (/api/auth, /api/upload, /api/webhooks, /api/cron)"]
    NextAuth["NextAuth v5 (JWT)"]
  end
  DB[("PostgreSQL (Prisma)")]
  Resend["Resend (email)"]
  Storage["File storage (local / S3)"]
  Vercel["Vercel Cron"]

  Browser -->|RSC + tRPC calls| Next
  TRPC --> DB
  REST --> DB
  NextAuth --> DB
  TRPC --> Resend
  REST --> Resend
  TRPC --> Storage
  REST --> Storage
  Vercel -->|HTTP w/ CRON_SECRET| REST
  Resend -->|webhook| REST

  classDef client fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a;
  classDef app fill:#dcfce7,stroke:#22c55e,color:#14532d;
  classDef db fill:#fef3c7,stroke:#f59e0b,color:#78350f;
  classDef ext fill:#f3e8ff,stroke:#a855f7,color:#581c87;
  classDef job fill:#ccfbf1,stroke:#14b8a6,color:#134e4a;
  class Browser client;
  class RSC,TRPC,REST,NextAuth app;
  class DB db;
  class Resend,Storage ext;
  class Vercel job;
  style Next fill:#f0fdf4,stroke:#22c55e,color:#14532d;
```

UI and API are co-deployed; the API is reachable only via tRPC's TypeScript client and a
handful of REST routes.

### Target — standalone NestJS API

```mermaid
graph TD
  subgraph Clients
    Web["Web UI (Next.js, refactored)"]
    Mobile["Mobile / 3rd-party"]
    Scanner["Check-in scanner app"]
  end

  subgraph Nest["NestJS API service"]
    GW["HTTP layer: Controllers + Swagger/OpenAPI"]
    Guards["Guards: JWT auth + Event/Module RBAC"]
    Svc["Feature services (business logic)"]
    Jobs["Scheduler (@nestjs/schedule) / queue"]
    Prisma["PrismaService"]
  end

  DB[("PostgreSQL")]
  Resend["Resend"]
  Storage["Object storage (S3/R2)"]
  Pay["Payment provider (future: Stripe/Paystack)"]

  Web -->|REST + JWT| GW
  Mobile -->|REST + JWT| GW
  Scanner -->|REST + JWT| GW
  GW --> Guards --> Svc
  Svc --> Prisma --> DB
  Svc --> Resend
  Svc --> Storage
  Svc -. future .-> Pay
  Jobs --> Svc
  Resend -->|webhook + signature| GW

  classDef client fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a;
  classDef app fill:#dcfce7,stroke:#22c55e,color:#14532d;
  classDef db fill:#fef3c7,stroke:#f59e0b,color:#78350f;
  classDef ext fill:#f3e8ff,stroke:#a855f7,color:#581c87;
  classDef job fill:#ccfbf1,stroke:#14b8a6,color:#134e4a;
  classDef future fill:#f1f5f9,stroke:#94a3b8,color:#334155,stroke-dasharray:4 3;
  class Web,Mobile,Scanner client;
  class GW,Guards,Svc,Prisma app;
  class Jobs job;
  class DB db;
  class Resend,Storage ext;
  class Pay future;
  style Clients fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a;
  style Nest fill:#f0fdf4,stroke:#22c55e,color:#14532d;
```

Key shifts:
- tRPC procedures become **REST controllers** documented by an OpenAPI/Swagger spec.
- NextAuth is replaced by a **first-party JWT auth module** (reusing the bcrypt `password` hash on `User`).
- Vercel Cron HTTP endpoints become **in-process scheduled jobs** (`@nestjs/schedule`), or remain HTTP-triggered if you keep an external scheduler.
- The email delivery webhook handler stays (now provider-agnostic, `POST /webhooks/email`), but **signature verification must be implemented** in the mail adapter (it is a TODO in the source).

---

## 2. Module decomposition (NestJS)

Each tRPC router maps to a NestJS feature module. Shared concerns (auth, permissions,
email, storage, payments, prisma) become injectable providers.

```mermaid
graph LR
  subgraph Core
    PrismaM["PrismaModule"]
    AuthM["AuthModule (JWT, login, register)"]
    PermM["PermissionsModule (Event RBAC guards)"]
    MailM["MailModule (MailAdapter → Resend)"]
    StorageM["StorageModule (S3/local adapter)"]
    PayM["PaymentModule (free; Stripe/Paystack stubs)"]
    AuditM["AuditModule"]
  end

  subgraph Features
    EventM["EventsModule"]
    TicketTypeM["TicketTypesModule"]
    RegM["RegistrationsModule"]
    TicketM["TicketsModule"]
    AttM["AttendeesModule"]
    SchedM["ScheduleModule"]
    SpkM["SpeakersModule"]
    CfpM["CfpModule"]
    CommM["CommunicationsModule"]
    TeamM["TeamModule"]
    CheckinM["CheckInModule"]
    UserM["UsersModule"]
  end

  subgraph Background
    JobsM["JobsModule (schedule + cron endpoints)"]
  end

  Features --> PrismaM
  Features --> PermM
  RegM --> MailM
  CommM --> MailM
  TeamM --> MailM
  TicketM --> MailM
  EventM --> StorageM
  RegM --> PayM
  TeamM --> AuditM
  JobsM --> CfpM
  JobsM --> CommM
  JobsM --> TeamM
  AuthM --> PrismaM
  PermM --> PrismaM

  classDef core fill:#dcfce7,stroke:#22c55e,color:#14532d;
  classDef ext fill:#f3e8ff,stroke:#a855f7,color:#581c87;
  classDef feature fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a;
  classDef job fill:#ccfbf1,stroke:#14b8a6,color:#134e4a;
  classDef future fill:#f1f5f9,stroke:#94a3b8,color:#334155,stroke-dasharray:4 3;
  class PrismaM,AuthM,PermM,AuditM core;
  class MailM,StorageM ext;
  class PayM future;
  class EventM,TicketTypeM,RegM,TicketM,AttM,SchedM,SpkM,CfpM,CommM,TeamM,CheckinM,UserM feature;
  class JobsM job;
  style Core fill:#f0fdf4,stroke:#22c55e,color:#14532d;
  style Features fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a;
  style Background fill:#f0fdfa,stroke:#14b8a6,color:#134e4a;
```

| NestJS module | From router/route | Primary entities |
|---|---|---|
| AuthModule | `/api/auth/*`, NextAuth | User, (Account/Session optional) |
| UsersModule | `user` | User |
| EventsModule | `event` | Event |
| TicketTypesModule | `ticket` | TicketType |
| RegistrationsModule | `registration` | Registration, Ticket, Attendee |
| TicketsModule | `tickets` | Ticket, Attendee |
| AttendeesModule | `attendees` | Attendee (+ CSV import) |
| ScheduleModule | `schedule` | ScheduleEntry |
| SpeakersModule | `speaker` | Speaker, SpeakerSession |
| CfpModule | `cfp` | CallForPapers, CfpSubmission |
| CommunicationsModule | `communication` | EmailCampaign |
| TeamModule | `team` | TeamMember, Invitation, AuditLog |
| CheckInModule | `check-in` | Ticket, Attendee |
| JobsModule | `/api/cron/*` | CFP, EmailCampaign, Invitation |

> The boilerplate `post` router is dropped.

---

## 3. Authentication & authorization

Two layers: **authentication** (who you are — JWT) and **authorization** (what you can
do on a given event — the role/module model from `permissions.ts`).

```mermaid
sequenceDiagram
  participant C as Client
  participant Ctl as Controller
  participant JG as JwtAuthGuard
  participant EG as EventAccessGuard / ModuleGuard
  participant S as Service
  participant DB as PostgreSQL

  rect rgb(219, 234, 254)
    note over C,JG: Authentication (JWT)
    C->>Ctl: POST /events/{id}/attendees (Bearer JWT)
    Ctl->>JG: validate token
    JG->>JG: decode → req.user = { id, email }
    JG-->>Ctl: ok (401 if invalid)
  end
  rect rgb(220, 252, 231)
    note over Ctl,DB: Authorization (Event/Module RBAC)
    Ctl->>EG: requires module ATTENDEES on {id}
    EG->>DB: find ACTIVE TeamMember(eventId, userId)
    alt owner
      EG-->>Ctl: allow
    else collaborator with module
      EG-->>Ctl: allow if module in modulePermissions
    else
      EG-->>Ctl: 403 Forbidden
    end
  end
  rect rgb(254, 243, 199)
    note over S,DB: Business logic
    Ctl->>S: handler(dto, user)
    S->>DB: query/mutate
    S-->>C: result
  end
```

Authorization rules (ported verbatim from `src/server/api/permissions.ts`):
- **`EventAccessGuard`** ↔ `checkEventAccess`: caller must be an `ACTIVE` `TeamMember` of the event (owner or collaborator), else `403`.
- **`ModuleGuard(module)`** ↔ `checkModuleAccess`: owners bypass; collaborators must have the module in `modulePermissions`. Applied per route via a `@RequireModule('ATTENDEES')` decorator.
- **`OwnerGuard`** ↔ `checkIsOwner`: owner-only routes (team management, settings, destructive event ops).
- **Public** routes (event discovery, public CFP, self-registration, ticket lookup) carry `@Public()` and skip the JWT guard.

Modules: `OVERVIEW`, `ATTENDEES`, `TICKETS`, `SCHEDULE`, `SPEAKERS`, `CFP`, `COMMUNICATIONS`, `CHECKIN` (assignable); `SETTINGS` is owner-only and not assignable.

---

## 4. Key request flows

### Self-service registration (concurrency-critical)

```mermaid
sequenceDiagram
  participant B as Buyer (public)
  participant Ctl as RegistrationsController
  participant S as RegistrationsService
  participant DB as PostgreSQL
  participant M as MailModule

  rect rgb(219, 234, 254)
    note over B,S: Public request
    B->>Ctl: POST /public/registrations { ticketTypeId, email, name }
    Ctl->>S: create(dto)
  end
  rect rgb(254, 243, 199)
    note over S,M: Transaction (row-level lock)
    S->>DB: BEGIN TX (row lock on TicketType)
    S->>DB: count tickets vs quantity, check saleStart/saleEnd
    alt sold out / outside sale window
      S-->>B: 409 / 422
    else available
      S->>DB: create Registration + Ticket (ticketNumber, qrCodeData)
      S->>DB: COMMIT
      S->>M: send confirmation email (QR)
      S-->>B: 201 registration + ticket
    end
  end
```

This is the one flow that **must** use a transaction with row-level locking to prevent
overselling; preserve it exactly when porting.

### Ticket assignment (optimistic locking)

`PATCH /tickets/{id}/assignee` compares the client's `expectedUpdatedAt` to the row's
`updatedAt`; mismatch → `409 Conflict`. Assignment is rejected after the event's
`assignmentCutoff*` window, and unassign is rejected once `isCheckedIn`.

### Check-in

`POST /events/{id}/check-in` accepts either a `ticketNumber` or `qrCodeData`, validates
the ticket belongs to the event, and is **idempotent** (re-scanning an already-checked-in
ticket returns its existing check-in rather than erroring).

---

## 5. Background jobs

Three scheduled jobs (current Vercel cron schedules shown). In NestJS, implement with
`@nestjs/schedule` `@Cron()` handlers, or keep them as `CRON_SECRET`-guarded HTTP
endpoints if an external scheduler is preferred.

```mermaid
graph TD
  subgraph Scheduler
    J1["close-expired-cfps — hourly (0 * * * *)"]
    J2["send-scheduled-campaigns — every 5 min (*/5 * * * *)"]
    J3["expire-invitations — every 15 min (0,15,30,45 * * * *)"]
  end
  J1 -->|CallForPapers status open→closed where deadline<now| DB[("PostgreSQL")]
  J2 -->|EmailCampaign status scheduled & scheduledFor<=now| DB
  J2 -->|batched send + retry/backoff| Resend["Resend"]
  J3 -->|Invitation PENDING & expiresAt<now → EXPIRED| DB
  J2 -. updates delivered/bounces/opens/clicks .-> Resend

  classDef db fill:#fef3c7,stroke:#f59e0b,color:#78350f;
  classDef ext fill:#f3e8ff,stroke:#a855f7,color:#581c87;
  classDef job fill:#ccfbf1,stroke:#14b8a6,color:#134e4a;
  class J1,J2,J3 job;
  class DB db;
  class Resend ext;
  style Scheduler fill:#f0fdfa,stroke:#14b8a6,color:#134e4a;
```

| Job | Schedule | Action |
|---|---|---|
| close-expired-cfps | `0 * * * *` | Close CFPs whose `deadline` has passed |
| send-scheduled-campaigns | `*/5 * * * *` | Send due `scheduled` campaigns via Resend (chunked ≤100, retry w/ backoff), update counts |
| expire-invitations | `0,15,30,45 * * * *` | Mark `PENDING` invitations past `expiresAt` as `EXPIRED` |

Webhook (inbound, not scheduled): `POST /webhooks/email` updates campaign
delivery metrics and attendee `emailStatus` from `delivered/bounced/opened/clicked/complained`
events. **Add provider signature verification** in the standalone service.

---

## 6. External integrations & configuration

```mermaid
graph LR
  Nest["NestJS API"]
  Nest --> PG[("PostgreSQL — DATABASE_URL")]
  Nest --> Resend["Resend — RESEND_API_KEY / RESEND_EMAIL_FROM"]
  Nest --> S3["Object storage — STORAGE_TYPE / S3_* / AWS_*"]
  Nest -. future .-> Stripe["Stripe — STRIPE_*"]
  Nest -. future .-> Paystack["Paystack — PAYSTACK_*"]
  Ext["External scheduler (optional)"] -->|CRON_SECRET| Nest

  classDef app fill:#dcfce7,stroke:#22c55e,color:#14532d;
  classDef db fill:#fef3c7,stroke:#f59e0b,color:#78350f;
  classDef ext fill:#f3e8ff,stroke:#a855f7,color:#581c87;
  classDef job fill:#ccfbf1,stroke:#14b8a6,color:#134e4a;
  classDef future fill:#f1f5f9,stroke:#94a3b8,color:#334155,stroke-dasharray:4 3;
  class Nest app;
  class PG db;
  class Resend,S3 ext;
  class Stripe,Paystack future;
  class Ext job;
```

**Storage** and **payment** are already abstracted behind adapter interfaces in the
source (`StorageAdapter`, `PaymentProcessor`). Port those interfaces directly as NestJS
providers so the local→S3 and free→Stripe/Paystack swaps stay configuration-driven.

**Email** is abstracted the same way — code to a `MailAdapter` interface, not to Resend.
This is **new** for the standalone service: the source `src/server/services/email.ts` is a
set of plain functions (`sendEmail`, `sendBatchEmails`, `sendBatchEmailsWithRetry`) that call
Resend directly. Port that behavior behind the interface, with `ResendMailAdapter` as the
first (and currently only) implementation:

```ts
interface MailAdapter {
  sendEmail(msg: EmailMessage): Promise<EmailResult>;
  sendBatch(msgs: EmailMessage[]): Promise<EmailResult[]>; // chunk ≤100, retry/backoff inside
}
// ResendMailAdapter is the first implementation (reads RESEND_API_KEY / RESEND_EMAIL_FROM).
// Bind it to the MailAdapter DI token; nothing outside integrations/mail/ references Resend.
```

The inbound delivery webhook is correspondingly provider-agnostic (`POST /webhooks/email`),
with provider-specific signature verification living inside the adapter.

Config groups (see `data-model.md` and the OpenAPI `securitySchemes`): database, auth
(`JWT_SECRET`/`AUTH_SECRET`), email, storage, payment (future), `CRON_SECRET`,
app URL, plus optional rate-limit/observability vars.

---

## 7. Suggested source layout

```text
src/
  main.ts                 # bootstrap + Swagger
  app.module.ts
  common/
    guards/               # JwtAuthGuard, EventAccessGuard, ModuleGuard, OwnerGuard
    decorators/           # @Public(), @RequireModule(), @CurrentUser()
    filters/              # exception → RFC7807 problem+json
  prisma/                 # PrismaModule + schema (reused from source)
  auth/                   # login, register, JWT strategy
  users/
  events/
  ticket-types/
  registrations/
  tickets/
  attendees/
  schedule/
  speakers/
  cfp/
  communications/
  team/
  check-in/
  jobs/                   # scheduled tasks + webhook controller
  integrations/
    mail/                 # MailAdapter interface + ResendMailAdapter
    storage/              # StorageAdapter (local/S3/R2)
    payment/              # PaymentProcessor (free/stripe/paystack)
```
