-- AlterEnum
-- Additive only: an overpayment whose excess is under Flutterwave's published minimum refund
-- amount (NGN 100) cannot be reversed automatically. Recording it separately from FAILED keeps
-- it visible as an actionable queue instead of an indistinguishable provider rejection.
ALTER TYPE "RefundStatus" ADD VALUE 'BELOW_MINIMUM';