# පොල් තෙල් මෝල — Coconut Oil Mill POS

A production rebuild of the single-file prototype: React 18 + TypeScript PWA at the counter, Express + Prisma API, PostgreSQL on Supabase or Neon. Sales, purchases and cash entries keep working with no internet and sync when the connection returns.

```
coconut-pos/
├── server/                 Express API (Node 20+, TypeScript, Prisma)
│   ├── prisma/
│   │   ├── schema.prisma   Domain model
│   │   ├── migrations/     init + CHECK constraints / immutability triggers
│   │   └── seed.ts         Product catalog + first admin PIN
│   ├── scripts/set-pin.ts  PIN recovery tool
│   └── src/
│       ├── routes/         auth, sales, purchases, cash-entries, customers, cheques, stats, products
│       ├── services/       stats, charcoal stock + lock, audit log
│       └── lib/            validation (zod), decimal maths, periods, catalog
└── client/                 React PWA (Vite)
    └── src/
        ├── offline/        IndexedDB outbox + sync
        ├── screens/        Login, Sale, Purchase, Cash, Customers, Admin (Stats, History, Cheques, Settings)
        ├── components/     Segmented control, fields, readout, PIN pad, dialogs
        └── i18n/si.ts      Every UI string, ready for an en.ts later
```

## Local setup

> If the database step gives trouble, run `npm run check` in `server/` — it reads your
> `.env`, says exactly what is wrong in plain words (placeholder left in, a `/` in the
> password, wrong pooler port, IPv6-only host), and then tries the connection.


You need Node 20+ and a Postgres database. The quickest is a free Neon or Supabase project; a local Postgres works too.

```bash
# 1. API
cd server
cp .env.example .env          # fill in DATABASE_URL, DIRECT_URL, JWT_SECRET, the two PINs
npm install
npm run check                 # reads .env and tests the connection before anything else
npm run setup                 # prisma generate + migrate + seed, in one step
npm run dev                   # http://localhost:8080

# 2. App (second terminal)
cd client
npm install
npm run dev                   # http://localhost:5173 — /api is proxied to :8080
```

For a local Postgres, `DATABASE_URL` and `DIRECT_URL` can be the same plain URL without `?pgbouncer=true`.

Run the business-logic tests with `npm test` in `server/`. They cover totals rounding, cash balance, liters/KG rules, charcoal stock and the Sri Lanka time-zone period boundaries.

## Environment variables

### server/.env

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Pooled connection for the running app. Supabase: Transaction pooler (port 6543) + `?pgbouncer=true&connection_limit=5`. Neon: the `-pooler` host + the same params. |
| `DIRECT_URL` | yes | Direct connection used only by `prisma migrate`. Supabase: port 5432. Neon: host without `-pooler`. |
| `JWT_SECRET` | yes | 32+ random characters. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `INITIAL_ADMIN_PIN` | first deploy | 4–8 digits, the owner's PIN. Read only by the seed, only when that PIN doesn't exist. Remove it afterwards. |
| `INITIAL_USER_PIN` | first deploy | 4–8 digits, the counter PIN. Must differ from the admin PIN. |
| `USER_SESSION_TTL_MINUTES` | no | Default 720 (a working day). |
| `CORS_ORIGINS` | split deploy | Comma-separated frontend origins, e.g. `https://mill-pos.vercel.app`. |
| `ADMIN_SESSION_TTL_MINUTES` | no | Default 30. |
| `TRUST_PROXY` | no | Default 1 (Railway/Render). Needed so rate limiting sees real client IPs. |
| `SERVE_CLIENT_DIR` | no | Single-server mode: path to `client/dist`. |
| `BUSINESS_UTC_OFFSET_MINUTES` | no | Default 330 (Sri Lanka). Defines "today / week / month / year". |
| `ALLOW_NEGATIVE_CHARCOAL_STOCK` | no | Default false: charcoal sales beyond recorded stock are refused. |
| `PORT` | no | Default 8080; Railway sets it. |

### client/.env

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Full API URL without trailing slash, e.g. `https://mill-pos-api.up.railway.app`. Leave empty in local dev and single-server mode. |

## Deployment

### 1. Database — Supabase or Neon

Create a project in the region closest to Sri Lanka (Supabase: Mumbai `ap-south-1`; Neon: Singapore). Copy both the pooled and the direct connection strings into the backend's variables as described above. Turn on daily backups (Supabase Pro / Neon point-in-time restore) — this is the business's financial record.

### 2. API — Railway

1. New Project → Deploy from GitHub → choose the repo, set **Root Directory** to `server`.
2. Add the variables from the table above (`INITIAL_ADMIN_PIN` included for the first deploy).
3. `server/railway.json` already sets: build `npm ci --include=dev && npm run build`, pre-deploy `npm run release` (runs migrations, then the idempotent seed), start `npm start`, health check `/api/health`.
4. Generate a public domain under Settings → Networking.
5. After the first successful deploy, delete `INITIAL_ADMIN_PIN` from the variables.

**Render instead:** Web Service, root `server`, build `npm ci --include=dev && npm run build`, pre-deploy command `npm run release` (or start command `npm run release && npm start` on the free plan), health check path `/api/health`.

### 3. App — Vercel

1. New Project → import the repo, set **Root Directory** to `client`. Vercel detects Vite; `client/vercel.json` adds the SPA rewrite and correct caching for the service worker.
2. Add `VITE_API_URL` = your Railway URL.
3. Deploy, then put the Vercel URL into the API's `CORS_ORIGINS` and redeploy the API.
4. On the counter phone/tablet, open the site and use "Add to Home Screen". It then opens full-screen and works offline.

### Alternative: one Node server for both

```bash
npm run build:single                           # builds client, then server
SERVE_CLIENT_DIR=../client/dist npm run start:single
```

Build the client with `VITE_API_URL` empty so it calls the same origin, and leave `CORS_ORIGINS` empty. On Railway, set Root Directory to the repo root, build command `npm run build:single`, pre-deploy `npm --prefix server run release`, start `npm run start:single`, and variable `SERVE_CLIENT_DIR=../client/dist`.

## Upgrading an existing install

The newest migration replaces device pairing with two PINs and splits each transaction's payment into cash / cheque / credit parts. Your existing admin PIN is carried across automatically; set the counter PIN with `INITIAL_USER_PIN` before seeding, or afterwards with `npm run set-pin -- user 1234`. Old transactions keep their single payment method as one part. Paired devices stop being a concept — everyone signs in with a PIN instead.

Earlier, this version added credit, customers, expenses, cheque deposit dates, the "වෙනත්" sale item, charcoal corrections and temporary access. Apply the two new migrations and re-seed (the seed adds the "වෙනත්" product and is safe to re-run):

```bash
cd server
npm install
npx prisma generate
npm run db:migrate
npm run db:seed
```

Existing rows are untouched: old sales and purchases keep `CASH`/`CHEQUE` and simply have no customer or deposit date.

## Operations

**First sign-in.** The seed creates both PINs from `INITIAL_ADMIN_PIN` and `INITIAL_USER_PIN`. Open the app, type one of them, and you're in — the counter PIN shows the four working tabs, the admin PIN adds පරිපාලක.

**Use `npm run` rather than `npx prisma`.** `npx` fetches the newest Prisma from the
internet when the project's own copy is missing, and newer majors renamed the commands
(`migrate` became `migration`) — which produces a confusing "no command registered"
error. The scripts below always use the version pinned in `package.json` (6.16.0, exact):
`npm run setup`, `npm run db:migrate`, `npm run db:seed`, `npm run check`.

**Forgot a PIN?** On a machine with production `DATABASE_URL`:

```bash
cd server && npm run set-pin -- admin 482913      # or: npm run set-pin -- user 1234
```

This invalidates every existing admin session and is written to the audit log.

**Reading the audit log:**

```sql
SELECT created_at, action, entity, entity_id, actor, device_id, reason
FROM audit_logs ORDER BY created_at DESC LIMIT 50;
```

`before`/`after` hold full JSON snapshots of the row. `device_id` identifies which phone or tablet made the change.

## API

All request/response bodies are JSON. Money and quantities are sent and returned as decimal strings (`"1250.00"`), never floats. Errors look like `{ "error": { "code": "…", "message": "…", "details": … } }`.

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
| POST | `/api/auth/login` | — | `{ pin }` → `{ token, role, expiresAt }`. One box, two PINs. Rate-limited. |
| GET | `/api/auth/session` | any | Role, expiry, and whether a lent window is open |
| POST | `/api/auth/change-pin` | PIN admin | `{ role, currentPin, newPin }` — the admin PIN sets both |

Every call carries `Authorization: Bearer <token>` from the sign-in. "device" in the table means any signed-in session; "admin" means the owner's PIN or a lent window; "PIN admin" means the owner's PIN only.

## How the important parts work

**Never losing a transaction.** When the cashier taps save, the transaction is written to IndexedDB first, then sent. If the send fails for network or server reasons, it stays queued and is retried in order (on reconnect, on returning to the app, and every 15 s) with backoff. Each transaction carries a device-generated `clientId` with a unique index in Postgres, so a retry of something the server already received returns the original row instead of creating a duplicate. If the server refuses a queued item (for example, not enough charcoal), it is kept and flagged in the status sheet for someone to retry or consciously discard. The status pill in the header always shows how many items are waiting.

**Two PINs, one box.** The app opens on a PIN pad and shows nothing until a PIN is entered. The counter PIN opens the working screens; the owner's PIN opens those plus the books. Which PIN was typed is decided on the server, and the session token carries the role. The counter session lasts the working day (`USER_SESSION_TTL_MINUTES`, 12 hours by default) and is kept on the device; an admin session lasts 30 minutes and is never stored, so a reload always brings the PIN pad back. There is no device pairing any more — a PIN is the only thing needed to start work.

**The price book.** One screen (the මිල button in the header, open to the counter as well as the owner) holds what a litre of each oil, each bottle size and each kilo of copra or charcoal costs. The sale and purchase forms fill the price in from it, so the cashier types a quantity and nothing else. Prices stand until someone changes them — nothing expires overnight. Typing a different price on a sale is allowed, and by default that new price is kept for next time; a tick box turns it into a one-off. Every change is in the audit log with who and when.

**Empty bottles and cans.** When a customer arrives without a container, the sale carries how many empties they bought and what each cost, priced from the same price book (Rs. 5 / 10 / 20 per bottle size, and a price for the can on KG sales). That money is part of the sale total and is also reported on its own line, so it is never mistaken for oil revenue — the litres and kilos sold don't move.

**Weight deductions on a purchase.** Copra arrives wet, in sacks, sometimes part-spoiled; charcoal arrives with sand in it. The purchase form takes the scale reading and, in an optional block, the weight to deduct for moisture, sacks, spoilage and dust. The price applies to the net weight only, and the breakdown is stored with the row, so the figure can still be explained to the supplier months later. Leave the block empty and the purchase behaves as it always did.

**Cash, credit and cheque, together.** Every sale and purchase can be paid any way, including all three at once: Rs. 2,000 cash + Rs. 2,000 cheque + Rs. 6,000 on credit for a Rs. 10,000 sale. The three parts are stored separately and the database refuses any row whose parts don't add up to the total. Choosing one method puts the whole amount there; බෙදා opens three boxes with a running remainder so the cashier can see what is still unaccounted for. Cheque details are required as soon as a cheque part exists, and a customer as soon as a credit part exists — a debt nobody owes is not a debt. A cheque must carry the date it can be banked, so Admin → චෙක්පත් can answer "what goes to the bank today?" for cheques taken on sales, written for purchases, and exchanged when a customer settles. Neither credit nor a cheque moves the drawer; only cash does, on the day it changes hands.

**One visit, both directions.** Someone arrives with copra and leaves with oil. The එකට tab takes both halves — anything they brought, anything they took — and shows the difference, which is settled once: cash, cheque, or (only when a name is picked) left on the ledger as credit. **No customer is needed**; most people who walk in are not on any list, and the name field is there for the regulars.

The same visit can also be built from the ordinary screens, which is how it usually goes at the counter: weigh the copra on the purchase screen, press "මේ ගනුදෙනුවටම විකුණුමක් එකතු කරන්න", and the app carries that line over and opens the sale screen. A strip across the top of both screens shows how many lines the visit holds and what is still owed either way; tapping it goes to the එකට tab to settle.

Underneath, both halves are recorded in full, because both really happened: the part that cancels out is cash on each side, so the drawer nets to zero for it, and only the leftover carries the chosen method. A Rs. 48,500 copra purchase against a Rs. 4,050 oil sale settled by cheque becomes a purchase of 44,450 cheque + 4,050 cash and a sale of 4,050 cash — the drawer is unchanged, one cheque goes out, and the stock figures are right. It all queues offline like everything else.

**Daily customers.** The people who take oil now and pay at the end of the month live in their own tab, on the counter side rather than behind the PIN — the person at the counter is the one who gets asked "how much do I owe?". A balance is never stored, only recomputed: credit sales − settlements received − credit purchases + settlements paid. That way a deleted sale or payment can never leave a phantom debt behind. Positive means they owe the mill, negative means the mill owes them. A customer with an outstanding balance cannot be removed.

**Expenses.** A `වියදම්` cash entry leaves the drawer and must say what it was for — at least three characters, enforced in the database as well as the form. An expense without a purpose is an unexplained hole in the till.

**Charcoal corrections.** Weighing and moisture loss mean computed stock rarely lands on zero when a batch sells out. The ⟲ button on the summary screen records what is actually in the store (usually 0) with a reason. Nothing in the history is edited — a signed correction row is added, and stock becomes purchases − sales + corrections.

**Temporary admin access.** From Admin → සැකසුම්, the owner can open a window of 30 minutes to 8 hours. During it, anyone signed in with the counter PIN gets a පරිපාලක tab holding the summary, the history and the cheque list — never the PINs or the power to lend access. The window is checked against the clock on every single request, so it stops the moment it expires or is ended early; nothing is cached in a token.

**Money maths.** Totals are computed only on the server with `decimal.js` as `round(quantity × price, 2)` half-up, stored as `DECIMAL`, and double-checked by a database `CHECK` constraint. The totals the client shows while typing are previews.

**Charcoal stock** = Σ charcoal purchases − Σ charcoal sales (non-deleted), always all-time. Every write that changes it takes a Postgres transaction-scoped advisory lock, so two simultaneous charcoal sales can't both pass the stock check.

**Cash balance** = Σ cash entries + Σ cash sales − Σ cash purchases for the selected period; cheques are shown separately. "Today" therefore gives the cash drawer figure when the opening float is entered each morning.

**Liters sold** counts liter sales plus bottles converted by size (¼, ½, 1 L). **KG sold** excludes charcoal, which is reported on its own.

**Periods** are computed on the server in Sri Lanka time (UTC+5:30). Weeks start on Monday.

**Audit and immutability.** Every create, delete and PIN change writes an `audit_logs` row in the same transaction. Database triggers reject hard `DELETE`s on financial tables, reject any edit other than the soft-delete transition, and make the audit log append-only, so a stray SQL console session can't quietly rewrite history (a database owner could still disable the triggers deliberately).

**An expired session never loses work.** A 401 while a queued transaction is being sent is treated like being offline: it stays in the outbox and goes through as soon as someone signs in again.

**PINs.** Both are hashed with bcrypt (cost 12) and checked only on the server. Sign-in is limited to 5 wrong attempts per IP per 15 minutes, plus a 15-minute lock after 10 consecutive wrong PINs from anywhere. Changing a PIN bumps a version number embedded in that role's tokens, which ends every session opened with the old one. Only the admin PIN can change either PIN, so an unlocked tablet left on the counter can't be used to change the locks.

## Testing

`npm test` in `server/` runs the business-logic tests (17): rounding, the cash balance,
split payments, litres and kilos, charcoal stock and corrections, credit and the
Sri Lanka period boundaries.

The interface is checked by driving it in a browser against a stand-in API — sign-in for
both roles, the price book, sales with bottles and containers, split payments, purchases
with weight deductions, expenses, one-visit trading, customers and their ledgers, personal
loans, bills, the offline queue, an expired session, deleting with a reason, charcoal
corrections and lent admin access.

## Known limits and next steps

- A customer must be created while online: a credit sale needs a real customer id to point at. Sales, purchases, cash entries and settlements all still queue offline as before.
- The counter PIN is shared by whoever works the counter, so the audit log records the browser install that recorded each row, not a named person. If a member of staff leaves, change the counter PIN — every session opened with the old one ends at once.
- The stats, history and PIN screens need a connection; only recording transactions works offline.
- Transactions queued offline for more than 30 days are refused by the server and will appear as "needs attention".
