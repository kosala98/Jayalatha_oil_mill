-- One counter visit can produce several rows (copra in, oil out, the settlement).
-- A shared bill number ties them together so the customer's single receipt can be
-- found again and reprinted months later.

ALTER TABLE "sales"             ADD COLUMN "bill_no" TEXT;
ALTER TABLE "purchases"         ADD COLUMN "bill_no" TEXT;
ALTER TABLE "customer_payments" ADD COLUMN "bill_no" TEXT;

CREATE INDEX "sales_bill_no_idx"             ON "sales"("bill_no");
CREATE INDEX "purchases_bill_no_idx"         ON "purchases"("bill_no");
CREATE INDEX "customer_payments_bill_no_idx" ON "customer_payments"("bill_no");

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_bill_no_shape" CHECK ("bill_no" IS NULL OR length("bill_no") BETWEEN 3 AND 32);
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_bill_no_shape" CHECK ("bill_no" IS NULL OR length("bill_no") BETWEEN 3 AND 32);
ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_bill_no_shape" CHECK ("bill_no" IS NULL OR length("bill_no") BETWEEN 3 AND 32);
