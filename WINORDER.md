# WinOrder deliveries

The app receives WinOrder Professional branch forwarding over HTTPS. This is a
one-way import into the delivery app. Driver assignments, delivery completion,
edits and cancellations in the app are not written back to the WinOrder till.
Automatic propagation of WinOrder cancellations is not verified; reconcile them
with the chef before a delivery is taken.

## Receiver setup

Configure `WINORDER_USERNAME` and a generated `WINORDER_PASSWORD` of 24–200
characters in the backend. Alternatively, put them in a mode-0600 private env
file outside the web root and set `WINORDER_CONFIG_FILE` to its absolute path.
Empty credentials disable the receiver. Never put these credentials in Vite
variables, the public directory, or Git.

For a Hostinger production release under `hbuilds/versions/<release>/nodejs`, the
existing private `hbuilds/config/winorder.env` is discovered automatically when
no explicit credential variables or config file are supplied. This keeps the
same credentials across normal redeployments even when hosting regenerates
`.htaccess`. The private file stays outside the replaceable release directory.

The default endpoint is `https://YOUR_APP_DOMAIN/sendorder`. The equivalent
`/api/integrations/winorder/orders` endpoint is also available. Both accept HTTP
POST with Basic authentication, a WinOrder EShop XML or JSON body, and a maximum
body size of 1 MiB. Standard XML character encodings UTF-8, ISO-8859-1 and
Windows-1252 are supported. DTDs and custom entities are rejected. Success is
HTTP 200 with `{ "status": "success", "data": { ...counts }, "message": "OK" }`.
XML uses the `WinOrder → OrderList` envelope. The documented JSON format starts
directly with `OrderList`; previously supported JSON with an outer `WinOrder`
object is also accepted. The receiver detects XML/JSON from the body, including
when WinOrder forwarding omits the Content-Type header.
Only acknowledge a transfer after the database transaction commits. A failed
request must be retried from WinOrder; the receiver deduplicates stable source
IDs. Authentication header behavior must be confirmed with a real WinOrder send.

## Restaurant settings

Under `Einstellungen → Programmeinstellungen → Filialen`, add the app as the
destination and select `Senden an HTTP-Server`. Enter the HTTPS endpoint above
and the dedicated username and password. Leave `Bestellung auf diesem Computer
speichern` and `Bestellung auf diesem Computer drucken` set to **Ja**.

The WinOrder forwarding feature also requires enabling
`Filial-Weiterleitung aktiv` under `Allgemein` and selecting this destination for
the order. Confirm the intended automatic destination rules with WinOrder; merely
adding a destination does not establish that every telephone or portal order is
automatically forwarded. First send a controlled test delivery and check that it
remains saved and printed at the till and appears once under **Bestellungen**.
Keep forwarding disabled during setup until the receiver is deployed.

Official references:

- https://www.winorder.com/support/faqs/wie-koennen-bestellungen-an-andere-filialen-weitergeleitet-werden/
- https://www.winorder.com/download/WinOrder-EShop-Spezifikation.pdf

## Driver workflow and accounting

Valid delivery orders enter **Bestellungen** without an employee or shift.
Pickup and table orders are acknowledged but do not enter the delivery queue.
Unknown delivery types, missing totals/addresses and unfamiliar payment labels
wait for chef review. They are not offered to drivers until the chef checks and
releases them. Explicit cash and prepaid labels are recognized; card payment at
the customer's door requires review and must not be assumed prepaid or cash.

A clocked-in active driver presses **Übernehmen**. The database transaction
assigns the order to their current shift and snapshots the app's configured zone
delivery fee. Simultaneous claims have one winner. The order moves to **Tour**,
where the assigned driver can see customer contact, notes, articles and navigation.
Other drivers see only their own assigned deliveries plus a limited shared queue.
The chef may assign an available delivery to a clocked-in driver.

An open imported delivery can be returned to the queue before completion; doing
so removes its shift and driver assignment. Completion and clock-out use the
existing cash and earnings rules. Unassigned orders do not become driver earnings.
Imported article text is retained for delivery details; it is not added to article
revenue calculations without reconciling toppings, discounts and deposits.

The stable import key uses store ID, Berlin order date and WinOrder `OrderID`.
Unchanged retries preserve assignment and chef corrections. Changed unassigned
orders update; changes after assignment return HTTP 409 for chef reconciliation.
An order number already recorded manually on that date also returns HTTP 409.
No request body or credential is logged by the receiver. A chef can inspect the
last successful receipt under **Einstellungen → WinOrder**. The same panel has an
**Aktualisieren** button and the 20 most recent HTTP POST transfer attempts,
including rejected authentication and order validation. Each entry shows the
time, HTTP status, fixed rejection message, authentication result, content type
and received body size. Credentials, customer data, request bodies and arbitrary
exception text are never retained in these diagnostics. Only chefs can read the
list; it is held in memory and cleared by an app-server restart. Requests blocked
before the receiver (for example by DNS, TLS or the hosting proxy) cannot appear.
An entry proves that a request reached the endpoint; it does not identify the
sender. When investigating, match a controlled WinOrder retry to its timestamp.

## Checks

`node --test server/winorder.test.js` exercises real HTTP authentication,
persistence, duplicate protection, atomic competing claims, role isolation,
review, release/reassignment, payment handling, encoding, pickup filtering and
invalid batch rollback. The fixture stores all data in a disposable directory.
After `npm run build`, `node scripts/winorder-diagnostics-ui.mjs` checks the
owner's diagnostics refresh, rejection messages, privacy and desktop/mobile layout
against an isolated local app.
The remaining integration check is a real send from the restaurant's WinOrder.
