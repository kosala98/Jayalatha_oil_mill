-- Cash lent to a customer, or borrowed from one, is not the same thing as paying for
-- goods already taken — even though it moves the balance identically.

CREATE TYPE "PaymentKind" AS ENUM ('SETTLEMENT', 'LOAN');

ALTER TABLE "customer_payments"
  ADD COLUMN "kind" "PaymentKind" NOT NULL DEFAULT 'SETTLEMENT';

CREATE INDEX "customer_payments_kind_idx" ON "customer_payments"("kind");
