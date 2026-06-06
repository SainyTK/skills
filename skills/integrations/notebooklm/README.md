# NotebookLM Skill

Query your [Google NotebookLM](https://notebooklm.google.com) notebooks directly from Claude Code. Ask questions and get source-grounded answers from Gemini — citations included, hallucinations minimized.

Each `ask` command opens a headless browser, navigates to your notebook, submits the question, and returns the answer with inline citations.

---

## Prerequisites

### 1. Bun

```sh
curl -fsSL https://bun.sh/install | bash
```

### 2. agent-browser

```sh
npm i -g agent-browser
agent-browser install   # downloads Chrome for Testing
```

### 3. Google auth via agent-browser

This skill uses the **default agent-browser profile** (configured in `~/.agent-browser/config.json`). If you have already authenticated with agent-browser for any Google service (e.g. Gmail skill), you are ready — no further login needed.

To check:

```sh
bun .agents/skills/notebooklm/scripts/notebooklm.ts status
```

If `"authenticated": true` → skip to Usage.

If `"authenticated": false` → run:

```sh
bun .agents/skills/notebooklm/scripts/notebooklm.ts login
```

A **visible Chrome window** opens. Sign in to Google. Once the browser lands on `notebooklm.google.com`, the script detects success and closes automatically. Re-run `status` to confirm.

### 4. A NotebookLM notebook

You must own or have access to at least one notebook at [notebooklm.google.com](https://notebooklm.google.com). Sources (documents, URLs, etc.) must be added to the notebook manually via the NotebookLM web UI before querying.

---

## Usage

### Ask a question

```sh
# By notebook URL
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask \
  --question "What are the main topics covered?" \
  --notebook-url "https://notebooklm.google.com/notebook/<id>"

# By notebook ID (after adding to library)
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask \
  --question "Summarize the key findings." \
  --notebook-id my-notebook

# Using the active notebook
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask \
  --question "What does the document say about X?"
```

### Manage your notebook library

```sh
# Add a notebook
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks add \
  --url "https://notebooklm.google.com/notebook/<id>" \
  --name "My Notebook" \
  --description "What this notebook contains" \
  --topics "topic1,topic2"

# List notebooks
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks list

# Search by keyword
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks search --query keyword

# Set active notebook
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks activate --id my-notebook
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `authenticated: false` | Run `login` and sign in via the opened browser window |
| "Session expired" on ask | Run `reauth`; if that fails, run `agent-browser --headed open https://notebooklm.google.com` and sign in manually |
| `agent-browser: command not found` | Run `npm i -g agent-browser && agent-browser install` |
| Query input not found | Run ask with `--show-browser` to debug; selectors may have changed |
