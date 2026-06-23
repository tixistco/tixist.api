import { AssignmentCutoffType } from './event.constants';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The event fields that determine the ticket-assignment cutoff. */
export interface CutoffConfig {
  assignmentCutoffType: string;
  assignmentCutoffTime: Date | null;
  startDate: Date;
}

/**
 * The instant after which tickets can no longer be (un)assigned. Derived from the
 * event's cutoff policy; `custom` falls back to `startDate` if no time is set.
 */
export function assignmentCutoffTime(event: CutoffConfig): Date {
  switch (event.assignmentCutoffType) {
    case AssignmentCutoffType.OneHourBefore:
      return new Date(event.startDate.getTime() - HOUR_MS);
    case AssignmentCutoffType.TwentyFourHoursBefore:
      return new Date(event.startDate.getTime() - DAY_MS);
    case AssignmentCutoffType.Custom:
      return event.assignmentCutoffTime ?? event.startDate;
    case AssignmentCutoffType.EventStart:
    default:
      return event.startDate;
  }
}

/** Whether the assignment window has closed at `now`. */
export function isAssignmentClosed(
  event: CutoffConfig,
  now: Date = new Date(),
): boolean {
  return now >= assignmentCutoffTime(event);
}
