-- One-time repair, approved by the owner on 2026-10-02.
--
-- A visit (one bill: copra in, oil out) used to save each line with only the customer
-- picked on that line's own screen. A cash purchase weighed before the customer was
-- chosen was therefore saved with no customer and never appeared on their profile.
-- The app now gives the visit's customer to every line (CombinedScreen); this links
-- the lines saved before that fix.
--
-- Only rows with no customer are touched, and only on bills whose other lines name
-- exactly one customer. A row with a credit part always has a customer already, so no
-- balance changes: the profile's purchase/sale totals and its ledger gain the row.
-- Every change is written to the audit log.

CREATE TEMP TABLE visit_customer ON COMMIT DROP AS
SELECT bill_no, min(customer_id::text)::uuid AS customer_id
FROM (
  SELECT bill_no, customer_id FROM sales
    WHERE bill_no IS NOT NULL AND customer_id IS NOT NULL AND NOT is_deleted
  UNION ALL
  SELECT bill_no, customer_id FROM purchases
    WHERE bill_no IS NOT NULL AND customer_id IS NOT NULL AND NOT is_deleted
  UNION ALL
  SELECT bill_no, customer_id FROM customer_payments
    WHERE bill_no IS NOT NULL AND NOT is_deleted
) linked
GROUP BY bill_no
HAVING count(DISTINCT customer_id) = 1;

-- Financial rows are immutable. The guard stands aside for this one repair only,
-- inside this migration's transaction, and is switched back on below.
ALTER TABLE "purchases" DISABLE TRIGGER "purchases_immutable";
ALTER TABLE "sales" DISABLE TRIGGER "sales_immutable";

WITH fixed AS (
  UPDATE purchases p SET customer_id = v.customer_id
  FROM visit_customer v
  WHERE p.bill_no = v.bill_no AND p.customer_id IS NULL AND NOT p.is_deleted
  RETURNING p.id, p.bill_no, p.customer_id
)
INSERT INTO audit_logs (id, action, entity, entity_id, actor, before, after, reason)
SELECT gen_random_uuid(), 'UPDATE', 'PURCHASE', id::text, 'SYSTEM',
       jsonb_build_object('customerId', NULL),
       jsonb_build_object('customerId', customer_id, 'billNo', bill_no),
       'Linked to the customer of the same visit (bill)'
FROM fixed;

WITH fixed AS (
  UPDATE sales s SET customer_id = v.customer_id
  FROM visit_customer v
  WHERE s.bill_no = v.bill_no AND s.customer_id IS NULL AND NOT s.is_deleted
  RETURNING s.id, s.bill_no, s.customer_id
)
INSERT INTO audit_logs (id, action, entity, entity_id, actor, before, after, reason)
SELECT gen_random_uuid(), 'UPDATE', 'SALE', id::text, 'SYSTEM',
       jsonb_build_object('customerId', NULL),
       jsonb_build_object('customerId', customer_id, 'billNo', bill_no),
       'Linked to the customer of the same visit (bill)'
FROM fixed;

ALTER TABLE "purchases" ENABLE TRIGGER "purchases_immutable";
ALTER TABLE "sales" ENABLE TRIGGER "sales_immutable";
