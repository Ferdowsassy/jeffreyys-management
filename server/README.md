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
           driverConfirmed,chefConfirmed,cashRetained,createdAt,demo,
           confirmedAt?:ISO,confirmedBy?:employeeId}
Settings = {foodCostPercent:30,fixedCosts:2500,longShiftHours:8,flatFee:0,demo}
Audit = {id,type,employeeId,targetId?:string|null,createdAt,demo}
Payroll = {employeeId,hours,hourlyPay,deliveryPay,gross,collectedCash,
           returnedCash,retainedCash,payout,pendingHandoffs}
```

Timestamps are UTC ISO strings. Calendar dates and schedule wall times deliberately remain date/time-only strings; schedule times mean Europe/Berlin and `end < start` means overnight. Money is represented as euro numbers externally and calculated through integer cents internally. `fixedCosts` is a monthly estimate, not an automatically accrued ledger entry.

**Role filtering:** chef sees all sanitized records. Driver sees their own employee, orders, shifts, schedule, handoffs and payroll; all zones; no tasks/audit. Kitchen sees employee identity/active status, shift timing, schedules, tasks, and order status/number/employee/timestamps. Kitchen also sees its own wage history, shift wage snapshots, phone, payroll and handoffs, plus financial fields of any own historical orders. Other employees' wages/phones, customer addresses, article details and financial settings are excluded. Active drivers' last shared locations are included while they have an open shift. Non-chef settings contain only `longShiftHours`.

Employees optionally have `phone` (up to 40 characters). Orders optionally have `items:[{name,quantity,unitPrice}]`; quantity is a positive integer up to 1000 and unit price is numeric euros. Up to 100 items are accepted per order. Both file and MySQL adapters persist these fields inside existing records. `addOrder` accepts items; chef or the owning driver can use `saveOrderItems {id,items}` without changing order totals, delivery fees or payment status. Chef `saveEmployee` accepts phone; omission preserves it, an empty string clears it. Chef `saveSchedule` accepts an optional existing `id` to move a schedule record; collision with another entry for the employee/date returns 409. Chef `deleteSchedule {id}` removes a planned shift, never recorded working time.

### Actions

| type | Payload | Permissions / behavior |
|---|---|---|
| clockIn | none | Own shift, any role; snapshots effective wage; conflict if already active |
| clockOut | No fields required | Own shift; automatically delivers open orders; cash retained and deducted from payout |
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
| saveLocation | `latitude,longitude,accuracy?,capturedAt?,employeeId?` | Driver/chef; updates own last location; drivers require an active shift; validates ranges, non-negative accuracy and fix age within 30 seconds |
| stopLocation | `employeeId?` | Driver/chef; clears own location, never another employee's |

`noAddress:true` stores empty address/postalCode/city and snapshots the configured `flatFee`. Unknown postal codes receive zero fee rather than a guessed rate. Order numbers must be unique per UTC date. New records have `demo:false`; seed records have `demo:true`. Demo account and zone configuration is retained on clearDemo intentionally; reset is the explicit destructive demo rebuild.

Location writes use the normal transaction and SSE invalidation path, but do not add audit entries. Clock-out and logout clear the last fix. Client GPS uploads include their employee ID to prevent a request queued by a previous login from updating a new session's employee. Live markers expire based on `capturedAt` (falling back to legacy `updatedAt`). Only the current fix is persisted, with optional accuracy in metres. Map tiles use `https://tile.openstreetmap.org`, visible attribution, browser HTTP caching and an origin-only referrer; no private APIs or app data are sent to the tile server.

## Cash and payroll

- Snapshot hourly rate at clock-in and delivery fee at order creation; later rate edits do not rewrite history.
- Hours × snapshot wage is rounded once per shift to cents. Delivery pay includes only delivered orders.
- Cash collected includes **delivered cash orders only**. Online/open orders are not cash owed.
- Clock-out always retains cash with the driver. Legacy handoffs with `driverConfirmed:true` still represent a provisional physical return until chef counting. New retained-cash records have `cashRetained:true` and do not count as pending physical handoffs.
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

### Employee time correction requests

Drivers and kitchen staff submit `requestShiftCorrection {shiftId,start,end,reason}` for their own shifts, or omit `shiftId` for a completely missed shift. Both proposed timestamps must be in the past; end must follow start. Requests are stored separately in `shiftRequests` and never change payroll before approval. Non-chef state responses include only the employee's own requests.

Chef `reviewShiftCorrection {id,decision:"approved"|"rejected"}` decides each pending request once. Approval rechecks overlap and the original shift snapshot, uses the existing cash handoff rules when closing an active shift, and applies the correction transactionally. A newly recorded missed shift uses the historical wage rate for its start date in Berlin. Rejection preserves recorded time. Requests retain the reason, original/proposed times, decision, reviewer and decision timestamp; actions enter the audit log. The owner sees a persistent in-app notification and pending count under Zeiten, updated through the existing live connection. No email or phone push is sent.

The file store initializes the new collection for existing files; MySQL creates `jm_shiftRequests` automatically on startup. JSON-to-MySQL migration treats a missing collection as empty.

### Return-to-store routes and arrival estimates

Chef `saveRoutingKey {key}` configures openrouteservice; `ORS_API_KEY` is an optional server environment override. Keys are persisted server-side, omitted from state/export responses and AI summaries, and never returned to driver/kitchen clients. Re-enter the key after restoring a filtered export. `POST /api/store/search {address}` is chef-only and returns up to five geocoded candidates; chef `saveStoreLocation {address,latitude,longitude}` confirms the chosen store location. Only explicit user searches trigger geocoding; no autocomplete or periodic external requests. See [openrouteservice API documentation](https://openrouteservice.org/dev/) and the provider's current account plan/quotas.

Driver `startReturnTrip {latitude,longitude,capturedAt,transport}` requires an active shift, a GPS fix at most 30 seconds old and a configured destination. Transport is `car`, mapped to the ORS `driving-car` profile. The server fetches a GeoJSON road route with a 15-second timeout outside the storage transaction, validates geometry/duration, then rechecks employee status, active shift and unchanged destination before persisting `employee.returnTrip`. User input cannot supply route geometry or override the calculated ETA. Routing and searches are limited to six requests per minute per account; concurrent route starts for an account are rejected. Provider failures preserve the existing route. Coordinate requests are sent to openrouteservice only on driver click, not on every GPS fix.

`returnTrip` stores the destination snapshot, start/arrival timestamps, geometry (Leaflet latitude/longitude points), duration, distance, transport and color. Both storage adapters persist this within existing employee records. Kitchen sees active-driver return trips with no payroll or routing credentials; drivers see only their own trip. Chef and kitchen maps locally interpolate estimated progress by elapsed time and route distance; smooth marker updates need no requests from the driver. This is an estimate without live traffic, delays or detours. ETA expiry leaves the trip marked as awaiting confirmation. Driver `finishReturnTrip` or `cancelReturnTrip` clears it, as do clock-out and owner time edits that close an active shift. Logout leaves the saved estimate available. Changing store settings preserves destinations of already-started trips.

A route provider key and a confirmed store address must be configured before real routing can work. External integration and physical device behavior have not been exercised for this change because the user requested skipping tests.

### Automatic deliveries on clock-out and daily statistics

`clockOut` no longer requires `cashConfirmed`; any legacy field is ignored. Within one storage transaction it marks the employee's open orders delivered with `deliveredAt` equal to clock-out time and `completionSource:"clockOut"`, closes the shift, clears location/return route, and records a handoff with `driverConfirmed:false` and `cashRetained:true`. Payroll includes the delivered fees and deducts retained cash. Existing handoffs and prior cash returns are preserved. Chef `confirmHandoff` can acknowledge a later actual return and reverse the corresponding deduction; this is an explicit physical-cash action, never implied by clock-out. Negative payouts remain visible.

The Statistik tab uses already-authorized state: driver data stays own-only; kitchen sees operational counts and only their own financial values; chef sees business revenue and wages. Daily counts distinguish orders created on the selected day, deliveries completed on that day (including automatic closures), and currently open orders. Work hours are clipped to Berlin calendar-day boundaries, including DST, and earnings combine those wage portions with delivered-order fees by order creation date. Driver cash balance and payout cards are clearly labeled all-record totals, rather than a settled daily payslip. Hourly counts and a seven-day order trend include accessible value tables. Average delivery minutes exclude automatic clock-out completions, whose actual delivery time is unknown.
