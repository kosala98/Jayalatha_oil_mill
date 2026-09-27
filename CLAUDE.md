# CLAUDE.md

Coconut oil mill point-of-sale. The frontend is a React 18 + TypeScript PWA in `client/`, deployed to Vercel. The backend is a single Supabase Edge Function in `supabase/functions/api/` (Deno + Hono) in front of Supabase Postgres (project ref `yeudnyjyfbzrfxfedksp`). The UI is in Sinhala; every string lives in `client/src/i18n/si.ts`.

## Commands

```bash
npm run dev                  # client dev server, http://localhost:5173
npm test                     # edge-function unit tests (Deno via npx)
npm run check:functions      # type-check the edge function
npm run dev:functions        # serve the function locally (needs `npx supabase start`)
npm run db:push              # apply new supabase/migrations to the linked project
npm run secrets:push         # upload supabase/functions/.env as function secrets
npm run deploy:functions     # deploy the api function
```

Client type-check: `npx --prefix client tsc -p client/tsconfig.json --noEmit`. It currently reports ~70 errors from before the Supabase move; compare the count before and after a change rather than expecting zero.

## Layout

- `supabase/functions/api/index.ts` — Hono app with `basePath('/api')`. Supabase serves the function named `api` at `/functions/v1/api/...`, so routes keep the `/api/...` paths the client calls.
- `supabase/functions/api/routes/` — one Hono router per resource (sales, purchases, cash-entries, customers + customer-payments, cheques + charcoal, prices, products, bills, stats, auth).
- `supabase/functions/api/services/` — audit log, charcoal stock + advisory lock, customer balances, stats (`statsSummary.ts` is pure and unit-tested).
- `supabase/functions/api/lib/` — zod validation, decimal maths, Sri Lanka period boundaries, catalog, enum types.
- `supabase/functions/api/deno.json` — import map (npm: specifiers, pinned versions).
- `supabase/migrations/` — the only schema source. The first 12 files came from the old Prisma setup and are already applied remotely.
- `client/src/api/` — `http.ts` request helper, `endpoints.ts` typed calls, `errors.ts` error code → Sinhala message.
- `client/src/offline/` — IndexedDB outbox; every create is queued and retried.

## Backend conventions

- **Database access** is postgres.js over `SUPABASE_DB_URL` (`db.ts`), with `transform: postgres.camel`: write SQL in snake_case, and rows come back camelCased. Never use supabase-js or the REST API.
- **Model-shaped reads** use the column lists in `COLS` via `cols(db, 'sales')`. `device_id` is exposed as `installId`. Keep API responses field-for-field compatible; the client depends on them.
- **Money and quantities** stay strings end to end (Postgres `numeric` → string). Do the maths with `Dec` from `lib/decimal.ts`, never with JS numbers. Cheque deposit dates are `'YYYY-MM-DD'` strings cast with `::date`.
- **Every write** runs in `transaction(...)` and calls `writeAudit(tx, ...)` in the same transaction.
- **Creates are idempotent** on `clientId`: look it up first, and on a unique violation (`isUniqueViolation`) return the existing row with 200.
- **Financial rows are never hard-deleted or edited.** Soft delete sets `is_deleted`, `deleted_at` and `delete_reason`. Database triggers enforce this, so an UPDATE of any other column will fail.
- **Anything that changes charcoal stock** takes `lockCharcoalStock(tx)` before reading the stock.
- **Errors**: throw `HttpError(status, CODE, message, details?)`. Zod errors become `VALIDATION_ERROR` in `index.ts`. If you add a new code the UI should show, also add it to `client/src/api/errors.ts` and `si.ts`.
- **New ids** come from `gen_random_uuid()` in SQL. Tables with `updated_at` have no default on the old tables, so set `updated_at = now()` explicitly.

## Auth

- Username + password against `app_users`: one account per role, `admin` (ADMIN) and `user` (USER). Passwords are bcrypt cost 12 (`bcryptjs`), and in SQL `extensions.crypt(..., extensions.gen_salt('bf', 12))`.
- Sessions are the app's own HS256 JWTs (`jose`, secret `JWT_SECRET`) with `sub` = the `app_users.id`, plus `role` and `pv` (the password version). Every request re-reads the account, so bumping `pin_version` ends the old sessions.
- Middleware: `requireSession` (any account), `requireAdmin` (admin, or `user` during a temporary-access window), `requireFullAdmin` (the admin account only).
- The function is deployed with `verify_jwt = false` (`supabase/config.toml`). No Supabase anon or service key is used anywhere.
- Wrong passwords are limited per IP in the `rate_limit_hits` table (edge instances share no memory), and an account locks after 10 failures in a row.

## Schema changes

1. `npx supabase migration new <name>` and write the SQL. Never edit a migration that has already been pushed.
2. Enable RLS on every new table (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). The function connects as the table owner and is not restricted by it.
3. `ALTER TYPE ... ADD VALUE` must go in its own migration before any migration that uses the new value.
4. Test on a throwaway Postgres before `npm run db:push`. The remote database holds real business data.

## Environment files (all gitignored)

- `client/.env` — only `VITE_API_URL=https://yeudnyjyfbzrfxfedksp.supabase.co/functions/v1`. This points local dev at the **live** backend and real data. On Vercel it is set in the project settings.
- `supabase/functions/.env` — the function's secrets: `JWT_SECRET`, `CORS_ORIGINS`, session TTLs, `BUSINESS_UTC_OFFSET_MINUTES`, `ALLOW_NEGATIVE_CHARCOAL_STOCK`.
- `supabase/.env` — `SUPABASE_DB_PASSWORD` and the DB URLs for the Supabase CLI. Never put these in the client.

## Testing

- Unit tests: `npm test` (period boundaries, totals rounding, stats summary).
- For route or SQL changes, run the function against a local Postgres. Apply `supabase/migrations/*.sql` in order: create schema `extensions` first on plain Postgres, and set `PGCLIENTENCODING=UTF8` on Windows. Then start the function:

  ```bash
  JWT_SECRET=... SUPABASE_DB_URL=postgresql://... npx deno@2 run --allow-net --allow-env --allow-read supabase/functions/api/index.ts
  ```

  and drive the HTTP endpoints. Do not test against the live project.
