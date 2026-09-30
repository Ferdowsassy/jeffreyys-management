# Jeffreyys local API

Node ES modules + Express with MySQL/MariaDB production persistence. Run from the project root:

```sh
node server/index.js
node --test server/*.test.js
```

Production is served by the same process after `npm run build`; use `npm start` and the required variables in `DEPLOYMENT.md`. The default non-production listener is `127.0.0.1:3001`. `PORT`, `HOST`, and `DATA_FILE` override it. The store enforces a one-writer lock. The frontend should proxy `/api` to this listener in development.

## Authentication and demo

First run seeds clearly marked demo records with Munich-calendar dates and relative ISO timestamps. Active accounts:

| id | Name | Role | Demo PIN |
|---|---|---|---|
| alex | Alex | chef | 1234 |
| samira | Samira | kitchen | 2345 |
| leo | Leo | driver | 3456 |
| mia | Mia | driver | 4567 |

These are **public demo credentials**, not production secrets. Production starts with demo mode disabled, requires an explicit bootstrap owner, and accepts 8–12 digit PINs only. PINs are persisted as salted scrypt hashes and never returned by an endpoint. Never use demo mode with real information.

Production serves the built client and API only behind a configured HTTPS proxy; direct non-health HTTP requests receive 426. Sessions are random 256-bit tokens in an HttpOnly, Secure, SameSite=Strict cookie in production, with a 12-hour expiry. They are memory-only and disappear on restart. Login is limited to 20 attempts per IP per 15 minutes; AI to 10 calls per employee per minute. Foreign POST origins are rejected, and role/active status is rechecked on every request and queued transaction.

## API contract

All JSON errors: `{ "error": "Human-readable explanation" }`. Validation 400, unauthenticated 401, unauthorized 403, missing record 404, state conflict 409, rate limit 429, AI not configured 503.

- `GET /api/session` → `{user:null}` or `{user:Employee}`. Kitchen sessions exclude financial fields.
- `GET /api/people` → `{demo:boolean,people:[{id,name,role}]}` for active employees; public.
- `POST /api/login` `{id,pin}` → `{user}` and session cookie. PIN is a string of 4–12 digits in demo mode and 8–12 digits in production.
- `POST /api/logout` `{}` → `{ok:true}`; revokes session and closes its SSE streams.
- `GET /api/state` → state described below.
- `GET /api/events` → authenticated SSE; `ready` and `invalidate` named events, both with `{}` data. Subscribe with `eventSource.addEventListener('invalidate', refetch)`. Heartbeats every 15 seconds; no private records are streamed. Sessions are rechecked on heartbeat/invalidation.
- `GET /api/export` → chef-only JSON download of sanitized full state; excludes PIN hashes.
- `POST /api/action` → `{ok:true,result:recordOrNull,state:roleFilteredState}`. Payload includes `type` plus the fields listed below. Monetary input values are **numeric euros**, not cents or localized strings.

### State schema

```text
{
  employees: Employee[], orders: Order[], shifts: Shift[],
  schedule: Schedule[], zones: Zone[], tasks: Task[],
  handoffs: Handoff[], settings: Settings, audit: Audit[],
  payroll: Payroll[]
}
Employee = {id,name,role:'chef'|'kitchen'|'driver',hourlyRate,active,
            wageHistory:[{effectiveDate:'YYYY-MM-DD',hourlyRate}],demo,
            location?:{latitude,longitude,updatedAt}}
Order = {id,employeeId,shiftId,address,postalCode,city,amount,
         payment:'cash'|'online',orderNumber,status:'open'|'delivered',
         createdAt,deliveredAt:null|ISO,deliveryFee,noAddress,demo}
Shift = {id,employeeId,start:ISO,end:null|ISO,hourlyRate,demo}
Schedule = {id,employeeId,date:'YYYY-MM-DD',start:'HH:mm',end:'HH:mm',demo}
Zone = {id,postalCode,name,fee,effectiveDate,
        feeHistory:[{effectiveDate,fee}],demo}
Task = {id,text,done,createdAt,demo}
Handoff = {id,employeeId,shiftId,expected,counted:null|number,
           driverConfirmed,chefConfirmed,createdAt,demo,
           confirmedAt?:ISO,confirmedBy?:employeeId}
Settings = {foodCostPercent:30,fixedCosts:2500,longShiftHours:8,flatFee:0,demo}
Audit = {id,type,employeeId,targetId?:string|null,createdAt,demo}
Payroll = {employeeId,hours,hourlyPay,deliveryPay,gross,collectedCash,
           returnedCash,retainedCash,payout,pendingHandoffs}
```

Timestamps are UTC ISO strings. Calendar dates and schedule wall times deliberately remain date/time-only strings; schedule times mean Europe/Berlin and `end < start` means overnight. Money is represented as euro numbers externally and calculated through integer cents internally. `fixedCosts` is a monthly estimate, not an automatically accrued ledger entry.

**Role filtering:** chef sees all sanitized records. Driver sees their own employee, orders, shifts, schedule, handoffs and payroll; all zones; no tasks/audit. Kitchen sees employee identity/active status, shift timing, schedules, tasks, and order status/number/timestamps only; never wages, payroll amounts, customer addresses, locations, order amounts or financial settings. Non-chef settings contain only `longShiftHours`.

### Actions

| type | Payload | Permissions / behavior |
|---|---|---|
| clockIn | none | Own shift, any role; snapshots effective wage; conflict if already active |
| clockOut | `cashConfirmed:boolean` | Own shift; refuses open orders; driver receives one handoff for this shift |
| addOrder | `address,postalCode,city,amount,payment,orderNumber,noAddress?:boolean,employeeId?:string` | Driver/chef; must have active shift; chef may choose employee; snapshots delivery fee |
| delivered | `id` | Driver's own order or chef; idempotent |
| addTask | `text,visibility?:'team'|'chef'` | Kitchen/chef; only chefs may create chef-only tasks |
| toggleTask | `id` | Kitchen/chef |
| saveEmployee | `id?,name,role,pin?,hourlyRate,effectiveDate?` | Chef; PIN required when creating; effective date defaults to Munich today; keeps last active chef |
| deactivateEmployee | `id` | Chef; not self, not with open orders/active shift |
| saveZone | `id?,postalCode,name,fee,effectiveDate?` | Chef; unique five-digit postal code; effective date defaults to today |
| saveSchedule | `employeeId,date,start,end` | Chef; upserts one shift per employee/date; overnight permitted |
| copyWeek | `weekStart` | Chef; copies the previous seven-day range into the displayed week; skips existing employee/date entries |
| saveSettings | any of `foodCostPercent,fixedCosts,longShiftHours,flatFee` | Chef; partial updates preserve omitted values; percentages 0–100, threshold 1–24 hours |
| confirmHandoff | `id,counted` | Chef; counted physical cash, one confirmation only |
| updateShift | `id,start,end` | Chef; ISO timestamps, nullable end; rejects future times, overlap, duplicate active shifts; preserves wage snapshot |
| clearDemo | none | Chef; removes demo orders/shifts/schedules/tasks/handoffs/audit; retains accounts and zones, removes their demo flags to preserve access/configuration |
| reset | `confirmation:'RESET'` | Chef; replaces data with fresh demo seed and revokes all sessions; frontend must sign in again |
| saveLocation | `latitude,longitude` | Driver/chef; updates own last location; validated ranges |

`noAddress:true` stores empty address/postalCode/city and snapshots the configured `flatFee`. Unknown postal codes receive zero fee rather than a guessed rate. Order numbers must be unique per UTC date. New records have `demo:false`; seed records have `demo:true`. Demo account and zone configuration is retained on clearDemo intentionally; reset is the explicit destructive demo rebuild.

## Cash and payroll

- Snapshot hourly rate at clock-in and delivery fee at order creation; later rate edits do not rewrite history.
- Hours × snapshot wage is rounded once per shift to cents. Delivery pay includes only delivered orders.
- Cash collected includes **delivered cash orders only**. Online/open orders are not cash owed.
- `cashConfirmed:true` means the driver states that the complete expected shift cash was **physically handed back**, not merely that they checked the screen. Until chef counting, this return is provisional and `pendingHandoffs` signals that payroll is not settled.
- Chef-confirmed `counted` replaces (does not add to) the driver's provisional return.
- `retainedCash = max(0, collectedCash - returnedCash)`.
- `payout = hourlyPay + deliveryPay - retainedCash`. A negative payout means cash still owed; it is not silently clamped to zero. Returned cash is never subtracted from payroll a second time.

Payroll is a live all-record summary, not a legally certified payslip or a settlement-history system. Active shift hours continue growing. There is no tax/overtime engine, paid-out-period ledger, or statutory break calculation.

## Optional real AI

The driver receipt scanner uses on-device Tesseract OCR, self-hosted assets and deterministic field parsing. It never invokes the legacy AI receipt endpoint below. Users review and correct extracted fields before the normal validated `addOrder` transaction; the photo and raw OCR text are not saved or uploaded.

Set `OPENAI_API_KEY` in the backend process environment; optionally `OPENAI_MODEL` (default `gpt-4o-mini`). Do not put keys into frontend variables. Calls go to OpenAI Chat Completions with a 45-second timeout. No fabricated fallback exists.

- `POST /api/ai/receipt` (driver/chef): `{image:'data:image/jpeg;base64,...'}` (`imageDataUrl` alias accepted; PNG/JPEG/WebP). Response `{draft:{address,postalCode,city,amount,payment,orderNumber},requiresReview:true,warning}`. Missing/uncertain fields are requested as null. **Every field must be reviewed against the original**; model output is untrusted and is not automatically persisted. Saving still uses validated `addOrder`. Uploaded receipt images are transmitted to OpenAI only when this endpoint is invoked.
- `POST /api/ai/coach` (chef): `{question?:string,start?:ISO,end?:ISO}` → `{text,requiresReview:true}`. Sends selected anonymous order/payroll aggregates and settings for the requested period (maximum 366 days), not employee names, location, PIN hashes or customer addresses. Without explicit bounds it uses the previous 30 days.
- Without a key, both authorized endpoints return **HTTP 503: AI not configured**. Upstream failures are explicit 502/504 responses. Live AI inference was not tested because no credential was supplied.

## Persistence and operational boundaries

Production on Hostinger uses `mysql2` with InnoDB tables `jm_employees`, `jm_orders`, `jm_shifts`, `jm_schedule`, `jm_zones`, `jm_tasks`, `jm_handoffs`, `jm_audit`, and `jm_metadata`. Each record occupies its own database row; its validated fields are stored in a JSON column. This is database storage, not a JSON file. Queries use parameterized values. The metadata row lock serializes business transactions across connections; failed changes roll back, and a killed process cannot leave a stale lock file.

State is refreshed from database revisions before requests. SSE subscribers also check for committed external changes every two seconds. Sessions and rate limits are still process-local: deploy a single serving instance; users sign in again after an app restart. This does not provide a settlement ledger, statutory payroll calculation, tax engine, or geocoding provider.

The legacy filesystem store remains for local demos, existing file deployments, and isolated regression tests. MySQL configuration never falls back silently to it.

Tests cover real HTTP auth, role isolation, unauthorized writes, financial snapshots/cash reconciliation, validation/rollback, concurrent persistence, SSE, origin enforcement/rate limits, demo lifecycle, missing-key AI behavior, and the standalone entrypoint. Tests use isolated temporary data files and do not alter the running app's database.
