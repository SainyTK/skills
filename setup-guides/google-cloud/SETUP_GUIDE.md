# google-cloud - Setup Guide

How to authenticate the Google Cloud CLI so the skill can read BigQuery and Cloud Logging on behalf of your GCP account.

---

## Prerequisites

- A Google account with access to one or more GCP projects
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed and available as `gcloud` in your PATH
- [BigQuery CLI (`bq`)](https://cloud.google.com/bigquery/docs/bq-command-line-tool) - included with the Cloud SDK

Verify installation:

```sh
gcloud --version
bq --version
```

---

## Step 1 - Authenticate with gcloud

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

## Step 2 - Configure a default project (optional)

Set a project so you don't need `--project` on every command:

```sh
gcloud config set project YOUR_PROJECT_ID
```

---

## Step 3 - Verify

```sh
gcloud auth list --format=json
gcloud projects list --format=json
```

You should see your authenticated account(s) and the projects they can access.

---

## Context file

The skill keeps a running map of account/project/dataset/service names at
`~/.gcloud/google-cloud-skill/context.json`, so the agent doesn't have to
rediscover them from scratch every time. There's nothing to set up here - the
agent reads and writes this file itself as it works, and falls back to live
`gcloud`/`bq` discovery whenever an entry isn't in it yet.

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
| `quota exceeded` on BQ query | Use `--maximum_bytes_billed` to cap billing or switch to a project with available quota. |
