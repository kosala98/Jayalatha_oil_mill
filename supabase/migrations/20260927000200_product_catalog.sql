-- The fixed product catalog (formerly written by the Prisma seed). Safe to re-run:
-- existing products keep their rows and only get the catalog's names and units.
INSERT INTO "products" ("code", "name_si", "name_en", "is_charcoal", "allowed_units", "sort_order", "active", "updated_at") VALUES
  ('COCONUT_OIL',       'පොල් තෙල්',        'Coconut oil',                   false, '{LITER,KG,BOTTLE}', 1, true, now()),
  ('RBD_OIL',           'RBD තෙල්',          'RBD oil',                       false, '{LITER,KG,BOTTLE}', 2, true, now()),
  ('SUNFLOWER_OIL',     'සූරියකාන්ත තෙල්',   'Sunflower oil',                 false, '{LITER,KG,BOTTLE}', 3, true, now()),
  ('FARM_OIL',          'Farm තෙල්',         'Farm oil',                      false, '{LITER,KG,BOTTLE}', 4, true, now()),
  ('WHITE_COCONUT_OIL', 'සුදු පොල් තෙල්',     'White coconut oil',             false, '{LITER,KG,BOTTLE}', 5, true, now()),
  ('CHARCOAL',          'පොල්කටු අඟුරු',     'Coconut-shell charcoal (bulk)', true,  '{KG}',              6, true, now()),
  ('OTHER',             'වෙනත්',             'Other (custom item)',           false, '{LITER,KG,BOTTLE}', 7, true, now())
ON CONFLICT ("code") DO UPDATE SET
  "name_si" = EXCLUDED."name_si",
  "name_en" = EXCLUDED."name_en",
  "is_charcoal" = EXCLUDED."is_charcoal",
  "allowed_units" = EXCLUDED."allowed_units",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = now();
