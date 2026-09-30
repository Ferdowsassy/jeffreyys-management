# Hostinger deployment

## Runtime

Use Hostinger Node.js hosting with Node 22 or 24, build command `npm run build`, and startup file `hostinger.cjs`. Serve the built client and Express API from the same application. Deploy one serving instance because sessions and rate limits are process-local.

Set these backend environment variables in hPanel. Never use frontend `VITE_` variables for secrets:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://jeffreys-burger.app
COOKIE_SECURE=true
DEMO_MODE=false
HTTPS_BEHIND_PROXY=true
HOST=127.0.0.1
PORT=3000
STORAGE_BACKEND=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=YOUR_HOSTINGER_DATABASE
DB_USER=YOUR_HOSTINGER_DATABASE_USER
DB_PASSWORD="YOUR_DATABASE_PASSWORD"
```

Use `HTTPS_BEHIND_PROXY=true` only when the app is reachable exclusively through Hostinger's HTTPS frontend. For an ordinary reverse proxy, disable it and configure explicit `TRUST_PROXY` IPs/subnets instead.

`localhost` is the managed database hostname for this verified Hostinger deployment. It is not the website domain. MySQL creates the `jm_*` InnoDB tables on startup; the database user needs CREATE, SELECT, INSERT, UPDATE, and DELETE privileges. Incomplete DB settings cause startup to fail; they never trigger file storage.

For a new empty database, set `BOOTSTRAP_NAME` and `BOOTSTRAP_PIN_FILE` to a private file containing an 8–12 digit PIN. Existing MySQL databases never read or reapply this secret. `DB_CONFIG_FILE` optionally loads database settings from a mode-0600 environment file outside the application/public directory.

## Migrate existing records

1. Stop requests to the old application and verify no process can write the old store.
2. Back up the existing release, hosting configuration, and `state.json` in a private directory outside the public web root.
3. Configure the new empty Hostinger database. Run:

   ```sh
   DB_CONFIG_FILE=/absolute/private/database.env node scripts/migrate-mysql.mjs /absolute/private/state.json
   ```

4. The migration preserves every record, account ID, PIN hash, and setting. It validates the data and writes all tables in one transaction. It refuses to overwrite an initialized database. Reopen the database and compare the migrated records to the original before switching the app.
5. Deploy the verified build, activate MySQL environment variables, and restart the application through Hostinger.
6. Verify `/healthz` returns `{"status":"ok","storage":"mysql"}`, log in with existing accounts, check role isolation, and verify live updates and persistence after restart.

The old JSON file remains only as a private migration backup. The running MySQL application does not read or write it.

## Verification

```sh
npm ci
npm run verify
# Optional real MariaDB integration tests, using an existing local server:
MYSQL_TEST_SOCKET=/tmp/mysql.sock node --test server/mysql.test.js
curl --fail https://jeffreys-burger.app/healthz
# Read-only smoke check using an existing account (PIN file stays private):
LIVE_ORIGIN=https://jeffreys-burger.app LIVE_PIN_FILE=/private/owner_pin node scripts/live-check.mjs
```

The MySQL test creates and drops only a uniquely named disposable `jm_test_*` database. It checks migration, rollback after partial SQL writes, two independent writers, restart persistence, HTTP role restrictions, delivery cash reconciliation, and cross-connection SSE updates.

## Backups and rollback

Use Hostinger database backups or a private `mysqldump --single-transaction` export of the complete database. The in-app export omits credential hashes and is not a restore backup. Preserve existing backups and test restore into a separate database.

Before each release, save a private copy of the active release and backend configuration. Roll back application code to its saved release while retaining MySQL configuration. Do not revert to the old JSON store after new database writes: it would discard activity recorded since migration. Database restore requires a matching backup and a maintenance window.

## PWA hosting

The Vite build copies the manifest, icons, service worker, offline page, and hosting header rules from `public/` into `dist/`. Serve `/sw.js` from the origin root with JavaScript MIME type; the manifest uses `application/manifest+json`. Preserve these additions in the static document root's `.htaccess`:

```apache
AddType application/manifest+json .webmanifest
<FilesMatch "^(sw\\.js|manifest\\.webmanifest)$">
  Header set Cache-Control "no-cache, max-age=0, must-revalidate"
</FilesMatch>
```

Run `PWA_ORIGIN=https://jeffreys-burger.app node scripts/pwa-check.mjs` after deployment. This verifies manifest/icons, Chromium installability, worker control, offline fallback, reconnect, and absence of private/API data in worker caches. Only public offline assets are cached. Keep `/api`, SSE, sessions, and all writes online.

## Optional AI

Receipt scanning needs no API key: the browser loads self-hosted OCR assets from `/ocr/`, reads the image locally, and presents editable fields for review before saving through the normal order API. `npm run build` generates the worker, WASM and language assets; keep them in the deployed `dist` directory. The first scan downloads these assets, so initial recognition can be slower on mobile. OCR can misread text: users must compare the draft with the original photo. The optional coach requires a backend `OPENAI_API_KEY`; `OPENAI_MODEL` defaults to `gpt-4o-mini`. Never place the key in a browser build or commit it to Git.
