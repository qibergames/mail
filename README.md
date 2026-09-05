# QiberMail

QiberMail is a self-hosted, mobile-ready email application for custom domains on Cloudflare. It is a TanStack Start port inspired by [Mailflare](https://github.com/hieunc229/mailflare) by Hieu Nguyen, with Better Auth, shadcn/ui, Hungarian and English localization, light/dark mode, shared mailboxes, and installable PWA Web Push notifications.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/qibergames/mail)

## Included

- Cloudflare Email Routing/Sending, D1, R2, Queues, Durable Objects, Workflows and Rate Limiting
- first-run domain/admin/mailbox setup; closed registration afterwards
- personal and shared mailboxes with read-only, send-as, on-behalf and full-access delegation
- inbox, sent, drafts with autosave, stars, snooze, archive, spam, trash, custom folders and search
- attachments, reply/forward, signatures, automatic replies, forwarding and scheduled sending
- mailbox and domain routing rules, aliases, contacts/blocklist, templates and calendar
- scoped API keys, v1 message/send APIs, HMAC-signed retrying webhooks and audit log
- manual/scheduled D1 backups in private R2, retention, restore, EML/MBOX/IMAP import and MBOX export
- standalone PWA, no email body cache, and background push showing only sender and subject
- Hungarian/English browser detection with Hungarian fallback and a saved language cookie
- all application features available without Paymug, license keys or feature gates

The implementation progress and verification ledger is in [PHASES.md](PHASES.md).

## Prerequisites

- Bun 1.4+
- a Cloudflare account and Wrangler login
- an active Cloudflare DNS zone for every mail domain
- a Cloudflare plan that supports the required sending/runtime features

## Local development

```bash
cp .dev.vars.example .dev.vars
bun install --frozen-lockfile
bun run db:migrate:local
CHOKIDAR_USEPOLLING=1 bun run dev
```

Polling is only needed on hosts whose inotify watcher limit is exhausted.

Generate the application secrets before setup:

```bash
openssl rand -base64 48
bunx web-push generate-vapid-keys
```

Put the Better Auth secret, canonical `BETTER_AUTH_URL`, matching VAPID key pair and a scoped Cloudflare token in `.dev.vars`. Turnstile is optional locally and recommended in production.

## One-click deploy

1. **Deploy the app.** Click **Deploy to Cloudflare** above and keep the Worker name `qibermail`. Cloudflare creates the D1 database, R2 bucket, queues, Durable Object and Workflow declared in `wrangler.jsonc` and runs the D1 migrations on deploy.
2. **Set the secrets** when prompted (or afterwards under *Workers → qibermail → Settings → Variables*): `BETTER_AUTH_SECRET` (`openssl rand -base64 48`), `BETTER_AUTH_URL` (the public HTTPS URL of the deployed app), `CF_TOKEN`, `VAPID_SUBJECT` (a `mailto:` address) and the `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` pair from `bunx web-push generate-vapid-keys`. `TURNSTILE_SECRET_KEY` and `VITE_TURNSTILE_SITE_KEY` are optional but recommended.
3. **Complete setup.** Open the deployed URL and follow `/setup` to connect the first domain and create the administrator.

`CF_TOKEN` is a runtime token used to provision Email Routing and Email Sending for the domains you connect; it needs **Zone Read**, **Email Routing Edit**, **Email Routing Rules Write** and **Email Sending Edit** on those zones. It is separate from the token Cloudflare uses to deploy the app.

## Manual Cloudflare deployment

Create the named resources once:

```bash
bunx wrangler d1 create qibermail
bunx wrangler r2 bucket create qibermail-raw
bunx wrangler queues create qibermail-inbound
bunx wrangler queues create qibermail-outbound
```

Replace the placeholder `database_id` in `wrangler.jsonc`, verify that `CF_EMAIL_WORKER_NAME` matches the Worker name, then configure secrets:

```bash
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put BETTER_AUTH_URL
bunx wrangler secret put CF_TOKEN
bunx wrangler secret put TURNSTILE_SECRET_KEY
bunx wrangler secret put VAPID_SUBJECT
bunx wrangler secret put VAPID_PUBLIC_KEY
bunx wrangler secret put VAPID_PRIVATE_KEY
```

`CF_TOKEN` needs Zone Read plus Email Routing DNS/Rules and Email Sending edit permissions for the zones QiberMail manages. The public `VITE_TURNSTILE_SITE_KEY` is read from the Worker binding at runtime.

Build, apply the remote schema, and deploy:

```bash
bun run deploy
```

Open the deployed HTTPS URL. `/setup` creates the first administrator, provisions Email Routing and a catch-all Worker route, and creates the first mailbox. Setup rolls back its database and Cloudflare changes if provisioning fails.

## Install and enable phone notifications

On Android, open the deployed HTTPS site and choose **Install app**. On iPhone/iPad, open it in Safari, choose **Share → Add to Home Screen**, then launch that installed app. Press the bell button inside QiberMail to grant notification permission; iOS only exposes Web Push permission from an installed Home Screen web app and a direct user action.

Each browser/device has its own subscription. A saved inbound email notifies the mailbox owner and delegated users. The payload contains sender, subject, deep-link message ID and unread badge count—never the body or snippet. Expired subscriptions are removed automatically, and push failure cannot retry or duplicate inbound mail storage.

## API

Create a key under **Tools → API keys** and copy it immediately. Keys are stored as SHA-256 digests and can have `messages:read` and/or `messages:send` scopes.

```bash
curl -H "Authorization: Bearer qbm_..." \
  "https://mail.example.com/api/v1/messages?mailboxId=mbx_...&limit=50"

curl -X POST -H "Authorization: Bearer qbm_..." \
  -H "Content-Type: application/json" \
  -d '{"mailboxId":"mbx_...","to":"person@example.com","subject":"Hello","text":"Hi"}' \
  https://mail.example.com/api/v1/send
```

Webhook requests include `X-QiberMail-Event` and `X-QiberMail-Signature: sha256=<hex HMAC>`. Verify the raw request body with the secret shown for the webhook.

## Verification

```bash
bun run check
bun run db:generate
bunx wrangler deploy --dry-run
```

The repo uses Bun only; `bun.lock` is the sole package-manager lockfile.

## License and origin

QiberMail is licensed under GNU AGPL-3.0-only. It is a modified work based in part on [Mailflare](https://github.com/hieunc229/mailflare), which is also AGPL-3.0; see [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE). Operators who make a modified version available over a network must offer the corresponding source under the AGPL.

## Credits

QiberMail started as a reimagining of [Mailflare](https://github.com/hieunc229/mailflare), the open-source Cloudflare email client by Hieu Nguyen. The idea of running a whole mailbox on Cloudflare Email Routing, Email Sending, D1 and R2 comes from there; the QiberMail codebase is an independent rewrite.
