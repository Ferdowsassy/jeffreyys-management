# Jeffreyys Management

A React + Express operations app for Jeffreyys: shifts, delivery orders, cash handoffs, schedules, payroll estimates, tasks, delivery zones, and role-based views for chefs, kitchen staff, and drivers.

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

The app is a **single-instance application backed by one local JSON file**. It is suitable for a small deployment only when all of these are true:

- exactly one app process writes the data file;
- `/app/data` is persistent storage with regular backups;
- HTTPS terminates at a reverse proxy;
- the deployment platform supports a persistent volume and graceful shutdown;
- horizontal scaling is disabled.

See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker, first-run bootstrap, reverse-proxy requirements, backups, restore, health checks, upgrades, and limitations.

## Commands

- `npm run dev` — Vite development server
- `npm run server` — API/server using the supplied environment
- `npm start` — production entrypoint (`NODE_ENV=production`)
- `npm test` — Node integration/regression tests
- `npm run build` — production client build
- `npm run test:ui` — Playwright browser regressions
- `npm run verify` — complete local verification

## Security defaults

Production refuses to start unless it has an HTTPS `APP_ORIGIN`, secure cookies, demo mode disabled, an absolute persistent `DATA_FILE`, and an explicit initial owner name/PIN when creating a new store. Production PINs are 8–12 digits. The bootstrap PIN is read from a file rather than an environment variable. Session cookies are HttpOnly, Secure, and SameSite=Strict.

The optional receipt/coach AI integration is disabled when `OPENAI_API_KEY` is absent. Receipt images are sent to OpenAI only when a user explicitly invokes receipt extraction.
