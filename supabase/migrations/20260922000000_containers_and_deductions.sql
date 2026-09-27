-- Empty bottles and cans sold with the oil, and weight deducted from a purchase
-- before it is paid for (moisture, sacks, spoiled copra, sand in the charcoal).

CREATE TYPE "DeductionKind" AS ENUM ('MOISTURE', 'SACK', 'SPOILED', 'DUST', 'OTHER');

-- ---------- sales: empty containers ----------
ALTER TABLE "sales"
  ADD COLUMN "container_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "container_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "container_total" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- The old rule said total = quantity × price. Containers are part of the total now.
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_total_matches";
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_container_not_negative"
    CHECK ("container_count" >= 0 AND "container_price" >= 0 AND "container_total" >= 0),
  ADD CONSTRAINT "sales_container_total_matches"
    CHECK ("container_total" = ROUND("container_count" * "container_price", 2)),
  -- Containers only exist when some were sold.
  ADD CONSTRAINT "sales_container_price_iff_count"
    CHECK (("container_count" > 0) = ("container_price" > 0)),
  ADD CONSTRAINT "sales_total_matches"
    CHECK ("total" = ROUND("quantity" * "price_per_unit", 2) + "container_total");

-- ---------- purchases: weight deductions ----------
ALTER TABLE "purchases"
  ADD COLUMN "gross_kg" DECIMAL(12,3),
  ADD COLUMN "deduction_kg" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN "deductions" JSONB;

ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_deduction_not_negative" CHECK ("deduction_kg" >= 0),
  -- Either nothing was deducted, or the net weight is exactly gross − deductions.
  ADD CONSTRAINT "purchases_net_weight_matches"
    CHECK (("gross_kg" IS NULL AND "deduction_kg" = 0)
           OR ("gross_kg" IS NOT NULL AND "quantity_kg" = "gross_kg" - "deduction_kg")),
  ADD CONSTRAINT "purchases_deduction_below_gross"
    CHECK ("gross_kg" IS NULL OR "deduction_kg" < "gross_kg");
