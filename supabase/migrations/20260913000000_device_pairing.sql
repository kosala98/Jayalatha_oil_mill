-- Device pairing: only paired devices may record sales, purchases and cash entries.

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'DEVICE';

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" TEXT,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "device_name" VARCHAR(40) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "device_id" UUID;
ALTER TABLE "purchases" ADD COLUMN "device_id" UUID;
ALTER TABLE "cash_entries" ADD COLUMN "device_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices"("token_hash");
CREATE UNIQUE INDEX "pairing_codes_code_hash_key" ON "pairing_codes"("code_hash");
CREATE UNIQUE INDEX "pairing_codes_device_id_key" ON "pairing_codes"("device_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Hand-written (not managed by Prisma) ----------

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "devices_revoke_consistent"
    CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL));

ALTER TABLE "pairing_codes"
  ADD CONSTRAINT "pairing_codes_used_consistent"
    CHECK (("used_at" IS NULL) = ("device_id" IS NULL));

-- Devices are revoked, never deleted, so every transaction keeps its device.
CREATE TRIGGER "devices_no_hard_delete" BEFORE DELETE ON "devices" FOR EACH ROW EXECUTE FUNCTION pos_forbid_hard_delete();

-- A revoked device stays revoked; the token never changes after pairing.
CREATE OR REPLACE FUNCTION pos_device_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" THEN
    RAISE EXCEPTION 'Device % is revoked and cannot be re-activated. Pair it again instead.', OLD."id";
  END IF;
  IF NEW."token_hash" IS DISTINCT FROM OLD."token_hash" THEN
    RAISE EXCEPTION 'A device token cannot be changed. Pair the device again instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "devices_guard" BEFORE UPDATE ON "devices" FOR EACH ROW EXECUTE FUNCTION pos_device_guard();
