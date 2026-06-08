# read-gmail

Read and search Gmail messages via local OAuth tokens. Supports multiple Gmail accounts with one shared OAuth client.

For first-time GCP setup see [SETUP_GUIDE.md](https://github.com/SainyTK/skills/blob/main/setup-guides/read-gmail/SETUP_GUIDE.md).

---

## Prerequisites

Install [Bun](https://bun.sh) if not already present:

**macOS**
```sh
curl -fsSL https://bun.sh/install | bash
```

**Windows** (PowerShell)
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verify with `bun --version`.

---

## Quick start

```sh
# Check auth status
bun .agents/skills/read-gmail/scripts/gmail.ts status

# First-time login (opens browser)
bun .agents/skills/read-gmail/scripts/gmail.ts login
```

---

## Commands

### Account management

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts status
bun .agents/skills/read-gmail/scripts/gmail.ts accounts
bun .agents/skills/read-gmail/scripts/gmail.ts default-account --email you@example.com
bun .agents/skills/read-gmail/scripts/gmail.ts logout --email you@example.com
```

Most commands use `--email` when provided, otherwise the default account, otherwise the only logged-in account.

### Recent inbox

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts inbox --email you@example.com --limit 20
```

### Search mail

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts search --email you@example.com --query 'from:alice@example.com newer_than:30d' --limit 20
```

Supports full [Gmail search syntax](https://support.google.com/mail/answer/7190): `from:`, `to:`, `subject:`, `has:attachment`, `newer_than:`, `label:`, etc.

### Read message

Use a message ID returned by `search` or `inbox`.

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts read --email you@example.com --id MESSAGE_ID --format full
```

Formats: `metadata`, `full`, `raw`.

### Download attachment

Use `messageId`, `attachmentId`, and filename from `read --format full`.

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts download-attachment \
  --email you@example.com \
  --message-id MSG_ID \
  --attachment-id ATT_ID \
  --filename invoice.pdf
```

---

## Multiple accounts

Use the same `.env` (same OAuth client) for all accounts — log in each separately:

```sh
bun .agents/skills/read-gmail/scripts/gmail.ts login        # adds another account
bun .agents/skills/read-gmail/scripts/gmail.ts accounts     # list all
bun .agents/skills/read-gmail/scripts/gmail.ts default-account --email you@example.com
```

---

## OAuth redirect URI

```
http://localhost:3457/gmail/callback
```

Recommended scope: `https://www.googleapis.com/auth/gmail.readonly`

---

## Security

- `.env` and `.data/` are gitignored — never commit them.
- Never print client ID, client secret, tokens, or authorization codes into chat or logs.
