# Jeffreyys Management

A React + Express operations app for Jeffreyys: shifts, delivery orders, cash handoffs, schedules, payroll estimates, tasks, delivery zones, and role-based views for chefs, kitchen staff, and drivers.

Chefs can filter the team by role, maintain employee phone numbers, and view earnings per shift or per employee/month under **Zeiten**. Kitchen employees have **Mein Verdienst** for their own monthly earnings. They never receive other employees' wages or customer contacts.

The weekly plan supports editing, moving and removing scheduled shifts directly, role filters, overnight labels and returning to the current week. Chef and kitchen dashboards show all active drivers' voluntarily shared locations together on a Leaflet/OpenStreetMap map. Markers move through the existing live SSE updates without reloading the map. Positions older than 30 seconds are labelled paused; after two minutes they disappear. Today's average minutes from order creation to delivery includes preparation/waiting time.

Drivers enable location sharing during an active shift and grant browser/device location permission. Tracking stays mounted across app pages and resumes after a reload in the same tab while its session remains active. GPS watches publish at most once per five seconds and request a fresh fix every ten seconds even when stationary. The app reports denied permission, missing HTTPS, GPS timeouts and upload failures. Sharing stops on explicit stop, clock-out or logout. Only the most recent fix is stored; frequent GPS writes do not enter the business audit log. Browser/OS background suspension still applies: keep the app open for continuous updates; locked-screen or external navigation tracking is not guaranteed by a browser PWA.

Analysis compares 7, 30, 90 or 365 days with the previous equally sized period. Optional order items are entered manually with name, quantity and unit price; chefs can add/correct items for historical orders under **Analyse**. Article totals count delivered orders with recorded items only, show price ranges when prices vary, and disclose coverage. Existing orders have no article breakdown until it is entered; OCR still extracts the original receipt fields.

## Verify locally

Requirements: Node.js 22+ and npm.

```bash
npm ci
npm run verify
```

`npm run verify` runs the full Node test suite, builds the production client, and executes headless browser regressions. All test data is written to isolated temporary directories; `server/data/` is not touched.

For local demo use:

```bash
DEMO_MODE=true npm run server
npm run dev
```

The Vite client is at `http://127.0.0.1:5173`; its `/api` requests proxy to `http://127.0.0.1:3001`. Public demo accounts and PINs are documented in `server/README.md`. Never use demo mode with real data.

## Production

Production on Hostinger uses its managed MySQL/MariaDB database. Employees, orders, shifts, schedules, zones, tasks, handoffs, and audit records are stored in separate InnoDB tables. Writes commit atomically and survive application restarts. There is no JSON data file in the MySQL deployment.

See [DEPLOYMENT.md](DEPLOYMENT.md) for Hostinger configuration, migration, verification, and backups. The local JSON adapter remains available for isolated tests and local demo use.

## Install as an app

Open the HTTPS site and select **App installieren** on the login screen or in the sidebar. Supported browsers offer their native install prompt; other browsers show installation instructions, including Safari's **Zum Home-Bildschirm** on iPhone/iPad. The app opens in a standalone window after installation.

An offline launch shows a reconnect screen. Shifts, orders, sessions, customer information, and payroll are never cached by the service worker, and writes require an internet connection. Application HTML and scripts always come from the network so a worker cannot retain an outdated deployment.

`node scripts/pwa-check.mjs` verifies the built app locally; `PWA_ORIGIN=https://jeffreys-burger.app node scripts/pwa-check.mjs` runs the same read-only checks against production.

## Commands

- `npm run dev` — Vite development server
- `npm run server` — API/server using the supplied environment
- `npm start` — production entrypoint (`NODE_ENV=production`)
- `npm test` — Node integration/regression tests
- `npm run build` — production client build
- `npm run test:ui` — Playwright browser regressions
- `npm run verify` — complete local verification

`node scripts/location-ui.mjs` exercises browser GPS sharing with simulated positions in simultaneous driver, chef and kitchen sessions. `LOCATION_BROWSER=webkit node scripts/location-ui.mjs` runs the movement/navigation/reload checks in an iPhone-sized WebKit browser (requires the Playwright WebKit browser). These checks do not replace an actual iPhone GPS/background-permission test.

## Security defaults

Production refuses to start unless it has an HTTPS `APP_ORIGIN`, secure cookies, demo mode disabled, complete MySQL credentials (or an explicit absolute `DATA_FILE` for legacy deployments), and an explicit initial owner name/PIN when creating a new store. Production PINs are 8–12 digits. The bootstrap PIN is read from a file rather than an environment variable. Session cookies are HttpOnly, Secure, and SameSite=Strict.

Receipt scanning runs on the device using self-hosted Tesseract OCR and deterministic parsing. It extracts a draft for review; photos are never uploaded by the scanner. German and English OCR assets are generated during `npm run build`. The optional coach requires a backend `OPENAI_API_KEY`.

Mitarbeiter können unter **Meine Arbeitszeiten** ihre Zeiten nach Monat sehen, Korrekturen mit Begründung beantragen oder eine vergessene Schicht melden. Der Chef bekommt eine Benachrichtigung in der App und kann unter Zeiten genehmigen oder ablehnen. Arbeitszeit und Verdienst ändern sich erst nach Genehmigung.

Rückfahrten: Der Chef richtet unter **Einstellungen** einen Geoapify API-Schlüssel und die Ladenadresse ein (Adresse suchen, Position prüfen, Treffer bestätigen). Fahrer drücken **Ich fahre zurück zum Laden**. Chef und Küche sehen die gespeicherte Straßenroute, eine eigene Farbe je aktiver Rückfahrt, die geschätzte Ankunft und animierten geschätzten Fortschritt. Die Anzeige läuft auch bei geschlossenem Fahrerbrowser weiter. Sie verwendet keine Live-Verkehrsdaten und ist keine GPS-Ortung. Mit **Bin im Laden** bestätigt der Fahrer die Rückkehr; **Route und Ankunft neu berechnen** aktualisiert die Schätzung anhand eines neuen Standorts.

Ausstempeln schließt alle noch offenen Lieferungen des Mitarbeiters automatisch als zugestellt ab. Das Bargeld bleibt standardmäßig beim Fahrer und wird von der Auszahlung abgezogen; die frühere Bargeldabgabe-Abfrage entfällt. Eine spätere tatsächliche Abgabe kann der Chef unter Kasse bestätigen. Automatische Abschlüsse sind gekennzeichnet und zählen nicht zur durchschnittlichen bestätigten Lieferzeit.

**Statistik** ist für Chef, Küche und Fahrer verfügbar: Datumsauswahl, Tageskennzahlen, Bestellungen nach Uhrzeit und ein 7-Tage-Diagramm. Fahrer sehen eigene Bestellungen, Verdienst, Bargeldsaldo und Gesamtauszahlung; Küche sieht Betriebsaktivität und den eigenen Verdienst; Chef sieht auch Umsatz und Teamverdienst. Tagesgrenzen verwenden Europe/Berlin einschließlich Sommerzeit; Arbeitsstunden werden bei Mitternacht aufgeteilt.

Geoapify einrichten: Unter [Geoapify MyProjects](https://myprojects.geoapify.com/) ein Projekt erstellen, den API-Schlüssel kopieren und als Chef unter Einstellungen speichern. Danach die Ladenadresse suchen und den passenden Treffer bestätigen. Routen und Adresssuche werden serverseitig aufgerufen; der Schlüssel wird nicht an Fahrer- oder Küchenbrowser weitergegeben. Die bestehende Karte nutzt weiterhin OpenStreetMap und benötigt keinen Browser-Schlüssel. Alte HeiGIT-/ORS-Schlüssel werden nicht als Geoapify-Schlüssel verwendet.

## Earnings and receipt UX

Work durations use hours and minutes (for example **1 Std. 30 Min.**) throughout shift screens, time records, statistics, monthly earnings and CSV exports. The numeric duration used for payroll calculations is unchanged. Kitchen and driver time corrections now live under **Meine Arbeitszeiten** in the sidebar.

Every role has a Monday–Sunday earnings chart in their earnings view and under **Statistik**. Select a day or a bar to see work time, wage and delivery fees. Previous/next week and **Heute** make it easy to navigate; chefs can select themselves, another employee or the whole team. Daily wage portions use Berlin day boundaries, including overnight shifts and daylight-saving changes; delivery fees count only completed orders, by receipt creation day. Weekly gross earnings are shown before retained cash deductions. The monthly section still shows actual estimated payout.

Receipt scanning recognizes the original register layout, Uber Eats invoice copies and Lieferando delivery receipts, including `Bestellung`, `Lieferadresse`, discounted `Gesamt` and provider-specific payment wording. Photography is available from **Schicht**, **Tour** and **Belege**; drafts can be cancelled before saving. Review remains required.

QR decoding and OCR run on the device; receipt photos are not uploaded. Google Maps QR codes with a full written postal address populate the address directly. Short Maps links are resolved through an authenticated endpoint which permits only Google Maps hosts and validates every redirect. Fiscal/TSE codes and coordinate-only targets never become postal addresses. A QR containing only a Google place ID requires a Google Places API (New) key: the chef can save it under **Einstellungen → QR-Adressen auf Belegen**, or the deployment can supply `GOOGLE_MAPS_SERVER_KEY`. The key stays on the server. Only the QR URL/place ID is used for address resolution; Google Places requests use the `formattedAddress` field. If the QR cannot be decoded or resolved, the scanner uses the printed address and shows missing fields for manual review. The first attached sample uses a place ID, so its address lookup needs this configuration. The second photo has an unreadable QR and ambiguous order-number characters; its printed delivery address, total and payment can be read, and the identifier is flagged for review.

`node scripts/ux-improvements.mjs` checks weekly/day navigation, role scope, dedicated time records, mobile width and receipt controls. `node scripts/receipt-qr-check.mjs /path/to/receipt.jpg` diagnoses QR readability without storing the image. The OCR check accepts `OCR_RECEIPT_FILE` and `OCR_EXPECTED_JSON_FILE` for local photo fixtures; optional `OCR_TEXT_FILE` writes diagnostic text locally.
