-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('LITER', 'KG', 'BOTTLE');

-- CreateEnum
CREATE TYPE "BottleSize" AS ENUM ('QUARTER', 'HALF', 'ONE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PurchaseMaterial" AS ENUM ('COPRA', 'CHARCOAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CashEntryType" AS ENUM ('OPENING_FLOAT', 'TOP_UP');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'DELETE', 'UPDATE');

-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('SALE', 'PURCHASE', 'CASH_ENTRY', 'ADMIN_SETTINGS');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('COUNTER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "products" (
    "code" TEXT NOT NULL,
    "name_si" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_charcoal" BOOLEAN NOT NULL DEFAULT false,
    "allowed_units" "UnitType"[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "product_code" TEXT NOT NULL,
    "unit_type" "UnitType" NOT NULL,
    "bottle_size" "BottleSize",
    "quantity" DECIMAL(12,3) NOT NULL,
    "price_per_unit" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(16,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "cheque_number" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "delete_reason" TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "material" "PurchaseMaterial" NOT NULL,
    "custom_name" TEXT,
    "quantity_kg" DECIMAL(12,3) NOT NULL,
    "price_per_kg" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(16,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "cheque_number" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "delete_reason" TEXT,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" "CashEntryType" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "delete_reason" TEXT,

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pin_hash" TEXT NOT NULL,
    "pin_version" INTEGER NOT NULL DEFAULT 1,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity" "AuditEntity" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor" "ActorType" NOT NULL,
    "device_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_client_id_key" ON "sales"("client_id");

-- CreateIndex
CREATE INDEX "sales_is_deleted_occurred_at_idx" ON "sales"("is_deleted", "occurred_at");

-- CreateIndex
CREATE INDEX "sales_product_code_is_deleted_idx" ON "sales"("product_code", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_client_id_key" ON "purchases"("client_id");

-- CreateIndex
CREATE INDEX "purchases_is_deleted_occurred_at_idx" ON "purchases"("is_deleted", "occurred_at");

-- CreateIndex
CREATE INDEX "purchases_material_is_deleted_idx" ON "purchases"("material", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "cash_entries_client_id_key" ON "cash_entries"("client_id");

-- CreateIndex
CREATE INDEX "cash_entries_is_deleted_occurred_at_idx" ON "cash_entries"("is_deleted", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
