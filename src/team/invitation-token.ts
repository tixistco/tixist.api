import { randomBytes } from 'node:crypto';

/** Days a team invitation stays valid. */
export const INVITATION_EXPIRY_DAYS = 7;

/** A high-entropy, URL-safe invitation token (43 chars, like the source app). */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url').slice(0, 43);
}

/** Expiry instant for a freshly-created invitation, relative to `now`. */
export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}
