/** A team membership as returned by the API. */
export class TeamMemberResponseDto {
  /** Membership id (cuid). */
  id!: string;

  /** The event this membership belongs to. */
  eventId!: string;

  /** Linked user id, or null while the invite is still pending. */
  userId!: string | null;

  /** Member email (the invite target). */
  email!: string;

  /** `OWNER` | `COLLABORATOR`. */
  role!: string;

  /** `PENDING` | `ACTIVE` | `REMOVED`. */
  status!: string;

  /** Modules the collaborator may access (empty/ignored for owners). */
  modulePermissions!: string[];

  /** When the invite was sent. */
  invitedAt!: Date;

  /** Last time the member accessed the event, or null. */
  lastAccessedAt!: Date | null;
}

/** A pending invitation as returned by the API (token omitted). */
export class InvitationResponseDto {
  /** Invitation id (cuid). */
  id!: string;

  /** The event this invitation is for. */
  eventId!: string;

  /** Invitee email. */
  email!: string;

  /** Modules granted on acceptance. */
  modulePermissions!: string[];

  /** `PENDING` | `ACCEPTED` | `DECLINED` | `EXPIRED` | `CANCELLED`. */
  status!: string;

  /** When the invitation expires. */
  expiresAt!: Date;

  /** When it was sent. */
  sentAt!: Date;
}
