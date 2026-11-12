# Deploying the collector to Cloudflare

**Status: deployed on 2026-11-10** to the owner's Cloudflare account: D1 database `reinkeep-collector`
(region APAC), Worker `reinkeep-collector`, schedule every 5 minutes, account workers.dev name `reinkeep`. The Worker
has **no public address** (`workers_dev: false`). The steps below are how it was done and how to redo it.
Nothing here is charged on the free plan; see "Cost" at the end.

All commands run from `reinkeep/collector`.

## 1. One time

1. Make a free account at <https://dash.cloudflare.com/sign-up> if you do not have one.
2. Log in from the terminal. This opens your browser and asks you to approve; it is your step:
   ```bash
   npx wrangler login
   ```
3. Create the database:
   ```bash
   npx wrangler d1 create reinkeep-collector
   ```
   It prints a `database_id`. Paste it into `wrangler.jsonc` in place of `REPLACE-WITH-THE-ID-FROM-d1-create`.
4. Create the tables (safe to run again; it only adds what is missing, such as `daily_stats`). The file is applied as one unit, and if it fails halfway the database goes back to how it was:
   ```bash
   npx wrangler d1 execute reinkeep-collector --remote --file=schema.sql
   ```
5. Deploy. This also turns on the schedule (every 5 minutes):
   ```bash
   npx wrangler deploy
   ```
   **First deploy on a new account:** Cloudflare refuses a cron schedule until the account has a workers.dev name
   (error 10063). Set `"workers_dev": true` in `wrangler.jsonc` for that one deploy, run `npx wrangler deploy` in a
   terminal, answer `y` and type the name you want (it is unique worldwide; it becomes `<name>.workers.dev`), then set
   `"workers_dev": false` again and redeploy. The name belongs to the account and serves nothing for this Worker.

## 1b. Updating an existing deployment (done 2026-11-11 for chain launches)

Back up first, then add tables (the schema only creates what is missing), then deploy:
```bash
npx wrangler d1 export reinkeep-collector --remote --output=data/backups/remote-<date>.sql
npx wrangler d1 execute reinkeep-collector --remote --file=schema.sql
npx wrangler deploy
```
On 2026-11-11 this added `launches` and `chain_cursor`. **The chain stage is OFF in the Worker** (`worker.ts` has no `chain: {}`): free nodes refuse `eth_getLogs` from Cloudflare, and the `launches` table in production is empty (checked 2026-11-11). Launches are read by the GitHub Actions runner instead, see section 1c. The first try looked back 24
hours and the public node refused it from Cloudflare as "archive" data, so a first run now starts about 5 minutes
back, and a refused old range makes the collector skip to recent blocks with a `MISSED` note in `stoppedBy`.
Launches from before the switch were not backfilled from Cloudflare.

## 1c. Run the collector from GitHub Actions (why: Cloudflare's addresses get HTTP 429 from GeckoTerminal)

Measured 2026-11-11 on 314 production runs: most failed with `new pools: gave up after 4 tries (HTTP 429)`, and the chain
stage cannot run from Cloudflare. From a normal address both work (live run from a laptop: 13 launches read from the chain,
13 matched to pools, 60 outcomes stored, no errors). So the same collector runs from a GitHub runner and writes to the same
D1 database over Cloudflare's REST API (`src/d1-rest.ts`, runner `run-ci.ts`, workflow `.github/workflows/collector.yml`).

Your steps (nothing here costs money):
1. Cloudflare dashboard, My Profile, API Tokens, Create Token, Custom token. Permission: **Account, D1, Edit**. Nothing else.
   Account resources: only your account. Copy the token once.
2. Create the GitHub repository (the plan is the `reinkeep` org) and push the `reinkeep` folder as its root.
3. Repository Settings, Secrets and variables, Actions, New repository secret. Add:
   - `CLOUDFLARE_ACCOUNT_ID` = `7a4c344a228f90412b1b09e956bc8662`
   - `D1_DATABASE_ID` = `7e8716f6-9aa3-4d51-a02b-b34e57831738`
   - `CLOUDFLARE_API_TOKEN` = the token from step 1
   - `RPC_URL`, `LOGS_RPC_URL`: leave out to use the public node.
4. Actions tab, collector, Run workflow once by hand. Then check with the query in section 2: `launches` must stop being 0.
5. When GitHub runs are healthy for a day, remove the cron from the Cloudflare Worker (`triggers.crons` in `wrangler.jsonc`)
   and redeploy, so the two do not both write. Until then both can run: every write is insert-or-ignore.

GitHub may start a run a few minutes late and may skip a run under load. The chain cursor makes the launch scan catch up.
Public repository: Actions minutes are free. Private repository: the free plan has 2,000 minutes a month, and GitHub rounds each run up
to a whole minute, so a run every 5 minutes is about 8,600 minutes a month. Use a public repository (secrets stay hidden) or a paid plan.

## 2. Check that it works

Wait about 5 minutes for the first scheduled run, or run it by hand from the dashboard
(Workers & Pages, `reinkeep-collector`, Triggers). Then:

```bash
npx wrangler d1 execute reinkeep-collector --remote --command "SELECT (SELECT COUNT(*) FROM pools) AS pools, (SELECT COUNT(*) FROM tokens) AS tokens, (SELECT COUNT(*) FROM tokens WHERE read_at_ms IS NOT NULL) AS tokens_with_facts"
npx wrangler tail          # live log; look for the line {"event":"collect_run", ...}
```

A healthy run logs `"errors": []` and `requestsUsed` below 45. After a day you should also see `outcomesStored` above 0.

## 3. If something goes wrong

| You see | Meaning | What to do |
|---|---|---|
| `Worker exceeded CPU time limit` (error 1102) | The free plan allows 10 ms of CPU per run. A cold start is probably over that (measured about 32 ms in Node; Cloudflare may differ). | Upgrade to **Workers Paid** (US$5 a month): 30 s of CPU and 10,000 outgoing requests per run. No code change. |
| `errors` mentions `human check` | A data source asked for a human check. The collector stops that stage and does **not** work around it. | Nothing to fix in the code. Use another RPC node (see `wrangler.jsonc`) or wait. |
| `stoppedBy` mentions `request budget` | The run hit its allowance of 45 requests. | Normal when there is a backlog; the next run continues. |
| `HTTP 429` in `errors` | The market-data source asked us to slow down. | It retries by itself. If constant, raise the cron interval. |

To stop everything: `npx wrangler delete`.

## 4. Cost and limits (free plan, checked 2026-11-10; recheck before relying on them)

- Database size: 500 MB per database. Without cleanup, the measured rate of new pools reaches it in about 10 months.
  Retention keeps it near 100 MB (see `DATA-MODEL.md`, section 9); the `retention` log line shows the size.
- Rows written per day: 100,000 (we expect about 15,000). Rows read per day: 5,000,000 (we expect under 500,000).
  From 2026-09-01 Cloudflare makes queries **fail** once a free account passes its daily limits.
- The public RPC node is rate-limited and has no uptime promise. A provider key (Alchemy, Chainstack, QuickNode all
  have free tiers) is the first upgrade to make for anything that matters.
