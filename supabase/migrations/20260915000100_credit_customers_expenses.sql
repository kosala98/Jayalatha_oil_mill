-- Credit sales/purchases, daily customers and their settlements, expenses,
-- cheque deposit dates, the "වෙනත්" sale product, charcoal stock corrections,
-- and time-limited admin access for a counter device.

-- ---------- customers ----------
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(20),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "delete_reason" TEXT,
    "device_id" UUID,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_client_id_key" ON "customers"("client_id");
CREATE INDEX "customers_is_deleted_name_idx" ON "customers"("is_deleted", "name");
ALTER TABLE "customers" ADD CONSTRAINT "customers_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One ledger per person: two "Sunil" rows would split a balance in half silently.
CREATE UNIQUE INDEX "customers_name_unique_live" ON "customers" (lower(btrim("name"))) WHERE NOT "is_deleted";

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "customers_soft_delete_consistent"
    CHECK ("is_deleted" = ("deleted_at" IS NOT NULL) AND "is_deleted" = ("delete_reason" IS NOT NULL));

-- ---------- customer_payments ----------
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "cheque_number" TEXT,
    "cheque_deposit_date" DATE,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "delete_reason" TEXT,
    "device_id" UUID,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_payments_client_id_key" ON "customer_payments"("client_id");
CREATE INDEX "customer_payments_customer_id_is_deleted_idx" ON "customer_payments"("customer_id", "is_deleted");
CREATE INDEX "customer_payments_is_deleted_occurred_at_idx" ON "customer_payments"("is_deleted", "occurred_at");
CREATE INDEX "customer_payments_cheque_deposit_date_idx" ON "customer_payments"("cheque_deposit_date");
ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_payments_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_amount_positive" CHECK ("amount" > 0),
  -- Settling a debt with more credit is not a payment.
  ADD CONSTRAINT "customer_payments_method_not_credit" CHECK ("method" <> 'CREDIT'),
  ADD CONSTRAINT "customer_payments_cheque_fields_iff_cheque"
    CHECK (("method" = 'CHEQUE') = ("cheque_number" IS NOT NULL AND length(btrim("cheque_number")) > 0)
           AND ("method" = 'CHEQUE') = ("cheque_deposit_date" IS NOT NULL)),
  ADD CONSTRAINT "customer_payments_soft_delete_consistent"
    CHECK ("is_deleted" = ("deleted_at" IS NOT NULL) AND "is_deleted" = ("delete_reason" IS NOT NULL));

-- ---------- charcoal_adjustments ----------
CREATE TABLE "charcoal_adjustments" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "previous_kg" DECIMAL(12,3) NOT NULL,
    "counted_kg" DECIMAL(12,3) NOT NULL,
    "delta_kg" DECIMAL(12,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID,

    CONSTRAINT "charcoal_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "charcoal_adjustments_client_id_key" ON "charcoal_adjustments"("client_id");
CREATE INDEX "charcoal_adjustments_occurred_at_idx" ON "charcoal_adjustments"("occurred_at");
ALTER TABLE "charcoal_adjustments" ADD CONSTRAINT "charcoal_adjustments_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "charcoal_adjustments"
  ADD CONSTRAINT "charcoal_adjustments_counted_not_negative" CHECK ("counted_kg" >= 0),
  ADD CONSTRAINT "charcoal_adjustments_delta_matches" CHECK ("delta_kg" = "counted_kg" - "previous_kg"),
  ADD CONSTRAINT "charcoal_adjustments_delta_not_zero" CHECK ("delta_kg" <> 0),
  ADD CONSTRAINT "charcoal_adjustments_reason_not_blank" CHECK (length(btrim("reason")) >= 3);

-- ---------- temporary_access_grants ----------
CREATE TABLE "temporary_access_grants" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "temporary_access_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "temporary_access_grants_device_id_expires_at_idx" ON "temporary_access_grants"("device_id", "expires_at");
ALTER TABLE "temporary_access_grants" ADD CONSTRAINT "temporary_access_grants_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- sales: වෙනත් name, cheque deposit date, customer ----------
ALTER TABLE "sales"
  ADD COLUMN "custom_name" TEXT,
  ADD COLUMN "cheque_deposit_date" DATE,
  ADD COLUMN "customer_id" UUID;
CREATE INDEX "sales_customer_id_is_deleted_idx" ON "sales"("customer_id", "is_deleted");
CREATE INDEX "sales_cheque_deposit_date_idx" ON "sales"("cheque_deposit_date");
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cheques recorded before deposit dates existed: bank them on the day they were taken,
-- so the rule below can be enforced without rejecting real history. The immutability
-- trigger has to stand aside for this one statement — it is a schema change, not an edit
-- anyone can make through the app, and it runs inside the migration's transaction.
ALTER TABLE "sales" DISABLE TRIGGER "sales_immutable";
UPDATE "sales"
  SET "cheque_deposit_date" = ("occurred_at" AT TIME ZONE 'Asia/Colombo')::date
  WHERE "payment_method" = 'CHEQUE' AND "cheque_deposit_date" IS NULL;
ALTER TABLE "sales" ENABLE TRIGGER "sales_immutable";

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_custom_name_iff_other"
    CHECK (("product_code" = 'OTHER') = ("custom_name" IS NOT NULL AND length(btrim("custom_name")) > 0)),
  ADD CONSTRAINT "sales_deposit_date_iff_cheque"
    CHECK (("payment_method" = 'CHEQUE') = ("cheque_deposit_date" IS NOT NULL)),
  -- A credit sale without a customer is a debt nobody owes.
  ADD CONSTRAINT "sales_customer_iff_credit"
    CHECK ("payment_method" <> 'CREDIT' OR "customer_id" IS NOT NULL);

-- ---------- purchases: cheque deposit date, customer ----------
ALTER TABLE "purchases"
  ADD COLUMN "cheque_deposit_date" DATE,
  ADD COLUMN "customer_id" UUID;
CREATE INDEX "purchases_customer_id_is_deleted_idx" ON "purchases"("customer_id", "is_deleted");
CREATE INDEX "purchases_cheque_deposit_date_idx" ON "purchases"("cheque_deposit_date");
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchases" DISABLE TRIGGER "purchases_immutable";
UPDATE "purchases"
  SET "cheque_deposit_date" = ("occurred_at" AT TIME ZONE 'Asia/Colombo')::date
  WHERE "payment_method" = 'CHEQUE' AND "cheque_deposit_date" IS NULL;
ALTER TABLE "purchases" ENABLE TRIGGER "purchases_immutable";

ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_deposit_date_iff_cheque"
    CHECK (("payment_method" = 'CHEQUE') = ("cheque_deposit_date" IS NOT NULL)),
  ADD CONSTRAINT "purchases_customer_iff_credit"
    CHECK ("payment_method" <> 'CREDIT' OR "customer_id" IS NOT NULL);

-- ---------- cash_entries: a වියදම් must say what it was for ----------
ALTER TABLE "cash_entries"
  ADD CONSTRAINT "cash_entries_expense_note_required"
    CHECK ("type" <> 'EXPENSE' OR ("note" IS NOT NULL AND length(btrim("note")) >= 3));

-- ---------- the same protection the other financial tables get ----------
CREATE TRIGGER "customer_payments_no_hard_delete"    BEFORE DELETE ON "customer_payments"    FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();
CREATE TRIGGER "customers_no_hard_delete"            BEFORE DELETE ON "customers"            FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();
CREATE TRIGGER "charcoal_adjustments_no_hard_delete" BEFORE DELETE ON "charcoal_adjustments" FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();

-- Payments are financial rows: immutable apart from the soft-delete transition.
CREATE TRIGGER "customer_payments_immutable" BEFORE UPDATE ON "customer_payments"
  FOR EACH ROW EXECUTE FUNCTION pos_only_soft_delete_update();

-- A correction is never edited: make another one instead.
CREATE OR REPLACE FUNCTION pos_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % cannot be changed.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "charcoal_adjustments_immutable" BEFORE UPDATE ON "charcoal_adjustments"
  FOR EACH ROW EXECUTE FUNCTION pos_forbid_update();
