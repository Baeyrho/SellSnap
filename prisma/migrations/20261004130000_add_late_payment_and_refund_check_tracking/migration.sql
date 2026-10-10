-- Additive only. Two nullable bookkeeping columns on "Order", plus the indexes the operational
-- report queries. No existing column is rewritten, no row is touched, no data is backfilled, so
-- this is safe to apply with `prisma migrate deploy` on a live database.

-- Records a provider-confirmed payment that arrived after the abandoned-order sweep had already
-- resolved the order as FAILED. Nullable and unindexed-by-default: it stays NULL for every order
-- that resolves normally, so the common path costs nothing.
ALTER TABLE "Order" ADD COLUMN     "latePaymentDetectedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN     "lastRefundCheckAt"    TIMESTAMP(3);

-- Partial index: the operational report only asks for rows that actually have a late payment, so
-- an unfiltered index would carry an entry for every order in the table forever.
CREATE INDEX "Order_latePaymentDetectedAt_idx" ON "Order" ("latePaymentDetectedAt");

-- Supports the reconciliation poll's selection of REQUESTED refunds, ordered by how long ago they
-- were last checked. Composite because the leading column is the filter and the trailing column is
-- the sort key.
CREATE INDEX "Order_refundStatus_lastRefundCheckAt_idx" ON "Order" ("refundStatus", "lastRefundCheckAt");