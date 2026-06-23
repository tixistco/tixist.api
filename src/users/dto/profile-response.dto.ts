/** The authenticated user's own profile, as returned by `/me`. */
export class ProfileResponseDto {
  /** Unique user identifier (cuid). */
  id!: string;

  /** Email address (may be null for accounts without one). */
  email!: string | null;

  /** Display name (may be null). */
  name!: string | null;

  /** Avatar image URL (may be null). */
  image!: string | null;

  /** When the email was verified, or null if still unverified. */
  emailVerified!: Date | null;

  /** Account creation timestamp. */
  createdAt!: Date;
}

/** Profile plus rollups (returned by `GET /me`). */
export class ProfileWithCountsDto extends ProfileResponseDto {
  /** How many events the user organizes. */
  eventCount!: number;

  /** How many registrations the user has made. */
  registrationCount!: number;
}

/** Organizer rollup across the user's events (`GET /me/events-summary`). */
export class EventsSummaryDto {
  /** All events the user organizes. */
  totalEvents!: number;

  /** Published, non-archived events. */
  activeEvents!: number;

  /** Archived events. */
  archivedEvents!: number;

  /** Total attendees across the user's events. */
  totalAttendees!: number;
}
