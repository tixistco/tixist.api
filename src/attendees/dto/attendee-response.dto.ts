/** An attendee as returned to organizers. */
export class AttendeeResponseDto {
  /** Unique attendee id (cuid). */
  id!: string;

  /** Attendee name. */
  name!: string;

  /** Attendee email. */
  email!: string;

  /** Answers to the event's custom fields, or null. */
  customData!: unknown;

  /** `active` | `bounced` | `unsubscribed`. */
  emailStatus!: string;

  /** The linked ticket (light context). */
  ticket!: {
    id: string;
    eventId: string;
    ticketNumber: string;
    isCheckedIn: boolean;
  } | null;

  /** Creation timestamp. */
  createdAt!: Date;
}
