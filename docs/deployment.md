# Deployment and URL paths

The existing Worker is `file-station`, D1 `file-station`, and R2 bucket `file-station`. Production configuration keeps `DEV_MODE=false`. Keep the deployed `CONNECTOR_ENCRYPTION_KEY` and `SMTP2GO_API_KEY` secrets; do not overwrite them when deploying. `.dev.vars.local` is generated only for local emulation and is never uploaded.

Build with `npm run build`. Apply `npm run db:remote` before deploying `node scripts/wrangler.mjs deploy --env=`. Migration 0004 adds invitation tables and a per-file part size; existing files default to their original 8 MiB. It does not reset user data. Migration 0005 adds private workspace folders; existing files and invitations start at Root, and storage objects are unchanged. Earlier migration names match the production ledger recovered from D1.

Both addresses use the same Worker and database:

- `https://files.bychx.com/` — existing custom domain.
- `https://utils.bychx.com/files/` — a Worker route in the `bychx.com` zone.

The `/files` URL redirects to `/files/`; assets, API calls, cookies, invitation URLs and downloads retain that prefix. Other `utils.bychx.com` paths continue to its existing `bychx-utilities` Worker through a service binding. Authentication is host/path scoped; signing in on one address does not automatically sign you in on the other. Leave `APP_ORIGIN` blank to create invitation links on the address being used.

Cloudflare permissions must cover Workers scripts, D1, R2, routes and the existing zone. No new OneDrive secret is required in environment settings: an administrator enters each connector's credentials in File Station. The DOCX editor is bundled locally and needs no hosted document server or Microsoft sharing permission.

After deployment, check `/api/health` at the root address and `/files/api/health` at the utilities address, confirm both return `development:false`, and load a frontend asset from each address. Check the utilities homepage still serves its original app. Provider tests use disposable files and must never trigger retention eviction of real files.

Administrators can choose **Settings & activity → Share link address**: `files.bychx.com`, `utils.bychx.com/files`, or the current website address. The choice is stored in D1 settings and applies to copied share links, file requests, collaboration links and invitation emails. Existing codes and old links remain valid on both hosts. The `/files` path is part of the selected base URL and is not added twice. Leave `APP_ORIGIN` blank: changing the share address does not change API origin checks, cookies or the hosting routes. No database migration is required for this setting.

The language selector offers English (Canada), Français (Canada) and 简体中文. A supported `?lang=` parameter takes priority, followed by the browser's saved preference and browser language. Generated French/Chinese share links carry that language to recipients. Dates, numbers, controls, validation messages and verification/invitation emails follow the selected language. Filenames, email addresses, access codes and document contents remain unchanged. Switching language preserves component state and does not restart transfers.

Application translations are maintained in `locales/translations.tsv`; `npm run i18n:build` regenerates the Canadian French and Simplified Chinese JSON catalogs. English source messages live in `locales/en-CA.json`. Translation tests require matching message sets and interpolation variables. The document editor uses its bundled French and Simplified Chinese locale resources; no translation service receives files or UI data.
