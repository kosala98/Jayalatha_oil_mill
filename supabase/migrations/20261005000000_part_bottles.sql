-- Customers ask for part bottles (1.5 bottles, 2.25 bottles), so a bottle sale's
-- quantity no longer has to be a whole number. The column stays DECIMAL(12,3), and
-- the server still requires a bottle size and a positive quantity.
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_bottle_qty_whole";
