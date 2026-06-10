---
name: google-cloud
version: 0.0.2
description: >
  Inspect and analyze Google Cloud resources — BigQuery datasets, tables, query
  jobs, and Cloud Logging — using local gcloud/bq CLI credentials. Use when the
  user asks about BigQuery schemas, row samples, query cost estimates, job traces,
  bytes billed, Cloud Run logs, error traces, or GCP project discovery.
  Triggers: "bigquery", "bq", "dataset", "table schema", "sample rows",
  "query cost", "dry run", "bytes processed", "job trace", "cloud run logs",
  "check logs", "trace errors", "gcloud logs", "what happened in service X".
---

# google-cloud

Inspect GCP resources using local `gcloud` and `bq` CLI credentials. Auth is
handled entirely by the gcloud CLI — no OAuth client setup required.

## Important

- Use the script in this skill directory; invoke with `bun`.
- Secrets live in `.agents/skills/google-cloud/.env`; never print or read that file into chat.
- Context cache lives at `.agents/skills/google-cloud/.data/context.json`; do not print raw token contents.
- `.env` and `.data/` are gitignored.
- Default posture is **read-only** for BigQuery. Dry-run before executing any query.
- Never run destructive BQ operations: `bq rm`, `bq load`, `bq update`, `bq cp`,
  `bq set-iam-policy`, or any `bq mk` that creates production resources.

## Setup / status

From repo root:

```sh
bun .agents/skills/google-cloud/scripts/gcloud.ts status
```

If no context exists, build it first:

```sh
bun .agents/skills/google-cloud/scripts/gcloud.ts refresh-context
```

## Authentication

This skill uses the local `gcloud` CLI — no extra OAuth client setup. Log in once:

```sh
gcloud auth login
```

To add another account:

```sh
gcloud auth login --account=other@example.com
```

The `.env` file can pin a default project or account so you don't need to pass `--project` on every command.

## Context cache

Always load context before resolving project or service names:

```sh
bun .agents/skills/google-cloud/scripts/gcloud.ts status
```

`context.json` maps project names to IDs, datasets, Cloud Run service names, and scheduler timezones.

When a service or dataset is not in the cache, run:

```sh
bun .agents/skills/google-cloud/scripts/gcloud.ts refresh-context
```

## Commands

### Auth / context

```sh
gcloud.ts status
gcloud.ts accounts
gcloud.ts use-account --account you@example.com
gcloud.ts projects [--account you@example.com]
gcloud.ts refresh-context
```

### BigQuery

`--project` is the GCP project ID. `--dataset` is the dataset ID. `--table` is `DATASET.TABLE` or `PROJECT.DATASET.TABLE`.

```sh
# List all datasets
gcloud.ts bq-datasets [--project PROJECT_ID]

# List tables in a dataset
gcloud.ts bq-tables --dataset DATASET_ID [--project PROJECT_ID]

# Show table schema, row count, size
gcloud.ts bq-schema --table DATASET.TABLE [--project PROJECT_ID]

# Sample rows (non-destructive head scan)
gcloud.ts bq-head --table DATASET.TABLE [--rows 20] [--fields field1,field2] [--project PROJECT_ID]

# Dry-run a query (cost estimate only — default behavior)
gcloud.ts bq-query --sql "SELECT COUNT(*) FROM \`project.dataset.table\`" [--project PROJECT_ID]

# Execute a query (capped at 100 rows / 1 GB billed by default)
gcloud.ts bq-query --sql "SELECT ..." --execute [--rows 100] [--bytes 1000000000] [--project PROJECT_ID]

# List recent jobs
gcloud.ts bq-jobs [--project PROJECT_ID] [--limit 50] [--filter 'states:RUNNING,DONE']

# Show job details (state, error, bytes billed, SQL)
gcloud.ts bq-job --job JOB_ID [--project PROJECT_ID] [--location LOCATION]
```

#### BigQuery safety rules

- **Always dry-run first** unless the user explicitly requests execution.
- Cap rows with `--rows` and billing with `--bytes` on every execution.
- Prefer `bq-schema` and `bq-head` over full table scans.
- Never run: `bq rm`, `bq mk`, `bq load`, `bq extract`, `bq update`, `bq cp`, or any IAM mutation.
- For ad-hoc SQL, prefer aggregate/count queries over raw row dumps when data may be sensitive.

#### Common BigQuery patterns

```sh
# Check table schema before querying
gcloud.ts bq-schema --table analytics.events --project my-project

# Sample 20 rows, only non-sensitive fields
gcloud.ts bq-head --table analytics.events --rows 20 --fields event_name,created_at

# Dry-run for cost estimate
gcloud.ts bq-query --sql "SELECT COUNT(*) FROM \`my-project.analytics.events\` WHERE DATE(created_at) = '2026-06-01'"

# Capped execution
gcloud.ts bq-query \
  --sql "SELECT event_name, COUNT(*) AS n FROM \`my-project.analytics.events\` GROUP BY 1 ORDER BY 2 DESC LIMIT 50" \
  --execute --rows 50 --bytes 500000000

# Find failed jobs in last run
gcloud.ts bq-jobs --project my-project --filter 'states:DONE' --limit 100
```

### Cloud Logging

`--service` is the Cloud Run service name. Timestamps (`--from`, `--to`) must be in UTC (ISO 8601).

**Timezone warning:** always convert user-stated local times to UTC before building `--from`/`--to` filters. Check `projects[].scheduler_timezone` in `context.json` for the project's local timezone.

```sh
# Recent logs (last 1h)
gcloud.ts log-read --service SERVICE_NAME [--project PROJECT_ID]

# Errors only (last 24h)
gcloud.ts log-errors --service SERVICE_NAME [--project PROJECT_ID]

# Custom freshness / limit
gcloud.ts log-read --service SERVICE_NAME --freshness 6h --limit 200

# Time window (UTC)
gcloud.ts log-read --service SERVICE_NAME --from 2026-06-01T00:00:00Z --to 2026-06-01T06:00:00Z

# Keyword search
gcloud.ts log-read --service SERVICE_NAME --keyword "timeout"

# HTTP errors
gcloud.ts log-read --service SERVICE_NAME --status 400

# Trace by request ID
gcloud.ts log-read --request-id REQUEST_ID [--project PROJECT_ID]

# Non-Cloud-Run resource (e.g. Cloud Function)
gcloud.ts log-read --resource-type cloud_function --service FUNCTION_NAME

# Audit log — user activity
gcloud.ts log-read --user admin@example.com [--project PROJECT_ID]

# Chronological order (oldest first, useful for tracing a request flow)
gcloud.ts log-read --service SERVICE_NAME --from 2026-06-01T00:00:00Z --order asc

# Raw filter (passed directly to gcloud logging read)
gcloud.ts log-read --project PROJECT_ID \
  --filter 'resource.type="cloud_run_revision" AND severity>=WARNING'
```

#### Log format note

Output is tab-separated: `timestamp | severity | textPayload | jsonPayload.message`.
Payloads may be truncated by the CLI — this is expected; accept it and work with visible content.

#### Resource types

| Service | `--resource-type` |
|---------|-------------------|
| Cloud Run | `cloud_run_revision` (default) |
| Cloud Functions | `cloud_function` |
| App Engine | `gae_app` |
| GKE | `k8s_container` |
| Compute Engine | `gce_instance` |
| Cloud SQL | `cloudsql_database` |

## Multiple accounts

```sh
gcloud.ts accounts               # list all authenticated accounts
gcloud.ts use-account --account other@example.com   # switch active account
gcloud.ts bq-datasets --account work@example.com    # per-command override
```

## Output discipline

- For large result sets, filter or summarize rather than dumping everything.
- Report bytes processed/billed for any BQ query.
- Log payloads may be sensitive — only quote what the user needs.
- Auth tokens and `.env` contents must never appear in chat.
