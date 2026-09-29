# Deployment guide

## Supported deployment shape

Run one container, one process, and one persistent volume. Do not configure multiple replicas or serverless/ephemeral storage. The JSON store uses an exclusive lock and intentionally refuses a second writer.

Use an HTTPS reverse proxy or managed load balancer in front of port 3001. Compose binds that port to `127.0.0.1` only. The proxy must preserve `Host`, set `X-Forwarded-Proto: https`, support Server-Sent Events without buffering, and allow connections lasting longer than 15 seconds. Except for `/healthz`, production rejects requests that Express cannot verify arrived through HTTPS.

## First deployment with Docker Compose

1. Copy the public configuration template:

   ```bash
   cp .env.example .env
   ```

2. Set `APP_ORIGIN` to the exact public HTTPS origin, with no path or trailing slash. Set `TRUST_PROXY` to the explicit proxy IP/subnet that connects to the container. `loopback` is correct only when the proxy runs on the same host/network namespace.

3. Create the bootstrap secret without committing it:

   ```bash
   mkdir -p secrets
   umask 077
   printf '%s' 'CHOOSE-AN-8-TO-12-DIGIT-PIN' > secrets/bootstrap_pin
   ```

   Replace the placeholder with an 8–12 digit PIN. Do not send the PIN in chat or commit it. The secret is used only when the data file does not yet exist.

4. Validate and launch:

   ```bash
   docker compose config --quiet
   docker compose build
   docker compose up -d
   docker compose ps
   curl --fail http://127.0.0.1:${APP_PORT:-3001}/healthz
   ```

5. Complete the first login through the public HTTPS URL using `BOOTSTRAP_NAME` and the bootstrap PIN. Create separate kitchen/driver accounts immediately. The owner account starts with an hourly rate of zero, which can be updated in Team settings.

6. Keep `secrets/bootstrap_pin` available to Docker Compose (or replace it with a platform-managed secret). Existing stores no longer read or reapply it during app startup, but Compose still requires the declared secret source when recreating the container. A new or restored empty volume requires the secret value.

## Required environment

- `APP_ORIGIN` — exact public `https://` origin; required.
- `DATA_FILE` — absolute path on persistent storage; Compose sets `/app/data/state.json`.
- `BOOTSTRAP_NAME` — initial owner display name for a new store.
- `BOOTSTRAP_PIN_FILE` — file containing the initial 8–12 digit PIN.
- `TRUST_PROXY` — explicit proxy IP/subnet list; never `true` or a hop count.
- `COOKIE_SECURE=true` — required in production.
- `HOST=0.0.0.0`, `PORT=3001` — container listener.
- `OPENAI_API_KEY` / `OPENAI_MODEL` — optional; leave the key unset to disable AI.

## Reverse proxy checks

After HTTPS is configured, verify:

```bash
curl --fail https://YOUR_HOST/healthz
curl --fail https://YOUR_HOST/
```

Then sign in in a browser and confirm the header says `Live verbunden`. If it does not, disable proxy buffering for `/api/events` and increase read timeouts.

## Backup

The authoritative data is the persistent `state.json`. Stop the app or use a volume snapshot that guarantees a consistent point-in-time copy.

Compose example:

```bash
docker compose stop app
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker run --rm -v jeffreyys-management_jeffreyys_data:/data:ro -v "$PWD/backups:/backup" alpine \
  sh -c "cp /data/state.json /backup/state-$STAMP.json"
docker compose start app
```

Encrypt backups because they contain customer addresses, payroll estimates, and operational data. Test restore regularly. The chef JSON export is sanitized and **is not** a complete restore backup.

## Restore

```bash
docker compose down
# Replace BACKUP.json with the selected known-good file.
docker run --rm -v jeffreyys-management_jeffreyys_data:/data -v "$PWD/backups:/backup:ro" alpine \
  sh -c "cp /backup/BACKUP.json /data/state.json && chown 1000:1000 /data/state.json && chmod 600 /data/state.json"
docker compose up -d
curl --fail http://127.0.0.1:${APP_PORT:-3001}/healthz
```

Never remove `state.json.lock` while an app process is running. If startup reports a stale lock after a host crash, first prove no container/process uses the volume, back up the volume, then remove only the `.lock` file.

## Upgrade and rollback

Before upgrading: run `npm run verify`, make a backup, then rebuild and restart one instance. Check `/healthz`, login, and live updates. For rollback, restore the previous image and—if the data format changed—the paired pre-upgrade backup.

## Current limits

- single process / single replica only;
- no built-in automated backup scheduler;
- in-memory sessions are lost on restart;
- no statutory payroll/tax/overtime engine;
- no multi-tenant separation;
- AI live calls require a separately managed OpenAI key and were not part of offline verification.

For multi-replica or high-availability deployment, migrate persistence, sessions, rate limits, and events to shared services before scaling.
