---
name: google-cloud
version: 1.0.0
description: >
  Inspect and analyze Google Cloud resources - BigQuery datasets, tables, query
  jobs, and Cloud Logging - using local gcloud/bq CLI credentials. Use when the
  user asks about BigQuery schemas, row samples, query cost estimates, job traces,
  bytes billed, Cloud Run logs, error traces, or GCP project discovery.
  Triggers: "bigquery", "bq", "dataset", "table schema", "sample rows",
  "query cost", "dry run", "bytes processed", "job trace", "cloud run logs",
  "check logs", "trace errors", "gcloud logs", "what happened in service X".
---

# google-cloud

Inspect GCP resources using the local `gcloud` and `bq` CLIs directly. Auth is
handled entirely by the gcloud CLI - no OAuth client setup, no wrapper scripts.

## Important

- Every operation is a plain `gcloud` or `bq` invocation. There is no helper script in this skill.
- Default posture is **read-only** for BigQuery. Dry-run before executing any query.
- Never run destructive BQ operations: `bq rm`, `bq load`, `bq update`, `bq cp`,
  `bq set-iam-policy`, or any `bq mk` that creates production resources.
- Auth tokens must never appear in chat.
- **Never skip the context.json update.** Any time you discover a new
  account/project/dataset/service mapping in a task, write it to
  `~/.gcloud/google-cloud-skill/context.json` before ending your turn - see
  "Context file" below. This is a required step, not an optional convenience,
  even in a task that is otherwise finished.

## Authentication

Log in once:

```sh
gcloud auth login
```

To add another account:

```sh
gcloud auth login --account=other@example.com
```

List authenticated accounts and switch the active one:

```sh
gcloud auth list
gcloud config set account other@example.com
```

`bq` does not support `--account`; it always follows the active `gcloud` account.
To run a `bq` command as a different account, switch the active account first, run the command, then switch back.

Pin a default project so you don't need `--project` on every command:

```sh
gcloud config set project YOUR_PROJECT_ID
```

## Context file

Discovering which account owns which project, dataset, or Cloud Run service is
slow to redo from scratch every time. Keep a running map at:

```
~/.gcloud/google-cloud-skill/context.json
```

This file is written and read by you (the agent), not by any script.

- If it exists, read it before resolving a project/dataset/service name the user
  mentions, so you can pick the right `--account` and `--project` without asking.
- If it does not exist yet, or a name isn't in it, discover it live with `gcloud`/`bq`
  (see commands below), then write what you learned back into the file so the
  next lookup is instant.
- Keep entries small and factual - account email, project ID, dataset IDs, Cloud
  Run service names and URLs. Don't store secrets or auth tokens in it.
- **This write-back is mandatory, not optional.** If a discovery step in this
  turn taught you something not already in the file (a new account/project
  link, a new dataset, a new service), you MUST write it to context.json
  before you consider the task done - do not just report the finding in chat
  and move on. Treat "did I update context.json" as a checklist item on every
  task that touched discovery, the same way you'd check "did I cap
  `--max_rows`" on a BigQuery query.
- If the user has to ask you to save it after the fact, that is a miss:
  the write should have already happened as part of finishing the task.

Suggested shape:

```json
{
  "accounts": [
    { "email": "you@example.com", "projects": ["my-project-id"] }
  ],
  "projects": [
    {
      "projectId": "my-project-id",
      "account": "you@example.com",
      "datasets": ["analytics", "raw"],
      "services": [
        { "name": "api-bff-prod", "url": "https://api-bff-prod-xyz.a.run.app" }
      ]
    }
  ]
}
```

Update it incrementally: when you discover a new project, dataset, or service
for an account, merge it in rather than rewriting the whole file from scratch.

## Discovery

```sh
# List authenticated accounts
gcloud auth list --format=json

# List projects visible to the active account
gcloud projects list --format=json

# List projects for a specific account
gcloud projects list --account=you@example.com --format=json
```

## BigQuery

`--project_id` is the GCP project ID. A table ref is `DATASET.TABLE` or `PROJECT:DATASET.TABLE`.

```sh
# List datasets in a project
bq ls --project_id=PROJECT_ID --max_results=1000

# List tables in a dataset
bq ls --project_id=PROJECT_ID DATASET_ID

# Show table schema, row count, size
bq show --project_id=PROJECT_ID --format=prettyjson DATASET_ID.TABLE_ID

# Sample rows (non-destructive head scan)
bq head --project_id=PROJECT_ID --max_rows=20 --selected_fields=field1,field2 DATASET_ID.TABLE_ID

# Dry-run a query (cost estimate only, default behavior)
bq query --project_id=PROJECT_ID --use_legacy_sql=false --dry_run \
  "SELECT COUNT(*) FROM \`project.dataset.table\`"

# Execute a query (always cap rows and billed bytes)
bq query --project_id=PROJECT_ID --use_legacy_sql=false \
  --max_rows=100 --maximum_bytes_billed=1000000000 \
  "SELECT ..."

# List recent jobs
bq ls --project_id=PROJECT_ID --jobs --all --max_results=50 --filter='states:RUNNING,DONE'

# Show job details (state, error, bytes billed, SQL)
bq show --project_id=PROJECT_ID --job --format=prettyjson JOB_ID

# Read query job results
bq head --project_id=PROJECT_ID --job --max_rows=100 JOB_ID
```

### BigQuery safety rules

- **Always dry-run first** unless the user explicitly requests execution.
- Cap rows with `--max_rows` and billing with `--maximum_bytes_billed` on every execution.
- Prefer `bq show` and `bq head` over full table scans.
- Never run: `bq rm`, `bq mk`, `bq load`, `bq extract`, `bq update`, `bq cp`, or any IAM mutation.
- Do not use destination tables unless the user explicitly requests it and separately approves it.
- For ad-hoc SQL, prefer aggregate/count queries over raw row dumps when data may be sensitive.

## Cloud Logging

Timestamps in `--freshness`/filter expressions must be UTC (ISO 8601).
Always convert user-stated local times to UTC before building a filter.
If you don't know the project's local timezone, ask the user or check `gcloud scheduler jobs list` for a timezone hint.

```sh
# Recent logs for a Cloud Run service (last 1h)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE_NAME"' \
  --project=PROJECT_ID --limit=50 --freshness=1h --order=desc \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Errors only (last 24h)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE_NAME" AND severity>=ERROR' \
  --project=PROJECT_ID --limit=100 --freshness=24h \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Time window (UTC)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE_NAME" AND timestamp>="2026-06-01T00:00:00Z" AND timestamp<="2026-06-01T06:00:00Z"' \
  --project=PROJECT_ID --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Keyword search
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE_NAME" AND textPayload:"timeout"' \
  --project=PROJECT_ID --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# HTTP status filter
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE_NAME" AND httpRequest.status>=400' \
  --project=PROJECT_ID --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Slow requests
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE_NAME" AND httpRequest.latency>"5s"' \
  --project=PROJECT_ID --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Trace by request ID
gcloud logging read \
  'labels."run.googleapis.com/request_id"="REQUEST_ID"' \
  --project=PROJECT_ID --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Non-Cloud-Run resource (e.g. Cloud Function)
gcloud logging read \
  'resource.type="cloud_function" AND resource.labels.function_name="FUNCTION_NAME"' \
  --project=PROJECT_ID --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Audit log - user activity
gcloud logging read \
  'protoPayload.authenticationInfo.principalEmail="admin@example.com"' \
  --project=PROJECT_ID --format='value(timestamp,severity,textPayload,jsonPayload.message)'

# Chronological order (oldest first, useful for tracing a request flow)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="SERVICE_NAME" AND timestamp>="2026-06-01T00:00:00Z"' \
  --project=PROJECT_ID --order=asc --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

`--format=value(...)` is used instead of `--format=json` because log payloads with
control characters can break JSON formatting. Payloads may be truncated by the
CLI - this is expected; work with the visible content.

### Resource types

| Service | `resource.type` |
|---------|-------------------|
| Cloud Run | `cloud_run_revision` |
| Cloud Functions | `cloud_function` |
| App Engine | `gae_app` |
| GKE | `k8s_container` |
| Compute Engine | `gce_instance` |
| Cloud SQL | `cloudsql_database` |

## Output discipline

- For large result sets, filter or summarize rather than dumping everything.
- Report bytes processed/billed for any BQ query.
- Log payloads may be sensitive - only quote what the user needs.
- Auth tokens must never appear in chat.
