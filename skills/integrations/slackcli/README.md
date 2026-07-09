# slackcli

Read and write Slack - channels, DMs, threads, search, canvases, reactions -
through the local `slackcli` CLI. The CLI owns authentication and token
storage; no OAuth app setup is required in this repo.

For first-time setup, see the [setup guide](https://github.com/SainyTK/skills/tree/main/setup-guides/slackcli/SETUP_GUIDE.md).

---

## Prerequisites

Install `slackcli`:

**macOS/Linux (Homebrew)**
```sh
brew tap shaharia-lab/tap
brew install slackcli
```

Other install methods (pre-built binaries, build from source) are documented at
[github.com/shaharia-lab/slackcli](https://github.com/shaharia-lab/slackcli).

Verify with `slackcli --version`.

---

## Quick start

```sh
# Check authenticated workspaces
slackcli auth list

# First-time login (see setup guide for auth method options)
slackcli auth parse-curl --login
```

---

## Commands

### Auth

```sh
slackcli auth list
slackcli auth set-default T1234567
slackcli auth remove T1234567
slackcli auth logout
```

### Conversations

```sh
slackcli conversations list
slackcli conversations list --types public_channel,private_channel
slackcli conversations read C1234567890
slackcli conversations read C1234567890 --thread-ts 1710000000.000000
slackcli conversations get C1234567890 1710000000.000000
slackcli conversations unread
```

### Search

```sh
slackcli search messages 'deployment failed'
slackcli search messages 'from:@alice after:2026-06-01'
slackcli search channels 'eng'
slackcli search people 'alice'
```

### Messages

```sh
slackcli messages send --recipient-id C1234567890 --message 'Hello!'
slackcli messages send --recipient-id C1234567890 --thread-ts 1710000000.000000 --message 'Reply'
slackcli messages react --channel-id C1234567890 --timestamp 1710000000.000000 --emoji thumbsup
slackcli messages draft --recipient-id C1234567890 --message 'Draft text'
```

### Canvas

```sh
slackcli canvas list
slackcli canvas read F1234567890
```

### Saved items

```sh
slackcli saved list
```

### Multi-workspace

Any command accepts `--workspace <id|name>` to target a workspace other than the default.

---

## Security

- Credentials are stored by the CLI itself in `~/.config/slackcli/workspaces.json`, outside this repo.
- Never print the contents of that file, raw tokens, or cURL commands containing tokens.
- The authenticated workspace inherits exactly what that Slack account can see.
- To revoke access: run `slackcli auth logout` or `slackcli auth remove <workspace-id>`.
