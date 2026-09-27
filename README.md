# පොල් තෙල් මෝල — Coconut Oil Mill POS

A production rebuild of the single-file prototype: a React 18 + TypeScript PWA at the counter (hosted on Vercel) and the API as one Supabase Edge Function (Deno + Hono) in front of Supabase Postgres. Sales, purchases and cash entries keep working with no internet and sync when the connection returns.

```
coconut-pos/
├── supabase/                 Backend — deployed to Supabase
│   ├── config.toml           Function settings (verify_jwt = false: the app signs its own sessions)
│   ├── migrations/           Schema, CHECK constraints, immutability triggers, RLS, accounts, product catalog
│   └── functions/api/        The whole REST API as one edge function
│       ├── index.ts          Hono app: CORS, routing, error shape
│       ├── routes/           auth, sales, purchases, cash-entries, customers, cheques, stats, products, prices, bills
│       ├── services/         stats, charcoal stock + lock, customer balances, audit log
│       ├── middleware/       sessions, per-IP sign-in rate limit (kept in Postgres)
│       └── lib/              validation (zod), decimal maths, periods, catalog
└── client/                   Frontend — deployed to Vercel
    └── src/
        ├── offline/          IndexedDB outbox + sync
        ├── screens/          Login, Sale, Purchase, Cash, Customers, Admin (Stats, History, Cheques, Settings)
        ├── components/       Segmented control, fields, readout, dialogs
        └── i18n/si.ts        Every UI string, ready for an en.ts later
```

The edge function talks to Postgres directly (postgres.js over `SUPABASE_DB_URL`), not through the Supabase REST API, so transactions, the charcoal advisory lock and the single-snapshot stats are real database transactions.

## Accounts

Sign-in is a username and a password, checked against the `app_users` table:

| Username | First password | Opens |
|---|---|---|
| `admin` | `9999` | The counter screens plus පරිපාලක (the books, cheques, settings) |
| `user` | `1234` | The counter screens |

Both are created by the migration `20260927000100_app_users.sql`. **Change them after the first sign-in** from පරිපාලක → සැකසුම් (only the admin can change either password). Passwords are stored as bcrypt hashes; the plain values above only exist in that migration file.

## Environment variables

| Where | Variable | Purpose |
|---|---|---|
| **Vercel** (and `client/.env` for local builds) | `VITE_API_URL` | `https://<project-ref>.supabase.co/functions/v1` — no trailing slash. The app appends `/api/...`. |
| | `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key (`sb_publishable_…`, Dashboard → Project Settings → API Keys). Only opens the live-update channel; without it the app works but is not live. |
| **Supabase function secrets** (`supabase/functions/.env`) | `JWT_SECRET` | 32+ random characters that sign the session tokens. |
| | `CORS_ORIGINS` | Your Vercel URL(s), comma-separated. Empty allows any origin (tokens travel in a header, never in cookies). |
| | `USER_SESSION_TTL_MINUTES` / `ADMIN_SESSION_TTL_MINUTES` | Default 720 / 30. |
| | `BUSINESS_UTC_OFFSET_MINUTES` | Default 330 (Sri Lanka). Defines "today / week / month / year". |
| | `ALLOW_NEGATIVE_CHARCOAL_STOCK` | Default false: charcoal sales beyond recorded stock are refused. |
| | `SUPABASE_DB_URL` | Injected by Supabase automatically; nothing to set. |
| **Supabase CLI** (`supabase/.env`, local only) | `SUPABASE_DB_PASSWORD` | Database password for `db push`. Never committed. |

The only Supabase key the app uses is the **publishable** key, and only for live updates. It is meant to be public: every table has row level security with no read policy, so the key cannot read or change the books. The service-role / secret key is never used.

## Deployment

### 1. Backend — Supabase

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push                                            # applies supabase/migrations
npx supabase secrets set --env-file supabase/functions/.env     # JWT_SECRET, CORS_ORIGINS, ...
npx supabase functions deploy api
curl https://<project-ref>.supabase.co/functions/v1/api/health
```

Or from the repo root: `npm run db:push`, `npm run secrets:push`, `npm run deploy:functions`. Turn on daily backups (Supabase Pro) — this is the business's financial record.

### 2. Frontend — Vercel

1. New Project → import the repo. Either set **Root Directory** to `client`, or leave it at the repo root — the root `vercel.json` then builds `client/` and serves `client/dist`. Vercel detects Vite; `client/vercel.json` adds the SPA rewrite and correct caching for the service worker.
2. Environment Variables → add `VITE_API_URL` = `https://<project-ref>.supabase.co/functions/v1` and `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key. Redeploy after changing either — they are built into the app.
3. Deploy, then put the Vercel URL into the function's `CORS_ORIGINS`: `npx supabase secrets set CORS_ORIGINS=https://your-app.vercel.app`.
4. On the counter phone/tablet, open the site and use "Add to Home Screen". It then opens full-screen and works offline.

## Local development

```bash
npm --prefix client install    # once
npm run dev                    # http://localhost:5173
```

What the app talks to depends on `client/.env`:

- **`VITE_API_URL=https://<project-ref>.supabase.co/functions/v1`** (the default in this repo) — the local app uses the **live** edge function and the **real** database. Anything recorded while testing lands in the business's books.
- **`VITE_API_URL` empty** — Vite proxies `/api` to a local function on `http://127.0.0.1:54321/functions/v1`. Run a local stack first (needs Docker):

  ```bash
  cp supabase/functions/.env.example supabase/functions/.env   # set JWT_SECRET
  npx supabase start                                           # local Postgres + runs supabase/migrations
  npm run dev:functions                                        # serves the api function locally
  ```

  The local database gets the same `admin` / `user` accounts and product catalog from the migrations.

### Root scripts

| Script | What it does |
|---|---|
| `npm run dev` | Starts the client (Vite) |
| `npm run dev:functions` | Serves the edge function locally with `supabase/functions/.env` |
| `npm test` | Business-logic tests under Deno (fetched by `npx`) |
| `npm run check:functions` | Type-checks the edge function |
| `npm run db:push` | Applies new files in `supabase/migrations/` to the linked project |
| `npm run secrets:push` | Uploads `supabase/functions/.env` as the function's secrets |
| `npm run deploy:functions` | Deploys the `api` function |

## Operations

**Changing the schema.** Add a new file to `supabase/migrations/` (`npx supabase migration new <name>`) and run `npx supabase db push`. Never edit a migration that has already been pushed.

**Forgot a password?** In the Supabase dashboard → SQL Editor:

```sql
UPDATE app_users
SET password_hash = extensions.crypt('482913', extensions.gen_salt('bf', 12)),
    pin_version = pin_version + 1, failed_attempts = 0, locked_until = NULL, updated_at = now()
WHERE username = 'admin';      -- or 'user'
```

This ends every session opened with the old password.

**Reading the audit log:**

```sql
SELECT created_at, action, entity, entity_id, actor, device_id, reason
FROM audit_logs ORDER BY created_at DESC LIMIT 50;
```

`before`/`after` hold full JSON snapshots of the row. `device_id` identifies which phone or tablet made the change.

## API

Paths are relative to `https://<project-ref>.supabase.co/functions/v1` (locally `http://127.0.0.1:54321/functions/v1`). All request/response bodies are JSON. Money and quantities are sent and returned as decimal strings (`"1250.00"`), never floats. Errors look like `{ "error": { "code": "…", "message": "…", "details": … } }`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | — | DB ping |
| GET | `/api/products` | — | Catalog |
| POST | `/api/sales` | session | `{ clientId, productCode, unitType, bottleSize?, customName?, quantity, pricePerUnit, cashAmount, chequeAmount, creditAmount, chequeNumber?, chequeDepositDate?, customerId?, occurredAt? }`. The three parts must add up to quantity × price. → 201, or 200 if `clientId` was already recorded |
| GET | `/api/sales?period=today\|week\|month\|year\|all&limit=&cursor=&includeDeleted=` | admin | `{ items, nextCursor }` |
| DELETE | `/api/sales/:id` | admin | Body `{ reason }` — soft delete |
| POST / GET / DELETE | `/api/purchases…` | same | `{ clientId, material: COPRA\|CHARCOAL\|OTHER, customName?, quantityKg, pricePerKg, cashAmount, chequeAmount, creditAmount, chequeNumber?, chequeDepositDate?, customerId?, occurredAt? }` |
| POST / GET / DELETE | `/api/cash-entries…` | same | `{ clientId, type: OPENING_FLOAT\|TOP_UP\|EXPENSE, amount, note?, occurredAt? }`. A note is required for an expense. |
| GET | `/api/stats?period=…` | admin | Cash balance, sales/purchase totals, cheque totals, liters/KG sold, charcoal stock, per-product breakdown |
| GET / PUT | `/api/prices` | session | The standing price book: `sale:<product>:<unit>`, `purchase:<material>`, `container:BOTTLE:<size>`, `container:CAN`. PUT takes `{ prices: [{ id, amount }] }`. |
| GET | `/api/customers?q=` | session | Daily customers with their balances |
| POST | `/api/customers` | session | `{ clientId, name, phone?, note? }` |
| GET | `/api/customers/:id` | session | Profile: balance plus the transactions behind it |
| PATCH / DELETE | `/api/customers/:id` | admin | Edit details / remove (refused while a balance is outstanding) |
| POST | `/api/customer-payments` | session | `{ clientId, customerId, direction: RECEIVED\|PAID, method: CASH\|CHEQUE, amount, chequeNumber?, chequeDepositDate?, note? }` |
| DELETE | `/api/customer-payments/:id` | admin | Soft delete with a reason |
| GET | `/api/cheques?from=&to=` | admin | Cheques due for deposit, in and out, with totals |
| GET / POST | `/api/charcoal/adjustments` | admin | Correct charcoal stock: `{ clientId, countedKg, reason }` |
| POST / GET / DELETE | `/api/auth/temporary-access` | admin | Lend the counter the admin screens for a while, see it, end it |
| POST | `/api/auth/login` | — | `{ username, password }` → `{ token, role, username, expiresAt }`. Rate-limited. |
| GET | `/api/auth/session` | any | Role, username, expiry, and whether a lent window is open |
| POST | `/api/auth/change-pin` | admin account | `{ role: USER\|ADMIN, currentPin, newPin }` — changes that account's password; `currentPin` is the admin's own password |

Every call carries `Authorization: Bearer <token>` from the sign-in. "session" in the table means any signed-in account; "admin" means the admin account or a lent window; "admin account" means the admin account only.

## How the important parts work

**Live updates.** Every screen stays current without a reload. A statement-level trigger on each table the screens show (`sales`, `purchases`, `cash_entries`, `customers`, `customer_payments`, `charcoal_adjustments`, `prices`, `products`, `temporary_admin_access`) sends a one-line signal such as `{"table":"sales","op":"INSERT"}` on the public Realtime channel `pos-changes`. Screens showing that table fetch again through the API with their own session: the price book and product list on the sale and purchase screens, the customer picker and balances, a customer's ledger, the summary, history and cheques, and a lent admin window (which now reaches the counter at once instead of at the next sign-in). Signals are held until they stop arriving for 0.7 s (at most 2.5 s), so a visit saved as a purchase, a sale and a settlement appears on every screen in one refresh rather than half at a time; each screen also ignores any response that is older than one it has already asked for, so an overlapping slow fetch can never put stale figures back; after the connection drops, or when the tablet wakes, everything is fetched again to catch up. The signal carries no figures, so the public channel leaks nothing, and a failure to send it never blocks a write.

**Never losing a transaction.** When the cashier taps save, the transaction is written to IndexedDB first, then sent. If the send fails for network or server reasons, it stays queued and is retried in order (on reconnect, on returning to the app, and every 15 s) with backoff. Each transaction carries a device-generated `clientId` with a unique index in Postgres, so a retry of something the server already received returns the original row instead of creating a duplicate. If the server refuses a queued item (for example, not enough charcoal), it is kept and flagged in the status sheet for someone to retry or consciously discard. The status pill in the header always shows how many items are waiting.

**Two accounts.** The app opens on a sign-in form and shows nothing until a username and password are entered. The `user` account opens the working screens; `admin` opens those plus the books. The role comes from the account on the server, and the session token names the account. Both sessions are kept on the device, so reloading the page or reopening the tab does not sign anyone out. The counter session lasts the working day (`USER_SESSION_TTL_MINUTES`, 12 hours by default); an admin session lasts `ADMIN_SESSION_TTL_MINUTES` (30 by default), and signing out ends either at once.

**The price book.** One screen (the මිල button in the header, open to the counter as well as the owner) holds what a litre of each oil, each bottle size and each kilo of copra or charcoal costs. The sale and purchase forms fill the price in from it, so the cashier types a quantity and nothing else. Prices stand until someone changes them — nothing expires overnight. Typing a different price on a sale is allowed, and by default that new price is kept for next time; a tick box turns it into a one-off. Every change is in the audit log with who and when.

**Empty bottles and cans.** When a customer arrives without a container, the sale carries how many empties they bought and what each cost, priced from the same price book (Rs. 5 / 10 / 20 per bottle size, and a price for the can on KG sales). That money is part of the sale total and is also reported on its own line, so it is never mistaken for oil revenue — the litres and kilos sold don't move.

**Weight deductions on a purchase.** Copra arrives wet, in sacks, sometimes part-spoiled; charcoal arrives with sand in it. The purchase form takes the scale reading and, in an optional block, the weight to deduct for moisture, sacks, spoilage and dust. The price applies to the net weight only, and the breakdown is stored with the row, so the figure can still be explained to the supplier months later. Leave the block empty and the purchase behaves as it always did.

**Cash, credit and cheque, together.** Every sale and purchase can be paid any way, including all three at once: Rs. 2,000 cash + Rs. 2,000 cheque + Rs. 6,000 on credit for a Rs. 10,000 sale. The three parts are stored separately and the database refuses any row whose parts don't add up to the total. Choosing one method puts the whole amount there; බෙදා opens three boxes with a running remainder so the cashier can see what is still unaccounted for. Cheque details are required as soon as a cheque part exists, and a customer as soon as a credit part exists — a debt nobody owes is not a debt. A cheque must carry the date it can be banked, so Admin → චෙක්පත් can answer "what goes to the bank today?" for cheques taken on sales, written for purchases, and exchanged when a customer settles. Neither credit nor a cheque moves the drawer; only cash does, on the day it changes hands.

**One visit, both directions.** Someone arrives with copra and leaves with oil. The එකට tab takes both halves — anything they brought, anything they took — and shows the difference, which is settled once: cash, cheque, or (only when a name is picked) left on the ledger as credit. **No customer is needed**; most people who walk in are not on any list, and the name field is there for the regulars.

The same visit can also be built from the ordinary screens, which is how it usually goes at the counter: weigh the copra on the purchase screen, press "මේ ගනුදෙනුවටම විකුණුමක් එකතු කරන්න", and the app carries that line over and opens the sale screen. A strip across the top of both screens shows how many lines the visit holds and what is still owed either way; tapping it goes to the එකට tab to settle.

Underneath, both halves are recorded in full, because both really happened: the part that cancels out is cash on each side, so the drawer nets to zero for it, and only the leftover carries the chosen method. A Rs. 48,500 copra purchase against a Rs. 4,050 oil sale settled by cheque becomes a purchase of 44,450 cheque + 4,050 cash and a sale of 4,050 cash — the drawer is unchanged, one cheque goes out, and the stock figures are right. It all queues offline like everything else.

**Daily customers.** The people who take oil now and pay at the end of the month live in their own tab, on the counter side rather than behind the admin account — the person at the counter is the one who gets asked "how much do I owe?". A balance is never stored, only recomputed: credit sales − settlements received − credit purchases + settlements paid. That way a deleted sale or payment can never leave a phantom debt behind. Positive means they owe the mill, negative means the mill owes them. A customer with an outstanding balance cannot be removed.

**Expenses.** A `වියදම්` cash entry leaves the drawer and must say what it was for — at least three characters, enforced in the database as well as the form. An expense without a purpose is an unexplained hole in the till.

**Charcoal corrections.** Weighing and moisture loss mean computed stock rarely lands on zero when a batch sells out. The ⟲ button on the summary screen records what is actually in the store (usually 0) with a reason. Nothing in the history is edited — a signed correction row is added, and stock becomes purchases − sales + corrections.

**Temporary admin access.** From Admin → සැකසුම්, the owner can open a window of 30 minutes to 8 hours. During it, anyone signed in as `user` gets a පරිපාලක tab holding the summary, the history and the cheque list — never the passwords or the power to lend access. The window is checked against the clock on every single request, so it stops the moment it expires or is ended early; nothing is cached in a token.

**Money maths.** Totals are computed only on the server with `decimal.js` as `round(quantity × price, 2)` half-up, stored as `DECIMAL`, and double-checked by a database `CHECK` constraint. The totals the client shows while typing are previews.

**Charcoal stock** = Σ charcoal purchases − Σ charcoal sales (non-deleted), always all-time. Every write that changes it takes a Postgres transaction-scoped advisory lock, so two simultaneous charcoal sales can't both pass the stock check.

**Cash balance** = Σ cash entries + Σ cash sales − Σ cash purchases for the selected period; cheques are shown separately. "Today" therefore gives the cash drawer figure when the opening float is entered each morning.

**Liters sold** counts liter sales plus bottles converted by size (¼, ½, 1 L). **KG sold** excludes charcoal, which is reported on its own.

**Periods** are computed on the server in Sri Lanka time (UTC+5:30). Weeks start on Monday.

**Audit and immutability.** Every create, delete and password change writes an `audit_logs` row in the same transaction. Database triggers reject hard `DELETE`s on financial tables, reject any edit other than the soft-delete transition, and make the audit log append-only, so a stray SQL console session can't quietly rewrite history (a database owner could still disable the triggers deliberately).

**An expired session never loses work.** A 401 while a queued transaction is being sent is treated like being offline: it stays in the outbox and goes through as soon as someone signs in again.

**Passwords.** Both are hashed with bcrypt (cost 12) and checked only on the server. Sign-in is limited to 5 wrong attempts per IP per 15 minutes, plus a 15-minute lock on an account after 10 wrong passwords in a row. Changing a password bumps a version number embedded in that account's tokens, which ends every session opened with the old one. Only the admin can change either password, so an unlocked tablet left on the counter can't be used to change the locks.

## Testing

`npm test` at the repo root runs the business-logic tests (17): rounding, the cash balance,
split payments, litres and kilos, charcoal stock and corrections, credit and the
Sri Lanka period boundaries.

The interface is checked by driving it in a browser against a stand-in API — sign-in for
both accounts, the price book, sales with bottles and containers, split payments, purchases
with weight deductions, expenses, one-visit trading, customers and their ledgers, personal
loans, bills, the offline queue, an expired session, deleting with a reason, charcoal
corrections and lent admin access.

## Known limits and next steps

- A customer must be created while online: a credit sale needs a real customer id to point at. Sales, purchases, cash entries and settlements all still queue offline as before.
- The `user` account is shared by whoever works the counter, so the audit log records the browser install that recorded each row, not a named person. If a member of staff leaves, change its password — every session opened with the old one ends at once.
- The stats, history and settings screens need a connection; only recording transactions works offline.
- Transactions queued offline for more than 30 days are refused by the server and will appear as "needs attention".
