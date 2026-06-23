/** An event as returned by the API. */
export class EventResponseDto {
  /** Unique event identifier (cuid). */
  id!: string;

  /** URL-friendly unique identifier. */
  slug!: string;

  /** Event name. */
  name!: string;

  /** Long description. */
  description!: string;

  /** `in-person` | `virtual` | `hybrid`. */
  locationType!: string;

  /** Physical address (null unless in-person/hybrid). */
  locationAddress!: string | null;

  /** Virtual join URL (null unless virtual/hybrid). */
  locationUrl!: string | null;

  /** IANA timezone. */
  timezone!: string;

  /** Start instant (UTC). */
  startDate!: Date;

  /** End instant (UTC). */
  endDate!: Date;

  /** `draft` | `published` | `archived`. */
  status!: string;

  /** Soft-delete flag. */
  isArchived!: boolean;

  /** When ticket assignment closes. */
  assignmentCutoffType!: string;

  /** Custom cutoff instant (null unless `assignmentCutoffType` is `custom`). */
  assignmentCutoffTime!: Date | null;

  /** Maximum tickets per purchase. */
  maxTicketsPerPurchase!: number;

  /** Custom registration field definitions, or null. */
  customFields!: unknown;

  /** Owning user id. */
  organizerId!: string;

  /** Creation timestamp. */
  createdAt!: Date;

  /** Last-update timestamp. */
  updatedAt!: Date;
}

/** Counts of the caller's events grouped by lifecycle status. */
export class EventStatusCountsDto {
  /** Number of draft events. */
  draft!: number;

  /** Number of published events. */
  published!: number;

  /** Number of archived events. */
  archived!: number;
}

/** Dashboard metrics for a single event. */
export class EventMetricsDto {
  /** Total registrations (orders). */
  totalRegistrations!: number;

  /** Total tickets issued. */
  totalTickets!: number;

  /** Tickets assigned to an attendee. */
  assignedTickets!: number;

  /** Tickets checked in. */
  checkedInTickets!: number;

  /** Number of ticket tiers. */
  ticketTypeCount!: number;
}
