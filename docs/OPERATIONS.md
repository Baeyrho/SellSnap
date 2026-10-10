# SellSnap Operations Runbook

Manual procedures for the money paths. The application refuses to resolve some situations on its
own on purpose — a payment that arrives after an order was closed, a refund below Flutterwave's
minimum — and those land in a queue that a person has to work through.

**Owner: [Assign owner]**
**Escalation contact: [Assign owner]**
**Alert destination (`OPS_ALERT_EMAIL`): [Assign owner]**

Nothing in this document has been performed on the owner's behalf. Everything under
[Manual / external actions](#manual--external-actions-not-yet-performed) is still outstanding.

---

## The one command you need

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/operations
```

Add `?alert=1` to have the same summary emailed to you. Add `?limit=N` (max 100) to widen or narrow
the lists. The endpoint is read-only — it cannot change a payment — and it is guarded by the same
`CRON_SECRET` as the cron, so it is not reachable by buyers or sellers.

It answers with:

| Field | Meaning | Act when |
|---|---|---|
| `latePayments` | Provider confirmed a payment for an order already closed | [Late payment](#1-late-payment--money-taken-nothing-fulfilled) |
| `refundsNeedingAction` | Reversal below Flutterwave's minimum, or a reversal that failed | [Reversal needs manual handling](#2-reversal-below-minimum-or-failed) |
| `refundBacklog` | Reversals awaiting disbursement, plus the age of the oldest | Investigate if `oldestOutstandingAt` is more than a few days old |
| `stalePendingOrders` | Orders still `PENDING` past the 1-hour sweep window | [Cron is not working](#3-the-reconciliation-cron-is-not-running) |

`needsAttention: true` means at least one of the above is non-empty.

---

## 1. Late payment — money taken, nothing fulfilled

**What happened.** A buyer started a payment but did not complete it within an hour. The cron
swept the order to `FAILED`. The buyer then completed the payment — normal with bank transfer and
USSD, where the money can arrive well after the checkout redirect. The money reached the seller's
Flutterwave subaccount, but the order was already closed, so nothing was fulfilled and no reversal
was raised.

SellSnap records this as `latePaymentDetectedAt` and lists it in `latePayments`. It deliberately
does **not** auto-fulfil or auto-refund: the item may be sold, and returning money is a business
decision.

**How to resolve one.**

1. Confirm the payment really landed:
   ```bash
   curl -H "Authorization: Bearer $FLUTTERWAVE_SECRET_KEY" \
     https://api.flutterwave.com/v3/transactions/<flutterwaveTxId>
   ```
   Confirm `status` is `successful` and `amount` matches the `amountKobo` in the report.
2. Check the product is still for sale and can still be delivered to the buyer.
3. **If it can be delivered:** contact the buyer to confirm, then fulfil the order manually and
   tell them it is on its way. Do not re-take payment.
4. **If it cannot be delivered:** refund the full charged amount from the Flutterwave dashboard
   (Refunds → the transaction). Record the refund id against the order's `refundId` and set
   `refundStatus` to `COMPLETED` once the dashboard shows the money returned, or `REQUESTED` while
   it is still in flight so the reconciliation cron finishes the job.
5. Tell the buyer either way. Do not leave a paid buyer waiting.

---

## 2. Reversal below minimum, or failed

**Below the provider minimum.** Flutterwave refuses refunds under **NGN 100**. The minimum applies
to the *whole refunded amount*, not just the excess, so this only happens when the total charged
amount is itself under NGN 100. `refundStatus: BELOW_MINIMUM` means the buyer is owed money that no
API call can return.

**Failed reversal.** `refundStatus: FAILED` means the refund request itself errored — a provider
fault or a network failure. The buyer is still owed the money.

**How to resolve one.**

1. Read `orderId`, `transactionRef`, `amountKobo` and `refundId` from the report.
2. Check the refund's real status before doing anything:
   ```bash
   curl -H "Authorization: Bearer $FLUTTERWAVE_SECRET_KEY" \
     https://api.flutterwave.com/v3/refunds/<refundId>
   ```
   - `completed-bank-transfer`, `completed-momo`, `completed-mpgs`, `completed-offline` or
     `completed-preauth` → the money is back. Set `refundStatus = 'COMPLETED'`.
   - plain `completed` → *initiated*, not yet disbursed. Leave it; the cron will confirm it.
   - `processing` → still in flight. Leave it.
3. If the refund genuinely did not happen, issue it from the Flutterwave dashboard. The dashboard
   has no ₦100 floor, which is exactly why `BELOW_MINIMUM` exists as a manual queue.
4. Confirm with the buyer once the money is back.

**Status vocabulary cheat sheet**

| Provider value | Meaning | Action |
|---|---|---|
| `processing`, `pending-momo` | In flight | Nothing. Wait for the cron. |
| plain `completed` | Refund **initiated**, not disbursed | Nothing. Wait for the cron. |
| `completed-bank-transfer` / `-momo` / `-mpgs` / `-offline` / `-preauth` | Disbursed | Record `COMPLETED` |
| `meta.disburse_status: "failed"` | Disbursement failed | Re-issue manually |

---

## 3. The reconciliation cron is not running

**Symptoms.** `stalePendingOrders` stays above zero, or Vercel shows failed cron invocations.
Consequences: abandoned orders never get swept, and reversals never get confirmed as disbursed.

**Check the schedule.** `vercel.json` requests `0 * * * *` — hourly. **Vercel's Hobby plan only runs
one cron per day**, which silently reduces this to daily. Confirm the plan in the Vercel project.

**Check the secret.** The cron requires `Authorization: Bearer $CRON_SECRET`. Vercel sends that
automatically when a `CRON_SECRET` environment variable is set on the project; if it is missing,
every invocation returns 401.

**Check it by hand:**
```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/resolve-pending
```
A 200 with a JSON summary means healthy. A 401 means the secret is wrong or unset. A 500 means the
run itself failed — check the Vercel function logs for the `cron.run_failed` event.

**Read the logs.** Every event is one JSON object on one line, with a stable `event` key:

| `event` | Level | Meaning |
|---|---|---|
| `cron.run_completed` | info | Normal run. Check `resolved`, `verificationFailures`, `refundsPending`. |
| `cron.run_failed` | error | The run threw. An alert was emailed. |
| `cron.order_verification_failed` | error | One order could not be verified. `providerFailureKind` distinguishes a provider outage from a SellSnap bug. |
| `cron.reference_mismatch` | error | The verified transaction was not the order's. Needs investigation. |
| `cron.operational_alert_failed` | error | The run succeeded but the alert email failed. |
| `payments.late_payment_detected` | error | Money taken against a closed order. |
| `payments.refund_below_provider_minimum` | error | Buyer is owed money that needs returning by hand. |
| `payments.refund_request_failed` | error | A reversal could not be raised. |
| `payments.refund_status_read_failed` | error | A refund read failed. It stays `REQUESTED` and is retried — **not** written off. |
| `payments.order_resolution_email_failed` | error | The payment is correctly recorded but a receipt was not delivered. |
| `email.smtp_not_configured` | warn | No mail relay. Every receipt and alert is being dropped. |
| `email.operational_alert_unrouted` | warn | No `OPS_ALERT_EMAIL` and no `SMTP_FROM`. Alerts have nowhere to go. |

---

## 4. Applying a migration to production

**Never run `prisma migrate dev` in production.** It can prompt to reset the database.

```bash
# 1. Confirm what is pending — read-only, safe to run at any time.
npx prisma migrate status

# 2. Take a backup. Verify the backup restores before you rely on it.

# 3. Apply. Additive migrations only; never edit an already-applied migration file.
npx prisma migrate deploy
```

If `migrate status` shows drift — a migration recorded in `_prisma_migrations` that is missing from
the database, or vice versa — **stop and investigate**. Do not force-resolve it.

### Post-deploy verification

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/operations
npx prisma migrate status   # should report no pending migrations
```

---

## 5. Rotating a secret

| Secret | Blast radius if leaked | Rotation |
|---|---|---|
| `FLUTTERWAVE_SECRET_KEY` | Full control of the Flutterwave account | Rotate in the Flutterwave dashboard, update the Vercel env var, redeploy. Check for unfamiliar subaccounts and transactions. |
| `FLUTTERWAVE_SECRET_HASH` | Forged webhooks, i.e. forged payments | Rotate in the Flutterwave dashboard **and** the Vercel env var in the same window, otherwise real webhooks are rejected as 401 during the gap. |
| `CRON_SECRET` | Anyone can trigger the cron and read the operations report | Generate with `openssl rand -base64 32`, update Vercel, redeploy. |
| `NEXTAUTH_SECRET` | Session forgery; **logs every user out** | Rotate last, and expect a re-login. |
| `SMTP_PASS` | Sending mail as you | Rotate in the mail provider, update Vercel, redeploy. |
| `DATABASE_URL` | Full database access | Rotate in the provider. Keep `.env` in sync — the Prisma CLI does not read `.env.local`. |

**Rotate `FLUTTERWAVE_SECRET_HASH` and its dashboard counterpart together.** They are compared
against every webhook delivery; a mismatch means 401s and payments that never resolve.

---

## Flutterwave dashboard configuration to verify

Not checked by this codebase — confirm each one by hand.

- [ ] Webhook URL is the production `/api/webhooks/flutterwave`, on HTTPS.
- [ ] The webhook secret hash matches `FLUTTERWAVE_SECRET_HASH` exactly.
- [ ] `FLUTTERWAVE_SECRET_KEY` is the **live** key, not the sandbox/test key.
- [ ] The live secret key is server-side only. There is no `FLUTTERWAVE_PUBLIC_KEY` — checkout is a
      server-side redirect, and a public key appearing anywhere in this repo is a red flag.
- [ ] Settlement account is the seller's business account, as expected.
- [ ] Webhook delivery logs show recent successful 200s and no sustained 401s.
- [ ] Refund webhooks: **off by default.** SellSnap polls `GET /v3/refunds/{id}` instead, so nothing
      breaks if these stay off.
- [ ] Who can issue refunds from the dashboard. Manual returns for `BELOW_MINIMUM` are only safe
      while that list is restricted to trusted operators.

---

## Manual / external actions (not yet performed)

None of these were executed. They need dashboard access, an owner, or a decision this codebase
cannot make.

- [ ] **Assign an owner and an escalation contact** at the top of this document.
- [ ] **Set `OPS_ALERT_EMAIL`** to a monitored mailbox, and confirm `SMTP_HOST` is configured. Until
      both are set, `email.smtp_not_configured` is the only signal that mail is being dropped.
- [ ] **Verify the Vercel plan** permits hourly crons. Hobby caps at one per day.
- [ ] **Apply pending migrations to production** with `npx prisma migrate deploy`.
- [ ] **Take a backup and verify it restores.** `[Assign owner]`
- [ ] **Work through the Flutterwave dashboard checklist** above.
- [ ] **Exercise a live payment** on production and confirm the webhook, the cron, and the receipt
      email all behave. `[Assign owner]`
- [ ] **Decide the late-payment policy.** Right now a human chooses per order. If a standing policy
      is wanted — always refund, always fulfil within N hours — write it here and implement it.
- [ ] **Decide whether sellers should see reversal status.** Sellers can currently see
      `refundStatus` on their own orders. There is no admin role in the data model, so the
      operations queue is served from the `CRON_SECRET` boundary instead.
- [ ] **Consider a shared rate-limit store** if Vercel is running more than one instance and the
      per-instance limit becomes a problem. The current limiter is process-local by design.