# read-slack-messages

Read and search Slack messages — channels, DMs, threads, files — via a local
user-token OAuth flow. No Slack bot install required for reading.

For first-time setup see the [setup guide](https://github.com/SainyTK/skills/tree/main/skills/integrations/read-slack-messages).

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
bun .agents/skills/read-slack-messages/scripts/slack.ts status

# First-time login (opens browser)
bun .agents/skills/read-slack-messages/scripts/slack.ts login
```

---

## Commands

### Account

```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts status
bun .agents/skills/read-slack-messages/scripts/slack.ts login
bun .agents/skills/read-slack-messages/scripts/slack.ts logout
```

### List conversations

Returns all channels, private groups, DMs, and multi-person DMs the user is a member of.

```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts list
bun .agents/skills/read-slack-messages/scripts/slack.ts list --limit 50
bun .agents/skills/read-slack-messages/scripts/slack.ts list --types public_channel
```

`--types` accepts a comma-separated list of `public_channel`, `private_channel`, `im`, `mpim`.
Defaults to all types.

### Read a conversation

Fetches recent messages from a channel or DM. Prefer channel ID (e.g. `C123`) over name for
DMs and private channels — names are not unique.

```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts read --channel C123
bun .agents/skills/read-slack-messages/scripts/slack.ts read --channel '#general' --limit 50
bun .agents/skills/read-slack-messages/scripts/slack.ts read --channel C123 --oldest 1710000000.000000
bun .agents/skills/read-slack-messages/scripts/slack.ts read --channel C123 --latest 1710099999.000000
```

Messages with Slack files include safe file metadata and private Slack file URLs for download.
`--limit` defaults to 30, max 200. `--oldest` / `--latest` are Unix timestamps.

### Read a thread

```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts thread --channel C123 --ts 1710000000.000000
bun .agents/skills/read-slack-messages/scripts/slack.ts thread --channel C123 --ts 1710000000.000000 --limit 100
```

`--ts` is the thread parent's timestamp (from `read` output). `--limit` defaults to 100, max 200.

### Search messages

Supports Slack's full search syntax (`from:`, `in:`, `after:`, `before:`, etc.).

```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts search --query 'deployment failed'
bun .agents/skills/read-slack-messages/scripts/slack.ts search --query 'from:@alice after:2026-06-01' --limit 20
bun .agents/skills/read-slack-messages/scripts/slack.ts search --query 'in:#general budget' --limit 50
```

`--limit` defaults to 20, max 100. Results are sorted by timestamp descending by default.

### Download a file

Downloads a Slack file using the stored user token. Use a `url_private`,
`url_private_download`, or `thumb` URL from `read` or `thread` output.

```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts download-file \
  --url 'https://files.slack.com/files-pri/...' \
  --output /tmp/slack-image.png
```

`--output` is optional; defaults to `.data/downloads/<filename>` inside the skill directory.

### Send a message

Only available if the app was granted a user write scope (e.g. `chat:write`).

```sh
bun .agents/skills/read-slack-messages/scripts/slack.ts send --channel C123 --text 'Hello!'
bun .agents/skills/read-slack-messages/scripts/slack.ts send --channel '#general' --text 'Heads up everyone'
```

---

## Scopes

Default user token scopes (read-only):

```
channels:read    channels:history
groups:read      groups:history
im:read          im:history
mpim:read        mpim:history
users:read       search:read      files:read
```

To add write access, append e.g. `chat:write` to `SLACK_USER_SCOPES` in `.env`, re-add the
scope on your Slack app's **OAuth & Permissions** page, and re-run `login`.

---

## Security

- `.env` and `.data/` are gitignored — never commit them.
- Never print the client secret, access token, or raw `.env` content into chat or logs.
- The user token inherits exactly the workspaces and channels the authorized account can see.
- To revoke access: run `logout`, or visit **Your Apps** at <https://api.slack.com/apps> and
  uninstall the app from the workspace.
