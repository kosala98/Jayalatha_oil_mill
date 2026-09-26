-- Standing prices: what a litre of oil or a kilo of copra costs today, kept until changed.

CREATE TABLE "prices" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "device_id" UUID,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "prices"
  ADD CONSTRAINT "prices_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "prices_id_shape" CHECK (length(btrim("id")) BETWEEN 3 AND 80);
