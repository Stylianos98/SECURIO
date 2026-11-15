# SECURIO Node.js

First implementation for review. The original GitHub Pages demo stays at the repository root. This app uses Next.js route handlers on Node.js and a single PostgreSQL database, with Prisma and Tailwind. Keeping HTTP and UI in one process avoids an extra API deployment and cross-origin session configuration. All staging records must be synthetic.

## Local setup

From `node-app`, copy `.env.example` to `.env` and fill in both secrets with separate results from `openssl rand -hex 32`.

```sh
docker compose up --build -d
docker compose logs migrate
docker compose exec -e ALLOW_SIMULATED_SEED=yes app sh -c 'printf "Demo password (16+ chars): "; stty -echo; read -r DEMO_PASSWORD; stty echo; printf "\n"; export DEMO_PASSWORD; npm run seed'
```

Open http://localhost:3000. Use the password you entered with `guard@securio.example`, `command@securio.example`, `client@securio.example`, or `admin@securio.example`. Enter the privileged users' setup keys into an authenticator app and then enter the resulting six-digit code at sign-in. Keep setup keys private. Initial seed creates passwords and TOTP keys once. Reseeding refreshes the simulated duty window while preserving job execution history. To reset the workflow, create a fresh isolated database.

For direct Node setup, use Node 24, PostgreSQL 17+, `npm ci`, and export `DATABASE_URL`, `APP_ORIGIN`, and `MFA_KEY` before running `npx prisma migrate deploy`, `npm run seed` (with the seed variables set), and `npm run dev`. Use the exact same origin in the browser and APP_ORIGIN. The CLI seed reads exported variables.

## CSV fallback

RosterDroid stays authoritative. No supported public API or confirmed 3GS export format was located. Obtain a sanitized example from the account owner before mapping a live export. In Admin, create sites and associate external IDs. The current adapter expects provisioned guard IDs and existing sites. Imported duties are represented by jobs with a shared assignment reference. An assignment with no jobs cannot currently be imported.

Required headers:

```csv
id,siteId,guardId,assignmentRef,title,dutyStart,dutyEnd,dueAt,cancelled
```

Timestamps require UTC or an explicit offset. Use stable IDs, use `true` to cancel a job, and send a new job ID to reassign work already started. Omitted jobs stay in place. Upload is atomic. Use optional JSON mapping such as `{"guardId":"Employee ID"}`. A tenant's freshness timestamp reflects the last successful import. Before operational use, replace this with completeness tracking per site or roster batch to prevent partial uploads from refreshing unrelated sites.

## Verification

Run `npm run typecheck`, `npm run build`, and `npm run test:integration`. Tests normally start disposable PostgreSQL through embedded-postgres. On an unsupported platform, supply `TEST_DATABASE_URL` pointing to an **empty disposable database**. Tests create fixtures and apply the migration. Do not use an operational database.

## EU staging runbook

1. Use an authorized EU VM and a dedicated DNS name. Keep staging credentials and the database separate from production. Restrict ingress to SSH from admin networks and TCP 80/443. Bind the app to loopback and keep PostgreSQL off the public network.
2. Check out the exact approved commit and set `APP_ORIGIN=https://<staging-domain>` before starting Compose. Install Caddy on the host, configure `SECURIO_DOMAIN`, and load the included Caddyfile. Gate staging ingress to approved pilot users via an access proxy or VPN. Confirm valid HTTPS, cookie attributes and origin checks from real clients after provisioning.
3. Use separately scoped database runtime, migration and backup credentials before loading sensitive records. The local Compose stack uses a single database role. Back up PostgreSQL nightly with `pg_dump -Fc` and send encrypted dumps to a separate EU account or bucket. Monitor backup age and failures. Rehearse using `pg_restore --exit-on-error --no-owner` against a fresh database and record the recovery time and data-loss window. Snapshot and dump schedules are still deployment work.
4. Deploy by building the approved commit, recording the previous commit and keeping its image available. Test migration and rollback on a restored copy before upgrading. Never restore over a live database without an approved recovery window. CI verifies changes. Deployment remains a manual release until an authorized staging target exists.

## Costs and launch gates

Use a separate EU app VM and PostgreSQL VM for the base scenario. A compact pilot can share one host with isolated containers. Add independent backups, monitoring, and an email delivery allowance as features come online. Illustrative monthly budgets, excluding VAT, provider message fees and labour:

| Cost item | Compact pilot | Base | Higher capacity |
| --- | ---: | ---: | ---: |
| App and database compute | €50 | €100 | €170 |
| Snapshots and independent encrypted backup/object storage | €18 | €30 | €50 |
| Email | €0 | €12 | €20 |
| Logs, monitoring, traffic and IP/domain allowance | €12 | €28 | €50 |
| **Total** | **€80** | **€170** | **€290** |

These are planning allowances, not quotes. Validate sizing under a 50-guard pilot and modeled 280-guard peak. Compute estimates reference [Hetzner EU cloud pricing](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) and [server backup pricing](https://docs.hetzner.com/cloud/billing/faq/). Managed PostgreSQL, high availability and high attachment volume can move costs outside this range.

**Release decision: synthetic review only.** Before external pilot, finish the gaps in [DELIVERY.md](DELIVERY.md), obtain staging access, verify ingress and backups, and test mobile reconnect and SOS in an agreed exercise. Before production, confirm the approved vendor export, retention periods and escalation contacts, complete employee privacy/DPIA review, commission an independent security assessment, and confirm evidence for each release gate. Never rely on an unconfirmed SOS as a substitute for direct contact with the control room.
