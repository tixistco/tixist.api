# Data Model — Standalone API

Source of truth: `prisma/schema.prisma` (PostgreSQL). This document describes every
entity backing the API, its fields, relationships, enums, JSON-typed columns, and the
indexes that matter for query design. It is written as the reference for porting the
schema into the standalone NestJS service (Prisma can be reused as-is, or the model can
be re-expressed in TypeORM/Drizzle — the relationships and constraints below are what
must be preserved).

## Conventions

- **IDs**: all domain entities use `cuid()` string primary keys. `Post` (boilerplate) uses an `Int` autoincrement.
- **Timestamps**: every domain entity has `createdAt` and `updatedAt`. All datetimes are stored in **UTC**; `Event.timezone` (IANA) is the display zone.
- **Soft vs hard delete**: `Event` supports soft delete (`isArchived` + `status='archived'`). Most other entities are hard-deleted with cascade rules (below).
- **Money**: stored as **`BigInt` in minor units** (base units — e.g. cents for USD), never as a float/decimal. `TicketType.price` is a `BigInt` count of the smallest currency unit. MVP constraint: must be `0` (free tickets only). Payment fields exist but are dormant. See [Money representation](#money-representation).
- **Optimistic concurrency**: `ScheduleEntry` and ticket assignment flows compare `updatedAt` to detect concurrent edits.

---

## Entity groups

1. **Auth & users** — `User`, `Account`, `Session`, `VerificationToken`
2. **Events & ticketing** — `Event`, `TicketType`, `Registration`, `Ticket`, `Attendee`
3. **Program** — `ScheduleEntry`, `Speaker`, `SpeakerSession`, `CallForPapers`, `CfpSubmission`
4. **Communication** — `EmailCampaign`
5. **Team & permissions** — `TeamMember`, `Invitation` (+ enums)
6. **Audit** — `AuditLog`
7. **Legacy / boilerplate** — `LegacyRegistration`, `Post` (do not port)

---

## 1. Auth & users

### User
The central principal. Acts as event **organizer**, **team member**, and optionally as a linked **attendee/registrant**.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| name | String? | |
| email | String? | **unique** |
| emailVerified | DateTime? | NextAuth |
| image | String? | avatar URL |
| password | String? | bcrypt hash (Credentials provider); null for pure-OAuth users |
| createdAt / updatedAt | DateTime | |

Relations: `accounts[]`, `sessions[]`, `posts[]`, `events[]` (as organizer), `registrations[]`, `attendees[]`, `teamMemberships[]` (`TeamMemberUser`), `invitedMembers[]` (`TeamMemberInviter`), `invitationsSent[]`, `auditLogs[]`.

> **NestJS note:** `Account`, `Session`, `VerificationToken` are NextAuth/Auth.js adapter tables. A standalone API will typically replace these with its own auth (JWT/OAuth). Keep `User` (and its `password` hash) and drop the adapter tables unless you reuse Auth.js.

### Account / Session / VerificationToken
NextAuth Prisma-adapter tables. `Account` stores OAuth provider tokens (`@@unique([provider, providerAccountId])`); `Session` stores DB sessions (`sessionToken @unique`); `VerificationToken` for email flows (`@@unique([identifier, token])`). All cascade-delete with the `User`.

---

## 2. Events & ticketing

### Event
Root aggregate. Almost every other entity hangs off an event and cascade-deletes with it.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| slug | String | **unique**, URL identifier |
| name | String | |
| description | String (Text) | |
| locationType | String | `in-person` \| `virtual` \| `hybrid` |
| locationAddress | String? | physical address |
| locationUrl | String? | virtual URL |
| timezone | String | IANA, default `UTC` |
| startDate / endDate | DateTime | UTC |
| status | String | `draft` \| `published` \| `archived` (default `draft`) |
| isArchived | Boolean | soft-delete flag (default false) |
| assignmentCutoffType | String | `event_start` \| `1h_before` \| `24h_before` \| `custom` |
| assignmentCutoffTime | DateTime? | used when `custom` |
| maxTicketsPerPurchase | Int | default 10 |
| customFields | Json? | `CustomFieldDefinition[]` — see [JSON shapes](#json-typed-columns) |
| organizerId | String | FK → User (`onDelete: Restrict`) |

Relations: `ticketTypes[]`, `registrations[]`, `tickets[]`, `scheduleEntries[]`, `callForPapers?` (1:1), `speakers[]`, `emailCampaigns[]`, `teamMembers[]`, `invitations[]`, `auditLogs[]`.

Indexes: `organizerId`, `slug`, `(status, isArchived)`, `startDate`, `(organizerId, status)`.

### TicketType
A purchasable ticket tier within an event.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | FK → Event (**cascade**) |
| name | String | |
| description | String (Text) | |
| price | BigInt | **minor units** (e.g. kobo for NGN); default `0`; MVP requires `0` |
| currency | String | ISO 4217, default `NGN`; determines the minor-unit exponent |
| quantity | Int | total inventory |
| saleStart / saleEnd | DateTime? | null = no restriction |

Relations: `registrations[]`, `tickets[]`. Indexes: `eventId`, `(eventId, saleStart, saleEnd)`.

> **Inventory is derived, not stored.** "Available" = `quantity − count(tickets)`. Concurrency-safe registration relies on row-level locking around this count (see registration flow in the OpenAPI notes).

### Registration
A **purchase / order** made by a buyer. One registration can spawn multiple tickets (`quantity`).

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | FK → Event (**cascade**) |
| ticketTypeId | String | FK → TicketType (`Restrict`) |
| email | String | buyer email |
| name | String | buyer name |
| userId | String? | optional FK → User (`SetNull`) |
| quantity | Int | default 1 |
| paymentStatus | String | `free` \| `pending` \| `paid` \| `failed` \| `refunded` |
| paymentIntentId | String? | Stripe/Paystack (dormant) |
| paymentProcessor | String? | `stripe` \| `paystack` \| null |
| registeredAt / updatedAt | DateTime | |

Relations: `tickets[]`. Indexes: `eventId`, `ticketTypeId`, `email`, `userId`, `(eventId, ticketTypeId)`, `registeredAt`.

### Ticket
An **individual admission token** (one per seat). Carries the QR identity and check-in state.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| registrationId | String | FK → Registration (**cascade**) |
| eventId | String | FK → Event (**cascade**) |
| ticketTypeId | String | FK → TicketType (`Restrict`) |
| ticketNumber | String | **unique**, e.g. `EVT-2025-ABC123` |
| qrCodeData | String | **unique**, payload encoded in QR |
| isAssigned | Boolean | default false |
| assignedAt | DateTime? | |
| attendeeId | String? | **unique** FK → Attendee (`SetNull`) — 1:1 |
| isCheckedIn | Boolean | default false |
| checkedInAt | DateTime? | |
| checkedInBy | String? | staff/device id |

Indexes: `registrationId`, `eventId`, `ticketTypeId`, `attendeeId`, `ticketNumber`, `(eventId, isCheckedIn)`, `(eventId, isAssigned)`, `qrCodeData`.

> **Lifecycle:** created (unassigned) → assigned to an `Attendee` → checked in. Unassign is blocked once checked in. Assignment is gated by the event's `assignmentCutoff*` config.

### Attendee
The **person who will attend** (distinct from the buyer). Holds custom-field answers and email deliverability state. 1:1 with `Ticket`.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| name | String | |
| email | String | |
| customData | Json? | `CustomFieldResponses` — answers keyed by field id |
| emailStatus | String | `active` \| `bounced` \| `unsubscribed` |
| userId | String? | optional FK → User (`SetNull`) |

Relations: `ticket?` (back-reference). Indexes: `email`, `userId`, `emailStatus`.

> **Buyer vs attendee** is the key modelling decision: `Registration` = who paid; `Attendee` = who attends. This separation lets one buyer purchase many tickets and assign each to a different person.

---

## 3. Program (schedule, speakers, CFP)

### ScheduleEntry
A session/agenda item.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | FK → Event (**cascade**) |
| title | String | |
| description | String (Text) | |
| startTime / endTime | DateTime | UTC |
| location | String? | room/stage |
| track | String? | multi-track name |
| trackColor | String? | hex color |
| sessionType | String? | `keynote` \| `talk` \| `workshop` \| `break` \| `networking` |

Relations: `speakerSessions[]`. Indexes: `eventId`, `startTime`, `(eventId, startTime)`, `(eventId, track)`. `updatedAt` is used for optimistic concurrency on edits/overlap checks.

### Speaker
A speaker profile attached to an event.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | FK → Event (**cascade**) |
| name | String | |
| bio | String (Text) | |
| email | String | |
| photo | String? | |
| twitter / github / linkedin / website | String? | social links |

Relations: `speakerSessions[]`, `cfpSubmissions[]`. Indexes: `eventId`, `email`.

### SpeakerSession (join)
Many-to-many between `Speaker` and `ScheduleEntry` with a role.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| scheduleEntryId | String | FK → ScheduleEntry (**cascade**) |
| speakerId | String | FK → Speaker (**cascade**) |
| role | String? | `speaker` \| `moderator` \| `panelist` (default `speaker`) |

Constraint: `@@unique([scheduleEntryId, speakerId])`. Indexes on both FKs.

### CallForPapers
One CFP per event (`eventId @unique` → 1:1).

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | **unique** FK → Event (**cascade**) |
| guidelines | String (Text) | |
| deadline | DateTime | |
| status | String | `open` \| `closed` (default `open`) |
| requiredFields | Json? | which optional speaker fields are required — see JSON shapes |

Relations: `submissions[]`. Index: `(status, deadline)` (drives the cron that auto-closes expired CFPs).

### CfpSubmission
A proposal submitted to a CFP. May be promoted into a `Speaker` on acceptance.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | denormalized event id |
| cfpId | String | FK → CallForPapers (**cascade**) |
| title | String | |
| description | String (Text) | |
| sessionFormat | String | `talk` \| `workshop` \| `panel` \| `lightning` |
| duration | Int | minutes |
| speakerName / speakerEmail / speakerBio | String | bio is Text |
| speakerPhoto | String? | |
| speakerTwitter / speakerGithub / speakerLinkedin / speakerWebsite | String? | |
| status | String | `pending` \| `accepted` \| `rejected` (default `pending`) |
| reviewNotes | String? (Text) | |
| reviewScore | Int? | 1–5 |
| speakerId | String? | FK → Speaker (`SetNull`), set on acceptance |
| submittedAt / reviewedAt? / updatedAt | DateTime | |

Indexes: `cfpId`, `status`, `speakerEmail`, `(cfpId, status)`, `submittedAt`.

---

## 4. Communication

### EmailCampaign
A broadcast email to a recipient segment, with delivery analytics fed by the email-provider webhook.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | FK → Event (**cascade**) |
| subject | String | |
| body | String (Text) | HTML |
| recipientType | String | `all_attendees` \| `ticket_type` \| `speakers` \| `custom` |
| recipientFilter | Json? | segment params — see JSON shapes |
| status | String | `draft` \| `scheduled` \| `sending` \| `sent` \| `failed` |
| scheduledFor | DateTime? | future send time |
| sentAt | DateTime? | |
| totalRecipients | Int? | |
| delivered / bounces / opens / clicks | Int | default 0; incremented by webhook |
| provider | String? | email provider, e.g. `resend` |
| providerBatchId | String? | provider's batch handle |

Indexes: `eventId`, `(status, scheduledFor)` (drives the scheduled-send cron), `status`, `createdAt`.

---

## 5. Team & permissions

### Enums

```text
TeamRole          = OWNER | COLLABORATOR
TeamMemberStatus  = PENDING | ACTIVE | REMOVED
InvitationStatus  = PENDING | ACCEPTED | DECLINED | EXPIRED | CANCELLED
```

**Module permissions** (`String[]` on TeamMember/Invitation) are drawn from
`MODULE_NAMES`: `OVERVIEW`, `ATTENDEES`, `TICKETS`, `SCHEDULE`, `SPEAKERS`, `CFP`,
`COMMUNICATIONS`, `CHECKIN`. `SETTINGS` is intentionally **not** assignable — it is
owner-only. Owners implicitly have all modules; collaborators are gated to the modules
in their array.

### TeamMember
A user's membership in an event's team.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | FK → Event (**cascade**) |
| userId | String? | FK → User (`SetNull`); null until invite accepted |
| email | String | always present |
| role | TeamRole | default `COLLABORATOR` |
| status | TeamMemberStatus | default `PENDING` |
| modulePermissions | String[] | default `[]` |
| invitedById | String | FK → User (`Restrict`) |
| invitedAt / lastAccessedAt? | DateTime | |

Constraints: `@@unique([eventId, email])`, `@@unique([eventId, userId])`. Indexes: `eventId`, `userId`, `email`, `status`, `(eventId, status)`, `(eventId, userId)`, `(eventId, role)`.

### Invitation
A pending invite carrying a secure token (7-day expiry).

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| eventId | String | FK → Event (**cascade**) |
| email | String | |
| token | String | **unique**, `crypto.randomBytes(32)` base64url |
| modulePermissions | String[] | default `[]` |
| status | InvitationStatus | default `PENDING` |
| expiresAt | DateTime | now + 7 days |
| sentById | String | FK → User (`Restrict`) |
| sentAt / respondedAt? | DateTime | |

Indexes: `token`, `eventId`, `email`, `(status, expiresAt)` (drives the expiry cron), `(eventId, status)`.

---

## 6. Audit

### AuditLog
Append-only trail. Stores `userEmail` separately so history survives user deletion.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| action | AuditAction (enum) | see below |
| description | String (Text) | |
| userId | String? | FK → User (`SetNull`); null for system actions |
| userEmail | String? | historical record |
| eventId | String? | FK → Event (**cascade**) |
| metadata | Json? | `{ targetUserId, targetEmail, modulePermissions, previousPermissions, ... }` |
| ipAddress / userAgent | String? | request context |
| createdAt | DateTime | |

`AuditAction` currently covers team actions: `TEAM_INVITE_SENT`, `TEAM_INVITE_ACCEPTED`, `TEAM_INVITE_DECLINED`, `TEAM_INVITE_CANCELLED`, `TEAM_INVITE_RESENT`, `TEAM_INVITE_EXPIRED`, `TEAM_PERMISSIONS_UPDATED`, `TEAM_MEMBER_REMOVED`. The schema comments mark event/CFP actions as future additions.

Indexes: `(eventId, createdAt)`, `(userId, createdAt)`, `(action, createdAt)`, `createdAt`.

---

## 7. Legacy / boilerplate — do **not** port

- **`LegacyRegistration`** — pre-migration table that mixed buyer/attendee data. Superseded by `Registration` + `Attendee`. Excluded from the standalone API.
- **`Post`** — T3 starter boilerplate. Excluded.

---

## JSON-typed columns

These are stored as `Json` in Postgres but have well-defined TypeScript shapes
(`src/lib/validators/custom-fields.ts` and the router input schemas). In NestJS, model
these as class-validator DTOs / Zod schemas and validate on the way in.

### `Event.customFields` → `CustomFieldDefinition[]`
```ts
type CustomFieldType = "text" | "textarea" | "select" | "checkbox" | "radio";

interface CustomFieldDefinition {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  placeholder?: string;    // text/textarea
  options?: string[];      // select/radio/checkbox
  pattern?: string;        // regex, text/textarea
  minLength?: number;      // text/textarea
  maxLength?: number;      // text/textarea
  minSelections?: number;  // checkbox
  maxSelections?: number;  // checkbox
  helpText?: string;
}
```

### `Attendee.customData` → `CustomFieldResponses`
```ts
type CustomFieldValue = string | boolean | string[];
type CustomFieldResponses = Record<string /* field id */, CustomFieldValue>;
```
Validated against the event's `customFields` definitions at registration/assignment time.

### `CallForPapers.requiredFields`
Flags marking which otherwise-optional submission fields are mandatory:
```ts
interface CfpRequiredFields {
  bio?: boolean;
  sessionFormat?: boolean;
  duration?: boolean;
  photo?: boolean;
}
```

### `EmailCampaign.recipientFilter`
Shape depends on `recipientType`:
- `all_attendees` — null / ignored
- `ticket_type` — `{ ticketTypeId: string }` (or `ticketTypeIds: string[]`)
- `speakers` — null / ignored
- `custom` — `{ emails: string[] }` and/or `{ emailStatus?: "active" | "bounced" | "unsubscribed" }`

### `AuditLog.metadata`
Free-form context object, e.g. `{ targetUserId, targetEmail, modulePermissions, previousPermissions }`.

---

## Money representation

All monetary values are stored as **`BigInt` counts of the currency's minor unit**
(base units), never as floats or decimals. This eliminates floating-point rounding
error entirely — arithmetic is exact integer math.

- **Storage**: `TicketType.price` is `BigInt` → Postgres `BIGINT`. A price of ₦2,500.00
  is stored as `250000` (kobo). Default `0`; MVP requires `0` (free tickets).
- **Currency**: `TicketType.currency` is an ISO 4217 code, default **`NGN`**. The code
  determines the **minor-unit exponent** (decimal places) used to render a human amount:
  | Currency | Minor unit | Exponent | `100000` renders as |
  |---|---|---|---|
  | NGN | kobo | 2 | ₦1,000.00 |
  | USD | cent | 2 | $1,000.00 |
  | JPY | yen | 0 | ¥100,000 |
  | KWD | fils | 3 | KWD 100.000 |
  Keep an exponent lookup (e.g. `Intl.NumberFormat` / a currency table) at the
  presentation layer; the API and DB only ever deal in integer minor units.
- **Wire format (JSON)**: serialize as a **decimal string of the integer minor-unit
  amount** (e.g. `"250000"`), not a JSON number. `BigInt` exceeds the safe integer range
  of IEEE-754 doubles, so a string avoids precision loss in any JSON client. Parse to
  `BigInt`/`bigint` on the way in. (Ticket prices won't realistically exceed 2^53, but
  using strings keeps the contract uniform with the future payment amounts.)
- **Future payment fields** (`Registration.payment*`, `PaymentProcessor` amounts) follow
  the same rule — the existing payment interface already specifies amounts in "smallest
  currency unit", so this is consistent end-to-end.

> **Prisma note:** `price BigInt @default(0)`. The generated client returns JS `bigint`;
> add a serializer (e.g. a NestJS interceptor or `superjson`) so `bigint` → string at the
> HTTP boundary, since `JSON.stringify` throws on `bigint` by default.

---

## Relationship & cascade summary

```text
User ──< Event (organizer, Restrict)
Event ──< TicketType ──< Registration ──< Ticket >── Attendee (1:1)
Event ──< Ticket            (denormalized FK, cascade)
Event ──1 CallForPapers ──< CfpSubmission >── Speaker (SetNull on accept)
Event ──< Speaker ──< SpeakerSession >── ScheduleEntry
Event ──< ScheduleEntry
Event ──< EmailCampaign
Event ──< TeamMember >── User
Event ──< Invitation
Event ──< AuditLog
```

Cascade rules to preserve when porting:
- Deleting an **Event** cascades to ticket types, registrations, tickets, schedule, CFP, submissions, speakers, campaigns, team members, invitations, and audit logs.
- Deleting a **Registration** cascades to its tickets.
- `TicketType` and `CfpSubmission→Speaker` use **Restrict / SetNull** to avoid orphaning paid/accepted data — keep these exact semantics.
- `User` deletion uses `Restrict` on `Event.organizer` (cannot delete a user who still owns events — mirrored by the `user.deleteAccount` precondition).
