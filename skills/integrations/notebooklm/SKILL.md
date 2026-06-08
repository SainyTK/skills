---
name: notebooklm
version: 0.0.1
description: Use this skill to query your Google NotebookLM notebooks directly from Claude Code for source-grounded, citation-backed answers from Gemini. Browser automation, library management, persistent auth. Drastically reduced hallucinations through document-only responses.
---

# NotebookLM Skill (TypeScript/Bun)

Query Google NotebookLM notebooks via browser automation. Uses a dedicated pool profile (`~/.profiles/agent-N`) for auth, local notebook library, and source-grounded Gemini answers.

## Important

- Use the script in this skill directory; invoke with `bun`.
- `.env` and `.data/` are gitignored — never print or expose files under `.data/`.
- Requires `agent-browser` installed globally and a browser available to it.

## Setup (One-Time)

```sh
npm i -g agent-browser && agent-browser install
```

No extra `bun install` needed — this skill has zero npm dependencies.

## Auth — pool profile model (read this)

This skill uses a **pool profile**: `~/.profiles/agent-1` by default, overridable via
`NOTEBOOKLM_PROFILE`. Each `~/.profiles/agent-N` holds an independent Google login —
to Google it is a separate "device". The browser session name is derived from the
profile basename (e.g. `agent-1`) so a profile can never be opened twice concurrently.

Hard rules (violating these gets ALL Google sessions revoked server-side):

- **Never share one profile across parallel agents.** Concurrent use forks Google's
  rotating session token; Google treats the fork as cookie theft and revokes the
  whole session family. Parallel agents must each set `NOTEBOOKLM_PROFILE` to a
  different slot (`agent-1`, `agent-2`, ...), each logged in once.
- **Never copy, export (`state save`), or load cookies between profiles.** Same
  revocation — it kills the *source* profile too.
- **Never `pkill` Chrome or delete `Singleton*` files in a profile dir.** Chrome's
  lock is the guard that keeps rule 1 enforced.

### Check status

```sh
bun .agents/skills/notebooklm/scripts/notebooklm.ts status
```

If `authenticated: true` → ready to use. Skip to "Ask Questions".

### If not authenticated (`authenticated: false`)

The pool profile has no Google session yet. Run:

```sh
bun .agents/skills/notebooklm/scripts/notebooklm.ts login
```

This opens a **visible Chrome window** using `agent-browser --headed`. Log in to your Google account in that window. Once the browser reaches `notebooklm.google.com`, the script detects success and closes automatically.

> The script is waiting on `agent-browser wait --url **notebooklm.google.com**`. You do not need to do anything else after logging in — Chrome closes itself.

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

# Add a notebook (ALL parameters required — never guess; query first if unsure)
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
1. **STOP** — do not immediately reply to user
2. **ANALYZE** — compare answer against user's original request
3. **IDENTIFY GAPS** — determine if more information is needed
4. **ASK FOLLOW-UP** — if gaps exist, ask another question with full context
5. **REPEAT** — until information is complete
6. **SYNTHESIZE** — combine all answers before responding

## Data Storage

All data stored in `.agents/skills/notebooklm/.data/`:
- `auth-info.json` — timestamp of last successful auth verification
- `library.json` — notebook registry

Auth cookies live in the pool profile (`NOTEBOOKLM_PROFILE`, default `~/.profiles/agent-1`). They never leave it — see the hard rules under Auth.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `agent-browser: command not found` | Run `npm i -g agent-browser && agent-browser install` |
| `authenticated: false` on status | Run `login` — a headed Chrome window will open for Google sign-in |
| "Session expired" on ask | Run `reauth` to re-verify; if that fails, run `agent-browser --session agent-1 --profile ~/.profiles/agent-1 --headed open https://notebooklm.google.com` manually and sign in |
| Profile busy / launch fails | Another agent holds this slot — set `NOTEBOOKLM_PROFILE=~/.profiles/agent-2` (etc.). Never kill the other Chrome or delete `Singleton*` files |
| Browser won't open | Run `agent-browser doctor` to diagnose |
| Query input not found | Run with `--show-browser` to debug; selectors may have changed |
| Rate limited | Wait, or sign in to a different Google account and reauth |

## Limitations

- Each question opens a fresh browser session (no conversation history across questions)
- Rate limits on free Google accounts (~50 queries/day)
- Manual document upload required (user must add sources to NotebookLM directly)
- Requires Chrome via `agent-browser install`
