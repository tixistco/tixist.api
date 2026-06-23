/** Domain constants for the Attendee model's plain-string columns. */

/** Email deliverability state (`Attendee.emailStatus`). */
export const EmailStatus = {
  Active: 'active',
  Bounced: 'bounced',
  Unsubscribed: 'unsubscribed',
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];
export const EMAIL_STATUSES = Object.values(EmailStatus);
