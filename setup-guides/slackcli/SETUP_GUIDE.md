# slackcli - Setup Guide

How to install and authenticate `slackcli` so the skill can read and write Slack on your behalf.

Unlike the old `read-slack-messages` skill, this does not require creating a Slack app or configuring OAuth scopes by hand.
`slackcli` handles auth itself and stores credentials outside this repo, in `~/.config/slackcli/`.

---

## Prerequisites

- A Slack workspace you're a member of.
- macOS or Linux with Homebrew, or one of the alternate installs below.

---

## Step 1 - Install slackcli

**Homebrew (macOS/Linux)**
```sh
brew tap shaharia-lab/tap
brew install slackcli
```

**Pre-built binary** - download for Linux (x86_64, arm64), macOS (Intel, Apple Silicon), or Windows from the
[latest release](https://github.com/shaharia-lab/slackcli/releases/latest).

**From source** - requires Bun v1.0+ and TypeScript 5.x+:
```sh
git clone https://github.com/shaharia-lab/slackcli.git
cd slackcli
bun install
bun run build
```

Verify:

```sh
slackcli --version
```

---

## Step 2 - Authenticate

There are two ways to authenticate. Pick one.

### Option A - Browser session tokens via cURL (fastest, no Slack app needed)

1. Open your Slack workspace in a browser.
2. Open DevTools (F12) -> Network tab.
3. Send a message or refresh the page, then find any request to `slack.com/api/...`.
4. Right-click the request -> Copy -> Copy as cURL.
5. Run:

```sh
pbpaste | slackcli auth parse-curl --login
```

Or run it interactively and paste the cURL command when prompted:

```sh
slackcli auth parse-curl --login
```

This extracts the workspace URL, `xoxd`, and `xoxc` tokens from the cURL command and logs in.

Browser session tokens expire when your browser session does. If commands start failing with auth errors, repeat this step to get fresh tokens.

### Option B - Standard Slack app token (longer-lived, requires a Slack app)

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) with the OAuth scopes you need
   (e.g. `channels:history`, `search:read`, `chat:write`).
2. Install it to your workspace and copy the bot token (`xoxb-...`) or user token (`xoxp-...`).
3. Run:

```sh
slackcli auth login --token=xoxb-YOUR-TOKEN --workspace-name="My Team"
```

---

## Step 3 - Verify

```sh
slackcli auth list
```

Expected output lists your workspace with an ID and auth method (Browser or a token type).

Try a read command:

```sh
slackcli conversations list --limit 10
```

---

## Multiple workspaces

Repeat Step 2 for each additional workspace. Set which one is used by default:

```sh
slackcli auth set-default T1234567
```

Or override per command:

```sh
slackcli conversations list --workspace T1234567
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `slackcli: command not found` | Re-check installation in Step 1 and confirm it's on your PATH. |
| `not_authed` / auth errors after working before | Browser session tokens expired - repeat Step 2 Option A for fresh tokens. |
| `missing_scope` when reading or sending | You authenticated with a standard app token (Option B) that's missing a scope. Add the scope in the Slack app's OAuth settings, reinstall the app, and re-run `auth login`. |
| Can't see a private channel or DM | You must be a member of that conversation. The CLI reflects exactly what the authenticated account can access. |
| Lost track of which workspace is default | Run `slackcli auth list` - the default is marked. |
| Want to revoke access | Run `slackcli auth logout` (all workspaces) or `slackcli auth remove <workspace-id>` (one workspace). |
