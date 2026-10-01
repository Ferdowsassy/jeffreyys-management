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
