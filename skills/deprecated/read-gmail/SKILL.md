---
name: read-gmail
version: 0.0.1
description: >
  Read/search Gmail messages for one or more local Google accounts via OAuth.
  Use when the user asks to read, check, search, summarize, inspect, or
  download attachments from Gmail.
---

# read-gmail

Read/search Gmail through local OAuth tokens. Supports multiple Gmail accounts with one shared OAuth client configured in `.env`.

## Important

- Use the script in this skill directory; invoke with `bun`.
- Secrets may live in `.agents/skills/read-gmail/.env`; never print or read that file into chat.
- Token storage defaults to `.agents/skills/read-gmail/.data/accounts/<email>.json`; do not print token contents.
- `.env` and `.data/` are gitignored.
- Prefer Gmail search syntax in `search --query`, for example `from:alice@example.com newer_than:7d has:attachment`.

## Setup / status

From repo root:

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts status
```

If no account is logged in:

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts login
```

The login command opens Google OAuth and waits for the localhost callback. The authenticated email is detected from Gmail and saved as the account key.

## Multiple Accounts

Use the same OAuth `.env` for every account. Log in each account separately:

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts login
bun .agents/skills/read-gmail/scripts/gmail.ts accounts
bun .agents/skills/read-gmail/scripts/gmail.ts default-account --email you@example.com
```

Most commands use `--email` when provided, otherwise the default account, otherwise the only logged-in account.

## Commands

### Status

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts status
```

### Accounts

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts accounts
bun .agents/skills/read-gmail/scripts/gmail.ts default-account --email you@example.com
bun .agents/skills/read-gmail/scripts/gmail.ts logout --email you@example.com
```

### Search Mail

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts search --email you@example.com --query 'from:alice@example.com newer_than:30d' --limit 20
```

### Read Message

Use an ID returned by `search`.

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts read --email you@example.com --id 18c123abc456 --format full
```

Formats: `metadata`, `full`, `raw`.

### Recent Inbox

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts inbox --email you@example.com --limit 20
```

### Download Attachment

Use `messageId`, `attachmentId`, and filename from `read --format full`.

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts download-attachment --email you@example.com --message-id MSG_ID --attachment-id ATT_ID --filename invoice.pdf
```

## OAuth

Create a Google OAuth client for a Desktop app or Web app with redirect URI:

```txt
http://localhost:3457/gmail/callback
```

Recommended scopes:

```txt
https://www.googleapis.com/auth/gmail.readonly
```

Optional, only if future write/archive/label flows are needed:

```txt
https://www.googleapis.com/auth/gmail.modify
```

## Output Discipline

- For large searches, filter or summarize script output instead of dumping raw output.
- Never expose tokens, client secret, authorization codes, or raw `.env` content.
- Gmail message bodies may contain sensitive personal data; only quote what the user needs.
