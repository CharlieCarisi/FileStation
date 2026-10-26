# File Station

Private file transfers, recipient verification, submission requests, document collaboration, private file previews, and English/Canadian French/Simplified Chinese interfaces on Cloudflare Workers, D1, and R2. Storage adapters include native R2, S3-compatible providers (including Oracle), AliPan, Synology/WebDAV, and OneDrive for Business.

Use Node 24. Run `npm ci`, `npm run db:local`, and `npm run dev`. Local authentication uses an email simulator; the verification PIN appears in the dialog. Production uses SMTP2GO. Never enable `DEV_MODE` in production.

Validation: `npm run build`, `npm test`, and `npm run test:browser` (system Chromium, or set `CHROMIUM_PATH`). Integration tests run against emulated D1/R2 and mocked external providers. Browser tests exercise real local submissions, DOCX/text round trips, verified document/media previews, parallel transfer pause/reload recovery, out-of-order disk writes and safe handling of markup. Microsoft credentials and permissions must also be tested in your tenant.

- [Deployment, share-link address settings and languages](docs/deployment.md)
- [OneDrive application and private folder setup](docs/onedrive.md)
- [Submissions and collaboration](docs/collaboration.md)
- [Source recovery](docs/recovery.md)

Source maps are enabled to make future recovery possible. Keep code and the lockfile in Git; environment snapshots alone are not a source backup. Credentials belong in Worker secrets or encrypted connector settings, never Git.
