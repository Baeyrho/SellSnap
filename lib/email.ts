import nodemailer, { type Transporter } from 'nodemailer'

import { logWarn } from '@/lib/logger'

const DEFAULT_FROM = 'SellSnap <noreply@sellsnap.com>'
const DEFAULT_SMTP_PORT = 587
const IMPLICIT_TLS_PORT = 465

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape untrusted values before interpolating them into an HTML email body. Product and customer names are user-supplied, so raw interpolation would let a seller inject markup into buyer inboxes. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST)
}

function getSmtpPort(): number {
  const parsed = Number(process.env.SMTP_PORT)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SMTP_PORT
}

let cachedTransporter: Transporter | null = null

/** Build the transporter on first use so an unconfigured environment never constructs a broken transport at import time. */
function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter

  const port = getSmtpPort()

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Port 465 negotiates TLS immediately; every other port upgrades via STARTTLS, which we require so a reset token can never be sent in cleartext.
    secure: port === IMPLICIT_TLS_PORT,
    requireTLS: port !== IMPLICIT_TLS_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  return cachedTransporter
}

interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

/** Send a single message. Callers own error handling so a mail failure never blocks a payment transition.
 *
 *  An unconfigured SMTP relay is not an error the caller can act on, but it must not be invisible
 *  either: in production it means every buyer receipt and every seller notification is being
 *  silently dropped while the payment itself succeeds. The structured warning is the signal, since
 *  it is greppable and carries the recipient that never got told. */
async function sendEmail({ to, subject, html, text }: EmailMessage): Promise<void> {
  if (!isSmtpConfigured()) {
    logWarn('email.smtp_not_configured', { to, subject })
    return
  }

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || DEFAULT_FROM,
    to,
    subject,
    text,
    html,
  })
}

/**
 * Where operational alerts go. Defaults to the SMTP sender so a deployment with no explicit
 * operator mailbox still surfaces problems to whoever owns the sending domain, rather than nowhere.
 */
function getAlertRecipient(): string | undefined {
  return process.env.OPS_ALERT_EMAIL || process.env.SMTP_FROM || undefined
}

/**
 * Alert the operator that money needs a human decision.
 *
 * Used for conditions SellSnap deliberately refuses to resolve on its own — a confirmed payment
 * against an already-closed order, a reversal it could not raise, a cron that has stopped working.
 * It is advisory: every caller wraps it so an alert failure cannot affect a payment transition, and
 * it is sent to an operator address, never to a buyer.
 *
 * Exported from the email module so the operational runbook and the cron share one definition of
 * what an alert looks like.
 */
export async function sendOperationalAlertEmail(subject: string, lines: string[]): Promise<void> {
  const to = getAlertRecipient()

  // With no operator address configured there is nowhere to send this. The log line is the only
  // remaining signal, so it is emitted rather than dropped.
  if (!to) {
    logWarn('email.operational_alert_unrouted', { subject, lineCount: lines.length })
    return
  }

  const body = lines.join('\n')

  await sendEmail({
    to,
    subject: `[SellSnap] ${subject}`,
    text: body,
    html: `<pre style="white-space:pre-wrap;font-family:monospace">${escapeHtml(body)}</pre>`,
  })
}

interface OrderEmailParams {
  to: string
  productName: string
  amountFormatted: string
  transactionRef: string
  customerName?: string
}

/** Send order confirmation email to the buyer */
export async function sendOrderConfirmationEmail({
  to,
  productName,
  amountFormatted,
  transactionRef,
  customerName,
}: OrderEmailParams): Promise<void> {
  const safeProduct = escapeHtml(productName)
  const safeCustomer = escapeHtml(customerName || 'there')

  await sendEmail({
    to,
    subject: `Payment Confirmed — ${productName}`,
    text: [
      'Payment Confirmed!',
      '',
      `Hi ${customerName || 'there'},`,
      `Your payment for ${productName} has been received.`,
      '',
      `Amount: ${amountFormatted}`,
      `Reference: ${transactionRef}`,
      '',
      'The seller has been notified and will reach out to you directly.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Payment Confirmed!</h2>
        <p>Hi ${safeCustomer},</p>
        <p>Your payment for <strong>${safeProduct}</strong> has been received.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${amountFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reference</td><td style="padding: 8px 0; text-align: right; font-family: monospace;">${transactionRef}</td></tr>
        </table>
        <p style="color: #666; font-size: 14px;">The seller has been notified and will reach out to you directly.</p>
      </div>
    `,
  })
}

interface SellerNotificationParams {
  to: string
  productName: string
  amountFormatted: string
  transactionRef: string
  customerName?: string
  customerEmail?: string
}

/** Send order notification email to the seller */
export async function sendSellerNotificationEmail({
  to,
  productName,
  amountFormatted,
  transactionRef,
  customerName,
  customerEmail,
}: SellerNotificationParams): Promise<void> {
  const safeProduct = escapeHtml(productName)
  const safeCustomerName = customerName ? escapeHtml(customerName) : null
  const safeCustomerEmail = customerEmail ? escapeHtml(customerEmail) : null

  await sendEmail({
    to,
    subject: `New Order — ${productName}`,
    text: [
      'You have a new order!',
      '',
      `Someone just purchased ${productName}.`,
      '',
      `Amount: ${amountFormatted}`,
      `Reference: ${transactionRef}`,
      ...(customerName ? [`Customer: ${customerName}`] : []),
      ...(customerEmail ? [`Email: ${customerEmail}`] : []),
      '',
      'Payment has been routed to your bank account via Flutterwave.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You have a new order!</h2>
        <p>Someone just purchased <strong>${safeProduct}</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${amountFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reference</td><td style="padding: 8px 0; text-align: right; font-family: monospace;">${transactionRef}</td></tr>
          ${safeCustomerName ? `<tr><td style="padding: 8px 0; color: #666;">Customer</td><td style="padding: 8px 0; text-align: right;">${safeCustomerName}</td></tr>` : ''}
          ${safeCustomerEmail ? `<tr><td style="padding: 8px 0; color: #666;">Email</td><td style="padding: 8px 0; text-align: right;">${safeCustomerEmail}</td></tr>` : ''}
        </table>
        <p style="color: #666; font-size: 14px;">Payment has been routed to your bank account via Flutterwave.</p>
      </div>
    `,
  })
}

/** Tell the buyer that their payment did not go through, so they are not left waiting */
export async function sendPaymentFailedEmail({
  to,
  productName,
  amountFormatted,
  transactionRef,
  customerName,
}: OrderEmailParams): Promise<void> {
  const safeProduct = escapeHtml(productName)
  const safeCustomer = escapeHtml(customerName || 'there')

  await sendEmail({
    to,
    subject: `Payment Failed — ${productName}`,
    text: [
      'Payment Not Completed',
      '',
      `Hi ${customerName || 'there'},`,
      `We could not confirm your payment for ${productName}.`,
      '',
      `Amount: ${amountFormatted}`,
      `Reference: ${transactionRef}`,
      '',
      'No payment was taken. You can safely retry using the original product link.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Payment Not Completed</h2>
        <p>Hi ${safeCustomer},</p>
        <p>We could not confirm your payment for <strong>${safeProduct}</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${amountFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reference</td><td style="padding: 8px 0; text-align: right; font-family: monospace;">${transactionRef}</td></tr>
        </table>
        <p style="color: #666; font-size: 14px;">No payment was taken. You can safely retry using the original product link.</p>
      </div>
    `,
  })
}

/** How the money an overpaying buyer paid is being handled. Mirrors `OverpaymentReversalStatus` in
 *  lib/payments.ts; declared separately so this module keeps no dependency on the payment layer. */
export type OverpaymentReversalStatus =
  | 'REVERSAL_SETTLED'
  | 'REVERSAL_IN_PROGRESS'
  | 'MANUAL_REQUIRED'

interface OverpaymentEmailParams {
  /** The full amount the provider confirmed the buyer was charged. */
  chargedFormatted: string
  /** The part of that which exceeded the listed price. */
  excessFormatted: string
  status: OverpaymentReversalStatus
}

/** Tell the seller that an order did not complete, so abandoned payments are not mistaken for sales */
export async function sendSellerPaymentFailedEmail({
  to,
  productName,
  amountFormatted,
  transactionRef,
  customerName,
  customerEmail,
}: SellerNotificationParams): Promise<void> {
  const safeProduct = escapeHtml(productName)
  const safeCustomerName = customerName ? escapeHtml(customerName) : null
  const safeCustomerEmail = customerEmail ? escapeHtml(customerEmail) : null

  await sendEmail({
    to,
    subject: `Order Not Completed — ${productName}`,
    text: [
      'Order Not Completed',
      '',
      `A payment for ${productName} did not go through.`,
      '',
      `Amount: ${amountFormatted}`,
      `Reference: ${transactionRef}`,
      ...(customerName ? [`Customer: ${customerName}`] : []),
      ...(customerEmail ? [`Email: ${customerEmail}`] : []),
      '',
      'No money was received for this order.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Order Not Completed</h2>
        <p>A payment for <strong>${safeProduct}</strong> did not go through.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${amountFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reference</td><td style="padding: 8px 0; text-align: right; font-family: monospace;">${transactionRef}</td></tr>
          ${safeCustomerName ? `<tr><td style="padding: 8px 0; color: #666;">Customer</td><td style="padding: 8px 0; text-align: right;">${safeCustomerName}</td></tr>` : ''}
          ${safeCustomerEmail ? `<tr><td style="padding: 8px 0; color: #666;">Email</td><td style="padding: 8px 0; text-align: right;">${safeCustomerEmail}</td></tr>` : ''}
        </table>
        <p style="color: #666; font-size: 14px;">No money was received for this order.</p>
      </div>
    `,
  })
}

/** Tell the buyer that their payment exceeded the price and what is happening to their money.
 *
 *  This exists because the ordinary failure email is actively wrong for an overpayment: it claims
 *  "No payment was taken" and invites a retry, when in fact the money was taken and is being
 *  returned. A buyer following that advice would pay twice.
 *
 *  Wording is chosen per `status` so no variant overstates what has happened — in particular,
 *  nothing claims a refund has completed unless Flutterwave confirmed disbursement. */
export async function sendOverpaymentReversedEmail({
  to,
  productName,
  amountFormatted,
  chargedFormatted,
  excessFormatted,
  transactionRef,
  status,
  customerName,
}: OrderEmailParams & OverpaymentEmailParams): Promise<void> {
  const safeProduct = escapeHtml(productName)
  const safeCustomer = escapeHtml(customerName || 'there')

  const settled = status === 'REVERSAL_SETTLED'
  const inProgress = status === 'REVERSAL_IN_PROGRESS'

  const subject = settled
    ? `Payment Returned — ${productName}`
    : inProgress
      ? `Payment Being Returned — ${productName}`
      : `Payment Under Review — ${productName}`

  const headline = settled
    ? 'Payment Returned'
    : inProgress
      ? 'Payment Being Returned'
      : 'Payment Under Review'

  const outcome = settled
    ? `We have returned the full ${chargedFormatted} you were charged to your payment method.`
    : inProgress
      ? `The full ${chargedFormatted} you were charged is being returned to your payment method. ` +
        'Depending on your bank this usually takes 3–15 working days.'
      : `The ${chargedFormatted} you were charged could not be returned automatically, so our team ` +
        'will return it to you manually. There is nothing you need to do.'

  await sendEmail({
    to,
    subject,
    text: [
      headline,
      '',
      `Hi ${customerName || 'there'},`,
      `Your payment for ${productName} was more than the listed price, so the order was not completed.`,
      '',
      outcome,
      '',
      `Amount charged: ${chargedFormatted}`,
      `Listed price: ${amountFormatted}`,
      `Paid above price: ${excessFormatted}`,
      `Reference: ${transactionRef}`,
      '',
      'The seller has been told not to send the item.',
      'Please do not pay again — this order was already closed.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>${headline}</h2>
        <p>Hi ${safeCustomer},</p>
        <p>Your payment for <strong>${safeProduct}</strong> was more than the listed price, so the order was not completed.</p>
        <p>${escapeHtml(outcome)}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Amount charged</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${chargedFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Listed price</td><td style="padding: 8px 0; text-align: right;">${amountFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Paid above price</td><td style="padding: 8px 0; text-align: right;">${excessFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reference</td><td style="padding: 8px 0; text-align: right; font-family: monospace;">${transactionRef}</td></tr>
        </table>
        <p style="color: #666; font-size: 14px;">The seller has been told not to send the item. Please do not pay again — this order was already closed.</p>
      </div>
    `,
  })
}

/** Tell the seller that a buyer overpaid, so they neither ship the item nor expect the money. */
export async function sendSellerOverpaymentEmail({
  to,
  productName,
  amountFormatted,
  chargedFormatted,
  excessFormatted,
  transactionRef,
  status,
  customerName,
  customerEmail,
}: SellerNotificationParams & OverpaymentEmailParams): Promise<void> {
  const safeProduct = escapeHtml(productName)
  const safeCustomerName = customerName ? escapeHtml(customerName) : null
  const safeCustomerEmail = customerEmail ? escapeHtml(customerEmail) : null

  const settled = status === 'REVERSAL_SETTLED'
  const inProgress = status === 'REVERSAL_IN_PROGRESS'

  const outcome = settled
    ? 'The charge has been returned to the buyer in full.'
    : inProgress
      ? 'The charge is being returned to the buyer in full. Funds usually leave your balance within 3–15 working days.'
      : 'The charge could not be returned automatically and needs manual follow-up, so the amount above the listed price is still held. Our team will action it — please do not ship the item.'

  await sendEmail({
    to,
    subject: `Order Not Completed — Overpaid — ${productName}`,
    text: [
      'Order Not Completed — Buyer Overpaid',
      '',
      `A buyer paid more than the listed price for ${productName}, so the order was not completed.`,
      '',
      outcome,
      '',
      `Listed price: ${amountFormatted}`,
      `Amount charged: ${chargedFormatted}`,
      `Paid above price: ${excessFormatted}`,
      `Reference: ${transactionRef}`,
      ...(customerName ? [`Customer: ${customerName}`] : []),
      ...(customerEmail ? [`Email: ${customerEmail}`] : []),
      '',
      'Do not ship this item. The payment was taken and is being returned to the buyer.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Order Not Completed — Buyer Overpaid</h2>
        <p>A buyer paid more than the listed price for <strong>${safeProduct}</strong>, so the order was not completed.</p>
        <p>${escapeHtml(outcome)}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Listed price</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${amountFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Amount charged</td><td style="padding: 8px 0; text-align: right;">${chargedFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Paid above price</td><td style="padding: 8px 0; text-align: right;">${excessFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reference</td><td style="padding: 8px 0; text-align: right; font-family: monospace;">${transactionRef}</td></tr>
          ${safeCustomerName ? `<tr><td style="padding: 8px 0; color: #666;">Customer</td><td style="padding: 8px 0; text-align: right;">${safeCustomerName}</td></tr>` : ''}
          ${safeCustomerEmail ? `<tr><td style="padding: 8px 0; color: #666;">Email</td><td style="padding: 8px 0; text-align: right;">${safeCustomerEmail}</td></tr>` : ''}
        </table>
        <p style="color: #666; font-size: 14px;">Do not ship this item. The payment was taken and is being returned to the buyer.</p>
      </div>
    `,
  })
}

interface PasswordResetEmailParams {
  to: string
  resetUrl: string
  name: string
}

/** Send password reset email to the user */
export async function sendPasswordResetEmail({
  to,
  resetUrl,
  name,
}: PasswordResetEmailParams): Promise<void> {
  const safeName = escapeHtml(name)
  const safeResetUrl = escapeHtml(resetUrl)

  await sendEmail({
    to,
    subject: 'Reset Your Password — SellSnap',
    text: [
      'Reset Your Password',
      '',
      `Hi ${name},`,
      'We received a request to reset your password. Open the link below to set a new password:',
      '',
      resetUrl,
      '',
      'This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Reset Your Password</h2>
        <p>Hi ${safeName},</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${safeResetUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Reset Password</a>
        </div>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  })
}

interface EmailChangeConfirmationParams {
  to: string
  confirmUrl: string
  name: string
}

/** Ask the owner of the new address to confirm an email change.
 *
 *  The change is not applied until this link is followed, so a hijacked session cannot silently
 *  move the account's login identity to an attacker-controlled address. */
export async function sendEmailChangeConfirmationEmail({
  to,
  confirmUrl,
  name,
}: EmailChangeConfirmationParams): Promise<void> {
  const safeName = escapeHtml(name)
  const safeUrl = escapeHtml(confirmUrl)

  await sendEmail({
    to,
    subject: 'Confirm your new SellSnap email',
    text: [
      'Confirm your new email',
      '',
      `Hi ${name},`,
      'A request was made to use this address for a SellSnap account.',
      'Open the link below to confirm the change:',
      '',
      confirmUrl,
      '',
      'This link expires in 1 hour. If you did not request this, you can safely ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Confirm your new email</h2>
        <p>Hi ${safeName},</p>
        <p>A request was made to use this address for a SellSnap account. Click below to confirm the change:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${safeUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Confirm email</a>
        </div>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  })
}

/** Tell the previous address that the account email changed, so a takeover is not silent. */
export async function sendEmailChangedNoticeEmail({
  to,
  newEmail,
  name,
}: {
  to: string
  newEmail: string
  name: string
}): Promise<void> {
  const safeName = escapeHtml(name)
  const safeNewEmail = escapeHtml(newEmail)

  await sendEmail({
    to,
    subject: 'Your SellSnap email was changed',
    text: [
      'Your email was changed',
      '',
      `Hi ${name},`,
      `The login email for your SellSnap account was changed to ${newEmail}.`,
      '',
      'If you did not make this change, contact support immediately — this address can no longer be used to sign in.',
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your email was changed</h2>
        <p>Hi ${safeName},</p>
        <p>The login email for your SellSnap account was changed to <strong>${safeNewEmail}</strong>.</p>
        <p style="color: #666; font-size: 14px;">If you did not make this change, contact support immediately — this address can no longer be used to sign in.</p>
      </div>
    `,
  })
}

export type OrderResolutionOutcome = 'SUCCESS' | 'FAILED' | 'OVERPAID'

export interface OrderResolutionEmailInput {
  outcome: OrderResolutionOutcome
  /** Required for `OVERPAID`; decides which overpayment wording is sent. */
  reversal?: OverpaymentEmailParams
  buyerEmail: string | null
  buyerName: string | null
  sellerEmail: string
  productName: string
  amountFormatted: string
  transactionRef: string
}

/** Notify buyer and seller once an order reaches a terminal state. Shared by the webhook and the cron resolver so a payment confirmed outside the webhook still reaches both parties. */
export async function sendOrderResolutionEmails({
  outcome,
  reversal,
  buyerEmail,
  buyerName,
  sellerEmail,
  productName,
  amountFormatted,
  transactionRef,
}: OrderResolutionEmailInput): Promise<void> {
  const customerName = buyerName || undefined
  const customerEmail = buyerEmail || undefined

  if (!buyerEmail) {
    logWarn('email.buyer_email_missing', { transactionRef })
  }

  if (outcome === 'SUCCESS') {
    if (buyerEmail) {
      await sendOrderConfirmationEmail({ to: buyerEmail, productName, amountFormatted, transactionRef, customerName })
    }
    await sendSellerNotificationEmail({ to: sellerEmail, productName, amountFormatted, transactionRef, customerName, customerEmail })
    return
  }

  // Overpayment gets its own wording. Sending 'FAILED' here told the buyer no money was taken and
  // invited a retry, which is false — the money was taken and is being returned.
  if (outcome === 'OVERPAID') {
    const overpayment: OverpaymentEmailParams = reversal ?? {
      // Never let missing detail imply the money is back: promise nothing and route to a human.
      status: 'MANUAL_REQUIRED',
      chargedFormatted: amountFormatted,
      excessFormatted: amountFormatted,
    }

    if (buyerEmail) {
      await sendOverpaymentReversedEmail({ to: buyerEmail, productName, amountFormatted, transactionRef, customerName, ...overpayment })
    }
    await sendSellerOverpaymentEmail({ to: sellerEmail, productName, amountFormatted, transactionRef, customerName, customerEmail, ...overpayment })
    return
  }

  if (buyerEmail) {
    await sendPaymentFailedEmail({ to: buyerEmail, productName, amountFormatted, transactionRef, customerName })
  }
  await sendSellerPaymentFailedEmail({ to: sellerEmail, productName, amountFormatted, transactionRef, customerName, customerEmail })
}
