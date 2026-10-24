-- New product: RBD mix oil, sold like the other oils (litre, KG or bottle).
-- It sits right after RBD oil, so the products after it move down one place.
UPDATE "products" SET "sort_order" = "sort_order" + 1, "updated_at" = now()
WHERE "sort_order" >= 3 AND "code" <> 'RBD_MIX_OIL';

INSERT INTO "products" ("code", "name_si", "name_en", "is_charcoal", "allowed_units", "sort_order", "active", "updated_at") VALUES
  ('RBD_MIX_OIL', 'RBD mix තෙල්', 'RBD mix oil', false, '{LITER,KG,BOTTLE}', 3, true, now())
ON CONFLICT ("code") DO UPDATE SET
  "name_si" = EXCLUDED."name_si",
  "name_en" = EXCLUDED."name_en",
  "is_charcoal" = EXCLUDED."is_charcoal",
  "allowed_units" = EXCLUDED."allowed_units",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = now();
