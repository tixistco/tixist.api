/**
 * Domain constants for the Registration model's plain-string columns. Reference
 * these named members instead of bare string literals.
 */

/** Payment lifecycle of a registration (`Registration.paymentStatus`). */
export const PaymentStatus = {
  Free: 'free',
  Pending: 'pending',
  Paid: 'paid',
  Failed: 'failed',
  Refunded: 'refunded',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUSES = Object.values(PaymentStatus);
