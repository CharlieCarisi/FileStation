# Deployment and URL paths

The existing Worker is `file-station`, D1 `file-station`, and R2 bucket `file-station`. Production configuration keeps `DEV_MODE=false`. Keep the deployed `CONNECTOR_ENCRYPTION_KEY` and `SMTP2GO_API_KEY` secrets; do not overwrite them when deploying. `.dev.vars.local` is generated only for local emulation and is never uploaded.

Build with `npm run build`. Apply `npm run db:remote` before deploying `node scripts/wrangler.mjs deploy --env=`. Migration 0004 adds invitation tables and a per-file part size; existing files default to their original 8 MiB. It does not reset user data. Earlier migration names match the production ledger recovered from D1.

Both addresses use the same Worker and database:

- `https://files.bychx.com/` — existing custom domain.
- `https://utils.bychx.com/files/` — a Worker route in the `bychx.com` zone.

The `/files` URL redirects to `/files/`; assets, API calls, cookies, invitation URLs and downloads retain that prefix. Other `utils.bychx.com` paths continue to its existing `bychx-utilities` Worker through a service binding. Authentication is host/path scoped; signing in on one address does not automatically sign you in on the other. Leave `APP_ORIGIN` blank to create invitation links on the address being used.

Cloudflare permissions must cover Workers scripts, D1, R2, routes and the existing zone. No new OneDrive secret is required in environment settings: an administrator enters each connector's credentials in File Station. The DOCX editor is bundled locally and needs no hosted document server or Microsoft sharing permission.

After deployment, check `/api/health` at the root address and `/files/api/health` at the utilities address, confirm both return `development:false`, and load a frontend asset from each address. Check the utilities homepage still serves its original app. Provider tests use disposable files and must never trigger retention eviction of real files.
