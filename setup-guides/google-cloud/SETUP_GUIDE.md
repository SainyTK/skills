# google-cloud — Setup Guide

How to authenticate the Google Cloud CLI so the skill can read BigQuery and Cloud Logging on behalf of your GCP account.

---

## Prerequisites

- A Google account with access to one or more GCP projects
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed and available as `gcloud` in your PATH
- [BigQuery CLI (`bq`)](https://cloud.google.com/bigquery/docs/bq-command-line-tool) — included with the Cloud SDK

Verify installation:

```sh
gcloud --version
bq --version
```

---

## Step 1 — Authenticate with gcloud

```sh
gcloud auth login
```

This opens a browser window for Google sign-in. Complete the flow. You can repeat this for additional accounts:

```sh
gcloud auth login --account=other@example.com
```

Verify all authenticated accounts:

```sh
gcloud auth list
```

---

## Step 2 — Configure a default project (optional)

Set a project so you don't need `--project` on every command:

```sh
gcloud config set project YOUR_PROJECT_ID
```

Alternatively, pin it in the skill's `.env` file (see Step 3).

---

## Step 3 — Configure the skill (optional)

Copy `.env.example` to `.env` inside the skill directory:

**Claude Code**
```sh
cp .claude/skills/google-cloud/.env.example .claude/skills/google-cloud/.env
```

**Codex**
```sh
cp .agents/skills/google-cloud/.env.example .agents/skills/google-cloud/.env
```

Edit `.env` to set optional defaults:

```dotenv
# Pin a default project (avoids --project on every command)
GCLOUD_DEFAULT_PROJECT=my-project-id

# Pin a default account email
GCLOUD_DEFAULT_ACCOUNT=you@example.com
```

> `.env` is gitignored. Leave values blank if you prefer to rely on gcloud's active config.

---

## Step 4 — Build the context cache

Run `refresh-context` to discover all accessible accounts, projects, datasets, and Cloud Run services:

**Claude Code**
```sh
bun .claude/skills/google-cloud/scripts/gcloud.ts refresh-context
```

**Codex**
```sh
bun .agents/skills/google-cloud/scripts/gcloud.ts refresh-context
```

This writes to `.claude/skills/google-cloud/.data/context.json` (Claude Code) or `.agents/skills/google-cloud/.data/context.json` (Codex) (gitignored). It may take a minute if you have many projects.

---

## Step 5 — Verify

**Claude Code**
```sh
bun .claude/skills/google-cloud/scripts/gcloud.ts status
```

**Codex**
```sh
bun .agents/skills/google-cloud/scripts/gcloud.ts status
```

Expected output:

```json
{
  "activeAccount": "you@example.com",
  "activeProject": "my-project-id",
  "contextLastUpdated": "2026-06-07",
  "projectsInContext": 42,
  "datasetsInContext": 15,
  "servicesInContext": 8
}
```

---

## Refreshing credentials

gcloud tokens expire after a period. If you see auth errors:

```sh
gcloud auth login --account=you@example.com
```

> Never attempt interactive auth from within Claude. Surface the error message and run the login command yourself using `! gcloud auth login` in the Claude Code prompt.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `gcloud: command not found` | [Install the Cloud SDK](https://cloud.google.com/sdk/docs/install) and ensure it's in your PATH. |
| `bq: command not found` | The `bq` tool ships with the Cloud SDK. Run `gcloud components install bq` or reinstall the SDK. |
| `ERROR: (gcloud.auth.list) There are no credentialed accounts` | Run `gcloud auth login`. |
| Permission denied on a project | Your account may not have the required roles. Ask the project owner for `roles/bigquery.dataViewer` (BQ) or `roles/logging.viewer` (Logging). |
| Context cache is stale | Run `gcloud.ts refresh-context` to rebuild it. |
| `quota exceeded` on BQ query | Use `--bytes` to cap billing or switch to a project with available quota. |
