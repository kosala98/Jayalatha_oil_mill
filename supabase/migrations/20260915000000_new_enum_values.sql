-- New enum values live in their own migration on purpose: PostgreSQL will not let a
-- value added by ALTER TYPE be USED in the same transaction, and the next migration's
-- CHECK constraints refer to 'CREDIT' and 'EXPENSE' directly.

ALTER TYPE "PaymentMethod"  ADD VALUE IF NOT EXISTS 'CREDIT';
ALTER TYPE "CashEntryType"  ADD VALUE IF NOT EXISTS 'EXPENSE';
ALTER TYPE "AuditEntity"    ADD VALUE IF NOT EXISTS 'CUSTOMER';
ALTER TYPE "AuditEntity"    ADD VALUE IF NOT EXISTS 'CUSTOMER_PAYMENT';
ALTER TYPE "AuditEntity"    ADD VALUE IF NOT EXISTS 'CHARCOAL_ADJUSTMENT';
ALTER TYPE "AuditEntity"    ADD VALUE IF NOT EXISTS 'TEMP_ACCESS';

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('RECEIVED', 'PAID');
