/**
 * Domain constants for the Event model's plain-string columns (stored as `String`,
 * enforced in the app layer — see the enum-strategy decision). Reference these named
 * members instead of bare string literals so a typo is a compile error, not a silent bug.
 */

/** Event lifecycle status (`Event.status`). */
export const EventStatus = {
  Draft: 'draft',
  Published: 'published',
  Archived: 'archived',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];
export const EVENT_STATUSES = Object.values(EventStatus);

/** Where an event takes place (`Event.locationType`). */
export const LocationType = {
  InPerson: 'in-person',
  Virtual: 'virtual',
  Hybrid: 'hybrid',
} as const;
export type LocationType = (typeof LocationType)[keyof typeof LocationType];
export const LOCATION_TYPES = Object.values(LocationType);

/** When ticket assignment closes (`Event.assignmentCutoffType`). */
export const AssignmentCutoffType = {
  EventStart: 'event_start',
  OneHourBefore: '1h_before',
  TwentyFourHoursBefore: '24h_before',
  Custom: 'custom',
} as const;
export type AssignmentCutoffType =
  (typeof AssignmentCutoffType)[keyof typeof AssignmentCutoffType];
export const ASSIGNMENT_CUTOFF_TYPES = Object.values(AssignmentCutoffType);
