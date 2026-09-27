-- Defence in depth: the API validates everything, but the database refuses bad
-- financial rows even if someone writes to it directly (SQL console, scripts).
-- Prisma does not manage CHECK constraints or triggers, so they live here and
-- are left alone by future `prisma migrate dev` runs.

-- ---------- sales ----------
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_quantity_positive"  CHECK ("quantity" > 0),
  ADD CONSTRAINT "sales_price_positive"     CHECK ("price_per_unit" > 0),
  ADD CONSTRAINT "sales_total_positive"     CHECK ("total" > 0),
  ADD CONSTRAINT "sales_total_matches"      CHECK ("total" = ROUND("quantity" * "price_per_unit", 2)),
  ADD CONSTRAINT "sales_bottle_size_iff_bottle"
    CHECK (("unit_type" = 'BOTTLE') = ("bottle_size" IS NOT NULL)),
  ADD CONSTRAINT "sales_bottle_qty_whole"
    CHECK ("unit_type" <> 'BOTTLE' OR "quantity" = TRUNC("quantity")),
  ADD CONSTRAINT "sales_cheque_number_iff_cheque"
    CHECK (("payment_method" = 'CHEQUE') = ("cheque_number" IS NOT NULL AND length(btrim("cheque_number")) > 0)),
  ADD CONSTRAINT "sales_soft_delete_consistent"
    CHECK ("is_deleted" = ("deleted_at" IS NOT NULL) AND "is_deleted" = ("delete_reason" IS NOT NULL));

-- ---------- purchases ----------
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_quantity_positive" CHECK ("quantity_kg" > 0),
  ADD CONSTRAINT "purchases_price_positive"    CHECK ("price_per_kg" > 0),
  ADD CONSTRAINT "purchases_total_positive"    CHECK ("total" > 0),
  ADD CONSTRAINT "purchases_total_matches"     CHECK ("total" = ROUND("quantity_kg" * "price_per_kg", 2)),
  ADD CONSTRAINT "purchases_custom_name_iff_other"
    CHECK (("material" = 'OTHER') = ("custom_name" IS NOT NULL AND length(btrim("custom_name")) > 0)),
  ADD CONSTRAINT "purchases_cheque_number_iff_cheque"
    CHECK (("payment_method" = 'CHEQUE') = ("cheque_number" IS NOT NULL AND length(btrim("cheque_number")) > 0)),
  ADD CONSTRAINT "purchases_soft_delete_consistent"
    CHECK ("is_deleted" = ("deleted_at" IS NOT NULL) AND "is_deleted" = ("delete_reason" IS NOT NULL));

-- ---------- cash_entries ----------
ALTER TABLE "cash_entries"
  ADD CONSTRAINT "cash_entries_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "cash_entries_soft_delete_consistent"
    CHECK ("is_deleted" = ("deleted_at" IS NOT NULL) AND "is_deleted" = ("delete_reason" IS NOT NULL));

-- ---------- admin_settings: singleton ----------
ALTER TABLE "admin_settings"
  ADD CONSTRAINT "admin_settings_singleton" CHECK ("id" = 1);

-- ---------- No hard deletes on financial tables, ever ----------
CREATE OR REPLACE FUNCTION pos_forbid_hard_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Hard DELETE on % is not allowed. Use soft delete (is_deleted = true).', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_no_hard_delete"        BEFORE DELETE ON "sales"        FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();
CREATE TRIGGER "purchases_no_hard_delete"    BEFORE DELETE ON "purchases"    FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();
CREATE TRIGGER "cash_entries_no_hard_delete" BEFORE DELETE ON "cash_entries" FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();
CREATE TRIGGER "audit_logs_no_delete"        BEFORE DELETE ON "audit_logs"   FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();

-- ---------- Financial rows are immutable except for the soft-delete transition ----------
CREATE OR REPLACE FUNCTION pos_only_soft_delete_update() RETURNS trigger AS $$
BEGIN
  IF OLD."is_deleted" THEN
    RAISE EXCEPTION 'Row % in % is already deleted and cannot be changed.', OLD."id", TG_TABLE_NAME;
  END IF;
  IF NEW."is_deleted" IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Rows in % are immutable. Only soft delete is allowed.', TG_TABLE_NAME;
  END IF;
  -- Compare everything except the three soft-delete columns
  IF (to_jsonb(NEW) - 'is_deleted' - 'deleted_at' - 'delete_reason')
     IS DISTINCT FROM (to_jsonb(OLD) - 'is_deleted' - 'deleted_at' - 'delete_reason') THEN
    RAISE EXCEPTION 'Rows in % are immutable. Only soft delete is allowed.', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_immutable"        BEFORE UPDATE ON "sales"        FOR EACH ROW EXECUTE FUNCTION pos_only_soft_delete_update();
CREATE TRIGGER "purchases_immutable"    BEFORE UPDATE ON "purchases"    FOR EACH ROW EXECUTE FUNCTION pos_only_soft_delete_update();
CREATE TRIGGER "cash_entries_immutable" BEFORE UPDATE ON "cash_entries" FOR EACH ROW EXECUTE FUNCTION pos_only_soft_delete_update();

CREATE OR REPLACE FUNCTION pos_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION pos_audit_append_only();
