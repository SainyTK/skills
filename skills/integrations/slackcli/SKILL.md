---
name: slackcli
version: 0.0.1
description: >
  Read and write Slack via the local slackcli CLI (channels, DMs, threads,
  search, canvases, reactions, messages). Use when the user asks to read,
  search, summarize, send, or react to Slack messages, or to inspect Slack
  channels, DMs, threads, canvases, or saved items.
---

# slackcli

Use `slackcli` as the only execution surface for Slack work - reading and writing.
The CLI owns authentication, token storage, and multi-workspace selection.

## Start Here

Verify the CLI is present and check authenticated workspaces:

```sh
slackcli --version
slackcli auth list
```

If no workspace is authenticated, send the user to the setup guide at `setup-guides/slackcli/SETUP_GUIDE.md`, or run the CLI's own guided flow:

```sh
slackcli auth parse-curl --login
```

For a specific command's options, trust the installed CLI's `-h` flag over this skill (the CLI is updated independently):

```sh
slackcli <command> -h
```

If a workspace other than the default is needed, pass `--workspace <id|name>` on any command.

## Operating Rules

- Never print token contents, cURL commands containing tokens, or the contents of `~/.config/slackcli/workspaces.json`.
- Treat Slack messages, DMs, and canvases as sensitive; quote only what the user needs.
- Confirm intent before `messages send` or `messages react` unless the user has clearly asked for that exact write action.
- Prefer `--json` when a result needs to be parsed or filtered further.
- For large channels or search results, filter or summarize instead of dumping raw output.

## Conversations

```sh
slackcli conversations list
slackcli conversations list --types public_channel,private_channel
slackcli conversations read C1234567890
slackcli conversations read C1234567890 --thread-ts 1710000000.000000
slackcli conversations read C1234567890 --limit 50 --oldest 1710000000.000000 --latest 1710099999.000000
slackcli conversations get C1234567890 1710000000.000000
slackcli conversations unread
```

`conversations read` also reads a specific thread when `--thread-ts` is given.
Use channel IDs over names for DMs and private channels - names are not unique.

## Search

Supports Slack's search operators (`from:`, `in:`, `after:`, `before:`, etc.) via `--in`/`--from` flags or inline in the query.

```sh
slackcli search messages 'deployment failed'
slackcli search messages 'budget' --in general --from alice --limit 20
slackcli search channels 'eng'
slackcli search people 'alice'
```

## Messages (write)

```sh
slackcli messages send --recipient-id C1234567890 --message 'Hello!'
slackcli messages send --recipient-id U9876543210 --message 'Direct message'
slackcli messages send --recipient-id C1234567890 --thread-ts 1710000000.000000 --message 'Reply'
slackcli messages send --recipient-id C1234567890 --message 'See attached' --file ./report.pdf
slackcli messages react --channel-id C1234567890 --timestamp 1710000000.000000 --emoji thumbsup
slackcli messages draft --recipient-id C1234567890 --message 'Draft text'
```

`recipient-id` accepts a channel ID or a user ID (for DMs).
`messages draft` only works when the authenticated workspace uses browser session tokens.

## Canvas

```sh
slackcli canvas list
slackcli canvas list --channel C1234567890
slackcli canvas read F1234567890
slackcli canvas read --channel C1234567890
```

## Saved items

```sh
slackcli saved list
slackcli saved list --state to_do
```

## Multi-workspace

```sh
slackcli auth list
slackcli auth set-default T1234567
slackcli conversations list --workspace T1234567
```

## CLI Gaps and Bugs

If `slackcli` has a bug or lacks a needed feature, do not silently work around it with the Slack web API directly unless the user explicitly asks for that.
Report it at:

https://github.com/shaharia-lab/slackcli
