-- The API now runs as a Supabase Edge Function.
--
-- 1. Edge function instances share no memory, so the per-IP limit on wrong PINs is
--    counted here instead of in the Node process.
CREATE TABLE "rate_limit_hits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "hits" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("key")
);

-- 2. Supabase publishes every table in "public" through its REST API (PostgREST) to
--    anyone holding the project's anon key. Nothing in this app uses that API: the edge
--    function connects as the table owner, which row level security does not restrict.
--    Enabling RLS with no policies closes the REST door on every table.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
