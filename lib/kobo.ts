/** Convert kobo amount to naira (integer division) */
export function koboToNaira(kobo: number): number {
  return Math.floor(kobo / 100)
}

/** Format kobo amount as a Naira currency string (e.g. ₦12,500) */
export function formatNaira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString('en-NG')}`
}

/** Convert naira amount to kobo (integer) */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100)
}

/** The exact Naira amount Flutterwave should charge for a kobo price. Not floored — flooring
 *  here while comparing with a non-rounded expectation elsewhere rejects orders the buyer paid for. */
export function koboToChargeableNaira(kobo: number): number {
  return kobo / 100
}

/** How a provider-confirmed amount compares with the authoritative price stored on the order. */
export type PaymentAssessment = 'UNDERPAID' | 'PAID_IN_FULL' | 'OVERPAID'

/** The single amount-comparison decision used by every payment-resolution path.
 *
 *  Flutterwave reports Naira as a decimal, so the comparison is converted to integer kobo
 *  before it is made. Comparing decimals directly risks float error at the boundary — an
 *  `amount >= required` test in Naira can both reject a payment that covered the price exactly
 *  and silently accept one that paid too much.
 *
 *  Overpayment is a distinct outcome, not a success: SellSnap's business rule is that a payment
 *  above the authoritative price is reversed in full rather than fulfilled. */
export function assessPayment(paidNaira: number, requiredKobo: number): PaymentAssessment {
  if (!Number.isFinite(paidNaira) || paidNaira < 0) return 'UNDERPAID'

  const paidKobo = nairaToKobo(paidNaira)

  if (paidKobo < requiredKobo) return 'UNDERPAID'
  if (paidKobo > requiredKobo) return 'OVERPAID'
  return 'PAID_IN_FULL'
}
