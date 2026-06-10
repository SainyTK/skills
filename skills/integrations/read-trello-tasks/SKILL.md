---
name: read-trello-tasks
version: 0.0.3
description: >
  Read/search Trello boards, lists, cards, and checklist tasks visible to
  Sainy's logged-in Trello user via a local API-key plus token login. Use when
  the user asks to read, check, search, summarize, or inspect Trello tasks.
---

# read-trello-tasks

Read/search Trello tasks through a local Trello API key and user token. Trello tasks are represented as cards, with checklist items included when available.

## Important

- Use the script in this skill directory; invoke with `bun`.
- Secrets may live in `.agents/skills/read-trello-tasks/.env`; never print or read that file into chat.
- Token storage defaults to `.agents/skills/read-trello-tasks/.data/trello-token.json`; do not print token contents.
- `.env` and `.data/` are gitignored.
- Prefer board ID/list ID/card ID when available. Trello names are not unique.

## Setup / status

From repo root:

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts status
```

If not logged in:

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts login
```

The login command opens Trello authorization and waits for the localhost callback.

## Trello API key

Create a Trello Power-Up/API key at:

```txt
https://trello.com/power-ups/admin
```

Put the key in `.agents/skills/read-trello-tasks/.env`:

```txt
TRELLO_API_KEY=your_api_key
```

Default redirect URL:

```txt
http://localhost:3458/trello/callback
```

## Commands

### Status

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts status
```

### Account

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts me
bun .agents/skills/read-trello-tasks/scripts/trello.ts logout
```

### Boards

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts boards
bun .agents/skills/read-trello-tasks/scripts/trello.ts boards --filter all
```

### Lists

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts lists --board BOARD_ID
bun .agents/skills/read-trello-tasks/scripts/trello.ts lists --board BOARD_ID --filter all
```

### Cards / Tasks

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts cards --board BOARD_ID --limit 100
bun .agents/skills/read-trello-tasks/scripts/trello.ts cards --list LIST_ID --limit 50
bun .agents/skills/read-trello-tasks/scripts/trello.ts cards --board BOARD_ID --include-closed
```

### Read Card

Use card ID or short link from `cards`/`search`.

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts card --id CARD_ID
```

### Search

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts search --query 'invoice' --limit 20
```

### Board / Card Activity

Fetch recent actions (moves, edits, comments, checklist updates, etc.) for a board or a single card.

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID --limit 100
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --card CARD_ID
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID --filter commentCard
```

`--filter` accepts any Trello action type (e.g. `commentCard`, `updateCard`, `createCard`, `all`). Defaults to `all`.
`--limit` defaults to 50, max 1000.

## Token scope

Default login scope:

```txt
read
```

For future writing/editing flows, set:

```txt
TRELLO_SCOPE=read,write
```

## Output Discipline

- For large boards/searches, filter or summarize script output instead of dumping raw output.
- Never expose tokens, API key, authorization fragments, or raw `.env` content.
- Trello cards may contain sensitive personal/work data; only quote what the user needs.
