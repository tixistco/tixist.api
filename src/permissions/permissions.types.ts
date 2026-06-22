import { TeamMember } from '@prisma/client';

/**
 * Assignable event modules (SETTINGS is intentionally owner-only and not listed).
 * Reference `Module.Tickets` etc. instead of bare `'TICKETS'` literals.
 */
export const Module = {
  Overview: 'OVERVIEW',
  Attendees: 'ATTENDEES',
  Tickets: 'TICKETS',
  Schedule: 'SCHEDULE',
  Speakers: 'SPEAKERS',
  Cfp: 'CFP',
  Communications: 'COMMUNICATIONS',
  Checkin: 'CHECKIN',
} as const;

export type ModuleName = (typeof Module)[keyof typeof Module];

export const MODULE_NAMES = Object.values(Module);

/** The membership context resolved for the current request. */
export interface MembershipContext {
  membership: TeamMember;
  isOwner: boolean;
}
