---
name: notebooklm
version: 0.0.3
description: Use this skill to query your Google NotebookLM notebooks directly from Claude Code for source-grounded, citation-backed answers from Gemini. Playwright browser automation, library management, persistent auth. Drastically reduced hallucinations through document-only responses.
---

# NotebookLM Skill (TypeScript/Bun)

Query Google NotebookLM notebooks via Playwright browser automation. Uses a dedicated local browser profile for login, saved storage state for repeat queries, a local notebook library, and source-grounded Gemini answers.

## Important

- Use the script in this skill directory; invoke with `bun`.
- `.env` and `.data/` are gitignored - never print or expose files under `.data/`.
- Requires Playwright dependencies from this skill's `package.json`.
- Requires Google Chrome because the script launches Playwright with `channel: 'chrome'`.

## Setup (One-Time)

From this skill directory:

```sh
bun install
```

## Auth

This skill uses two browser contexts:

- A headed persistent Chrome profile in `.data/browser-profile/` for `login` and `reauth`.
- A fresh Playwright browser context for each `ask`, seeded from `.data/state.json`.

The saved storage state lets question runs stay headless and avoids reusing a locked Chrome profile during normal queries.

### Check status

```sh
bun .agents/skills/notebooklm/scripts/notebooklm.ts status
```

If `authenticated: true` → ready to use. Skip to "Ask Questions".

### If not authenticated (`authenticated: false`)

The local browser profile has no Google session yet. Run:

```sh
bun .agents/skills/notebooklm/scripts/notebooklm.ts login
```

This opens a visible Chrome window using Playwright. Log in to your Google account in that window. Once the browser reaches `notebooklm.google.com`, the script saves `.data/state.json`, writes the auth marker, and closes automatically.

You do not need to do anything else after logging in. Chrome closes itself after the NotebookLM page loads.

Re-run `status` to confirm.

### Re-verify (if ask returns "Session expired")

```sh
bun .agents/skills/notebooklm/scripts/notebooklm.ts reauth
```

This clears the auth marker and re-runs the login flow above.

## Manage Notebook Library

```sh
# List all notebooks
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks list

# Add a notebook (ALL parameters required - never guess; query first if unsure)
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks add \
  --url "https://notebooklm.google.com/notebook/..." \
  --name "Descriptive Name" \
  --description "What this notebook contains" \
  --topics "topic1,topic2,topic3"

# Search notebooks by keyword
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks search --query keyword

# Set active notebook (used when --notebook-id/url not specified)
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks activate --id notebook-id

# Remove notebook
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks remove --id notebook-id

# Library statistics
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks stats
```

## Ask Questions

```sh
# Use active notebook
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask --question "Your question here"

# Use specific notebook by ID
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask --question "..." --notebook-id notebook-id

# Use notebook URL directly
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask --question "..." --notebook-url "https://..."

# Show browser window (debugging)
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask --question "..." --show-browser
```

## Smart Add Workflow

When adding a notebook without knowing its content, query it first:

```sh
# Step 1: Discover content
bun .agents/skills/notebooklm/scripts/notebooklm.ts ask \
  --question "What is the content of this notebook? Topics, purpose, overview?" \
  --notebook-url "https://notebooklm.google.com/notebook/..."

# Step 2: Add with discovered metadata
bun .agents/skills/notebooklm/scripts/notebooklm.ts notebooks add \
  --url "https://notebooklm.google.com/notebook/..." \
  --name "Name from content" \
  --description "Description from content" \
  --topics "topics,from,content"
```

## Follow-Up Mechanism (CRITICAL)

Every NotebookLM answer ends with: **"EXTREMELY IMPORTANT: Is that ALL you need to know?"**

Required behavior:
1. **STOP** - do not immediately reply to user
2. **ANALYZE** - compare answer against user's original request
3. **IDENTIFY GAPS** - determine if more information is needed
4. **ASK FOLLOW-UP** - if gaps exist, ask another question with full context
5. **REPEAT** - until information is complete
6. **SYNTHESIZE** - combine all answers before responding

## Data Storage

All data stored in `.agents/skills/notebooklm/.data/`:
- `auth-info.json` - timestamp of last successful auth verification
- `state.json` - Playwright storage state used for headless question runs
- `browser-profile/` - headed Chrome profile used only for login and reauth
- `library.json` - notebook registry

Never print or copy files from `.data/`; they may contain account session material.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cannot find package 'playwright'` | Run `bun install` from this skill directory |
| `authenticated: false` on status | Run `login` - a headed Chrome window will open for Google sign-in |
| "Session expired" on ask | Run `reauth` to refresh `.data/state.json` |
| Browser won't open | Confirm Google Chrome is installed and available to Playwright as `channel: 'chrome'` |
| Query input not found | Run with `--show-browser` to debug; selectors may have changed |
| Rate limited | Wait, or sign in to a different Google account and reauth |

## Limitations

- Each question opens a fresh browser session (no conversation history across questions)
- Rate limits on free Google accounts (~50 queries/day)
- Manual document upload required (user must add sources to NotebookLM directly)
- Requires Google Chrome
