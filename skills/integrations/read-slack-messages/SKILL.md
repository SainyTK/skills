---
name: read-slack-messages
version: 0.0.3
description: >
  Read/search Slack messages visible to Sainy's logged-in Slack user via a
  local user-token OAuth token. Use when the user asks to read, check, search,
  summarize, or inspect Slack messages, channels, DMs, or threads.
---

# read-slack-messages

Read/search Slack messages visible to Sainy's logged-in Slack user via a local user-token OAuth token. Use when the user asks to read, check, search, summarize, or inspect Slack messages/channels/DMs.

## Important

- Use the scripts in this skill directory; invoke with `bun`.
- The skill uses user-token OAuth only by default. No Slack bot install is required.
- Secrets live in the skill's `.env` file; never print or read that file into chat.
  - **Claude Code:** `.claude/skills/read-slack-messages/.env`
  - **Codex:** `.agents/skills/read-slack-messages/.env`
- Token storage is inside the skill's `.data/` folder (resolved automatically from script location); do not print token contents.
- `.env` and `.data/` are gitignored.

## Setup / status

From repo root:

**Claude Code**
```sh
bun .claude/skills/read-slack-messages/scripts/slack.ts status
```

**Codex**
```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts status
```

If not logged in, run login:

**Claude Code**
```sh
bun .claude/skills/read-slack-messages/scripts/slack.ts login
```

**Codex**
```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts login
```

The login command opens Slack OAuth and waits for the localhost callback.

## Commands

Always run from repo root or pass absolute script path. Replace `<skill_path>` with:
- `.claude/skills/read-slack-messages` for Claude Code
- `.agents/skills/read-slack-messages` for Codex

### Status

```sh
bun <skill_path>/scripts/slack.ts status
```

### List conversations

```sh
bun <skill_path>/scripts/slack.ts list --limit 50
```

### Read a conversation

Use channel ID if possible, especially for DMs/private channels.
Messages with Slack files include safe file metadata plus private Slack file URLs for download.

```sh
bun <skill_path>/scripts/slack.ts read --channel C123 --limit 30
bun <skill_path>/scripts/slack.ts read --channel '#general' --limit 30
```

### Read a thread

```sh
bun <skill_path>/scripts/slack.ts thread --channel C123 --ts 1710000000.000000 --limit 100
```

### Search messages

```sh
bun <skill_path>/scripts/slack.ts search --query 'from:@sainy after:2026-06-01' --limit 20
```

### Download an image/file

Use a `url_private`, `url_private_download`, or `thumb` URL returned by `read` or `thread`.
The file is downloaded with the stored Slack user token; token contents are never printed.

```sh
bun <skill_path>/scripts/slack.ts download-file --url 'https://files.slack.com/files-pri/...' --output /tmp/slack-image.png
```

### Send message (only if write scope configured)

```sh
bun <skill_path>/scripts/slack.ts send --channel C123 --text 'message'
```

## Slack scopes

User Token Scopes recommended:

```txt
channels:read
channels:history
groups:read
groups:history
im:read
im:history
mpim:read
mpim:history
users:read
search:read
files:read
```

For sending as user, add an appropriate Slack user write scope if your workspace/app policy allows it.

## Output discipline

- For large channels/searches, use context-mode (`ctx_execute`) to filter/summarize script output instead of dumping raw output.
- Never expose tokens, client secret, or raw `.env` content.
