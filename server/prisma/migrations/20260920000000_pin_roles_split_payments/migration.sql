-- Two PINs (counter + owner) replace device pairing, and one transaction can now be
-- paid with cash, cheque and credit at the same time.

-- ---------- credentials ----------
CREATE TYPE "PinRole" AS ENUM ('USER', 'ADMIN');

CREATE TABLE "credentials" (
    "role" "PinRole" NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "pin_version" INTEGER NOT NULL DEFAULT 1,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("role")
);

-- Carry the existing admin PIN across so nobody is locked out by this upgrade.
INSERT INTO "credentials" ("role", "pin_hash", "pin_version", "updated_at")
SELECT 'ADMIN', "pin_hash", "pin_version", now() FROM "admin_settings" WHERE "id" = 1;

CREATE TABLE "temporary_admin_access" (
    "id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "temporary_admin_access_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "temporary_admin_access_expires_at_idx" ON "temporary_admin_access"("expires_at");

-- ---------- device pairing goes away ----------
-- device_id stays as a plain audit column: which browser install recorded the row.
ALTER TABLE "sales"                DROP CONSTRAINT IF EXISTS "sales_device_id_fkey";
ALTER TABLE "purchases"            DROP CONSTRAINT IF EXISTS "purchases_device_id_fkey";
ALTER TABLE "cash_entries"         DROP CONSTRAINT IF EXISTS "cash_entries_device_id_fkey";
ALTER TABLE "customers"            DROP CONSTRAINT IF EXISTS "customers_device_id_fkey";
ALTER TABLE "customer_payments"    DROP CONSTRAINT IF EXISTS "customer_payments_device_id_fkey";
ALTER TABLE "charcoal_adjustments" DROP CONSTRAINT IF EXISTS "charcoal_adjustments_device_id_fkey";

DROP TABLE IF EXISTS "temporary_access_grants";
DROP TABLE IF EXISTS "pairing_codes";
DROP TABLE IF EXISTS "devices";
DROP TABLE IF EXISTS "admin_settings";

-- ---------- split payments on sales ----------
ALTER TABLE "sales"
  ADD COLUMN "cash_amount"   DECIMAL(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cheque_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN "credit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- Existing rows paid one way: move the whole total into that part.
-- The immutability trigger stands aside for the backfill, inside this transaction.
ALTER TABLE "sales" DISABLE TRIGGER "sales_immutable";
UPDATE "sales" SET
  "cash_amount"   = CASE WHEN "payment_method" = 'CASH'   THEN "total" ELSE 0 END,
  "cheque_amount" = CASE WHEN "payment_method" = 'CHEQUE' THEN "total" ELSE 0 END,
  "credit_amount" = CASE WHEN "payment_method" = 'CREDIT' THEN "total" ELSE 0 END;
ALTER TABLE "sales" ENABLE TRIGGER "sales_immutable";

ALTER TABLE "sales"
  DROP CONSTRAINT IF EXISTS "sales_cheque_number_iff_cheque",
  DROP CONSTRAINT IF EXISTS "sales_deposit_date_iff_cheque",
  DROP CONSTRAINT IF EXISTS "sales_customer_iff_credit";
ALTER TABLE "sales" DROP COLUMN "payment_method";

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_parts_not_negative"
    CHECK ("cash_amount" >= 0 AND "cheque_amount" >= 0 AND "credit_amount" >= 0),
  ADD CONSTRAINT "sales_parts_sum_to_total"
    CHECK ("cash_amount" + "cheque_amount" + "credit_amount" = "total"),
  ADD CONSTRAINT "sales_cheque_fields_iff_cheque_part"
    CHECK (("cheque_amount" > 0) = ("cheque_number" IS NOT NULL AND length(btrim("cheque_number")) > 0)
           AND ("cheque_amount" > 0) = ("cheque_deposit_date" IS NOT NULL)),
  ADD CONSTRAINT "sales_customer_iff_credit_part"
    CHECK ("credit_amount" = 0 OR "customer_id" IS NOT NULL);

-- ---------- split payments on purchases ----------
ALTER TABLE "purchases"
  ADD COLUMN "cash_amount"   DECIMAL(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cheque_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN "credit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0;

ALTER TABLE "purchases" DISABLE TRIGGER "purchases_immutable";
UPDATE "purchases" SET
  "cash_amount"   = CASE WHEN "payment_method" = 'CASH'   THEN "total" ELSE 0 END,
  "cheque_amount" = CASE WHEN "payment_method" = 'CHEQUE' THEN "total" ELSE 0 END,
  "credit_amount" = CASE WHEN "payment_method" = 'CREDIT' THEN "total" ELSE 0 END;
ALTER TABLE "purchases" ENABLE TRIGGER "purchases_immutable";

ALTER TABLE "purchases"
  DROP CONSTRAINT IF EXISTS "purchases_cheque_number_iff_cheque",
  DROP CONSTRAINT IF EXISTS "purchases_deposit_date_iff_cheque",
  DROP CONSTRAINT IF EXISTS "purchases_customer_iff_credit";
ALTER TABLE "purchases" DROP COLUMN "payment_method";

ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_parts_not_negative"
    CHECK ("cash_amount" >= 0 AND "cheque_amount" >= 0 AND "credit_amount" >= 0),
  ADD CONSTRAINT "purchases_parts_sum_to_total"
    CHECK ("cash_amount" + "cheque_amount" + "credit_amount" = "total"),
  ADD CONSTRAINT "purchases_cheque_fields_iff_cheque_part"
    CHECK (("cheque_amount" > 0) = ("cheque_number" IS NOT NULL AND length(btrim("cheque_number")) > 0)
           AND ("cheque_amount" > 0) = ("cheque_deposit_date" IS NOT NULL)),
  ADD CONSTRAINT "purchases_customer_iff_credit_part"
    CHECK ("credit_amount" = 0 OR "customer_id" IS NOT NULL);
