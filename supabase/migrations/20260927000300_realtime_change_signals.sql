-- Live updates: every committed change to a table the screens show sends a one-line
-- signal on the public Realtime channel "pos-changes", e.g. {"table":"sales","op":"INSERT"}.
-- Open screens that show that table fetch fresh data through the API, with the viewer's
-- own session.
--
-- The signal carries no row data, only which table changed: the channel is public
-- (the app has no Supabase Auth users), so nothing sensitive may travel on it.
-- realtime.send() writes inside the same transaction, so a rolled-back sale sends nothing.

CREATE OR REPLACE FUNCTION public.pos_signal_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
    'change',
    'pos-changes',
    false
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A live-update hiccup must never block recording a sale.
  RETURN NULL;
END;
$$;

-- One signal per statement, not per row.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales', 'purchases', 'cash_entries', 'customers', 'customer_payments',
    'charcoal_adjustments', 'prices', 'products', 'temporary_admin_access'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_signal_change', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.pos_signal_change()',
      t || '_signal_change', t
    );
  END LOOP;
END $$;
