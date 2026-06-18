# tix-ist API 🎟️

**Standalone event-management API** — the API-first backend for tix-ist, built with
[NestJS](https://nestjs.com/). It exposes a resource-oriented REST surface (documented as
OpenAPI) for events, ticketing, attendees, schedules, speakers, CFP, communications, team
collaboration, and check-in.

This service is extracted from the original [T3-stack web app](https://github.com/babblebey/events-ting) — its
74 tRPC procedures and REST routes are being re-implemented here as framework-agnostic
REST endpoints. See **[`docs/`](./docs/)** for the full design.

> **Project status:** early build. The NestJS app is scaffolded and the design docs
> (data model, architecture, OpenAPI contract) are complete. Feature modules, Prisma, and
> JWT auth are being implemented against the contract. Items marked _(planned)_ below are
> specified in `docs/` but not yet wired up.

---

## ✨ Capabilities

- **🎪 Events** — create/manage events, custom registration fields, draft→published→archived lifecycle
- **🎟️ Ticketing & Registration** — ticket types and concurrency-safe self-registration (free tickets MVP)
- **🎫 Tickets & Assignment** — per-attendee tickets, QR identity, optimistic-locked assignment
- **✅ Check-In** — idempotent check-in by ticket number or QR, with live metrics
- **📅 Schedule** — sessions, tracks, and speaker assignments with overlap detection
- **📢 Call for Papers** — public proposal submission, review, accept/reject → speaker creation
- **🎤 Speakers** — speaker profiles and session assignments
- **👥 Team Collaboration** — invite collaborators with granular, module-based permissions
- **📧 Email Campaigns** — segmented broadcasts with delivery analytics (Resend)
- **🔒 Auth & RBAC** _(planned)_ — JWT auth + event-scoped owner/collaborator module permissions
- **⏱️ Background Jobs** _(planned)_ — close expired CFPs, send scheduled campaigns, expire invitations

---

## 🏗️ Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | [NestJS 11](https://nestjs.com/) (Express platform) |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) |
| **API style** | REST, documented via [OpenAPI 3.1](./docs/openapi.yaml) (Swagger _planned_) |
| **Database** | [PostgreSQL](https://www.postgresql.org/) via [Prisma](https://www.prisma.io/) _(planned)_ |
| **Auth** | JWT bearer + event/module RBAC guards _(planned)_ |
| **Validation** | DTOs (class-validator / Zod) _(planned)_ |
| **Email** | Pluggable adapter — [Resend](https://resend.com/) (first impl) _(planned)_ |
| **Storage** | Pluggable adapter — local / S3 / R2 _(planned)_ |
| **Payments** | Pluggable processor — free (MVP); Stripe/Paystack _(future)_ |
| **Scheduler** | [@nestjs/schedule](https://docs.nestjs.com/techniques/task-scheduling) _(planned)_ |
| **Package Manager** | [Yarn](https://yarnpkg.com/) |
| **Testing** | [Jest](https://jestjs.io/) (unit + e2e) |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **Yarn** 1.22+ (`npm install -g yarn`)
- **PostgreSQL** 14+ _(once the persistence layer lands)_

### Installation

```bash
# 1. Install dependencies
yarn install

# 2. Set up environment variables
cp .env.example .env   # (planned) — see Environment Variables below

# 3. Start the development server
yarn start:dev
```

The API listens on **http://localhost:3000** by default (configurable via `PORT`).

### Environment Variables

Configuration groups for the full service (see [`docs/architecture.md`](./docs/architecture.md#6-external-integrations--configuration)):

```bash
# Core
PORT="3000"
APP_URL="http://localhost:3000"

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/events_ting"

# Auth (JWT)
JWT_SECRET="generate-with: openssl rand -base64 32"

# Email (Resend)
RESEND_API_KEY="re_..."          # https://resend.com
RESEND_EMAIL_FROM="no-reply@yourdomain.com"

# Storage (local | s3 | r2)
STORAGE_TYPE="local"
# AWS_REGION / S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  (when STORAGE_TYPE=s3)

# Background jobs
CRON_SECRET="bearer-token-for-scheduler-triggered-endpoints"
```

> **Money & currency:** monetary amounts are stored and exchanged as **integer minor
> units** (BigInt; e.g. kobo), defaulting to **NGN** — never floats. See
> [`docs/data-model.md`](./docs/data-model.md#money-representation).

---

## 📂 Project Structure

Current scaffold plus the target layout from the architecture doc (planned modules in _italics_):

```
src/
├── main.ts                  # Bootstrap (+ Swagger, planned)
├── app.module.ts            # Root module
├── app.controller.ts        # Scaffold controller
├── app.service.ts           # Scaffold service
│
│  # ── Planned (per docs/architecture.md §7) ──
├── common/                  # Guards (JWT, EventAccess, Module, Owner), decorators, filters
├── prisma/                  # PrismaModule + schema (ported from source)
├── auth/                    # Login, register, JWT strategy
├── users/
├── events/
├── ticket-types/
├── registrations/
├── tickets/
├── attendees/
├── schedule/
├── speakers/
├── cfp/
├── communications/
├── team/
├── check-in/
├── jobs/                    # Scheduled tasks + email webhook controller
└── integrations/
    ├── mail/                # MailAdapter interface + ResendMailAdapter
    ├── storage/             # StorageAdapter (local/S3/R2)
    └── payment/             # PaymentProcessor (free/stripe/paystack)

docs/                        # Design documentation (see below)
test/                        # Jest e2e tests
```

---

## 🛠️ Development

### Available Commands

```bash
# Development
yarn start                # Start the app
yarn start:dev            # Start in watch mode
yarn start:debug          # Start in watch + debug mode
yarn start:prod           # Run the compiled build (dist/main)
yarn build                # Compile to dist/

# Code Quality
yarn lint                 # ESLint (with --fix)
yarn format               # Prettier

# Tests
yarn test                 # Unit tests
yarn test:watch           # Unit tests (watch)
yarn test:cov             # Coverage
yarn test:e2e             # End-to-end tests
```

### Working from the contract

The OpenAPI spec is the source of truth for endpoints. Validate or generate types from it:

```bash
npx @redocly/cli lint docs/openapi.yaml                 # validate the contract
npx @redocly/cli preview-docs docs/openapi.yaml         # browse it locally
npx openapi-typescript docs/openapi.yaml -o src/generated/api-types.ts
```

---

## 📖 Documentation

The design docs in **[`docs/`](./docs/)** are the blueprint for this service:

- **[Docs index](./docs/README.md)** — overview, design decisions, and known gaps
- **[Data Model](./docs/data-model.md)** — every entity, relation, enum, JSON shape, index, and cascade rule
- **[Architecture](./docs/architecture.md)** — current vs. target design, NestJS module decomposition, auth/RBAC and request flows, background jobs (with colour-coded diagrams)
- **[OpenAPI Contract](./docs/openapi.yaml)** — 105 operations across 84 paths; the REST endpoint contract

---

## 🚢 Deployment

Build and run the compiled service:

```bash
yarn build
yarn start:prod           # node dist/main
```

For production, use a managed PostgreSQL service (e.g. [Neon](https://neon.tech/),
[Supabase](https://supabase.com/), [Railway](https://railway.app/)). Container and
platform deployment notes will be added as the service matures.

---

## 🤝 Contributing

1. **Create a feature branch**: `git checkout -b feat/your-feature`
2. **Implement against the contract** in `docs/openapi.yaml` and the data model
3. **Run checks**: `yarn lint && yarn test`
4. **Commit**: `git commit -m "feat: your feature description"`
5. **Open a Pull Request**
