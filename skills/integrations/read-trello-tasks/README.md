# read-trello-tasks

Read Trello boards, lists, cards, checklist items, and board/card activity via the Trello REST API.
Auth is handled through a local API key + user token (no GCP required).

For first-time setup see [SETUP_GUIDE.md](https://github.com/SainyTK/skills/blob/main/setup-guides/read-trello-tasks/SETUP_GUIDE.md).

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
bun .agents/skills/read-trello-tasks/scripts/trello.ts status

# First-time login (opens browser)
bun .agents/skills/read-trello-tasks/scripts/trello.ts login
```

---

## Commands

### Account

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts status
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

### Cards

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts cards --board BOARD_ID --limit 100
bun .agents/skills/read-trello-tasks/scripts/trello.ts cards --list LIST_ID --limit 50
bun .agents/skills/read-trello-tasks/scripts/trello.ts cards --board BOARD_ID --include-closed
```

### Card detail

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts card --id CARD_ID
```

Card ID or short link from `cards`/`search` output both work.

### Search

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts search --query 'invoice' --limit 20
bun .agents/skills/read-trello-tasks/scripts/trello.ts search --query 'bug' --partial
```

### Activity (board or card actions)

Fetch recent actions — card moves, edits, comments, checklist updates, etc.

```sh
# Board activity (last 50 actions, all types)
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID

# Increase limit (max 1000)
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID --limit 100

# Filter by action type
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID --filter commentCard
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID --filter updateCard

# Single card activity
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --card CARD_ID
```

`--filter` accepts any Trello action type (`commentCard`, `updateCard`, `createCard`, `moveCardToBoard`, `all`, etc.).
Defaults to `all`. `--limit` defaults to 50.

---

## Token scope

Default scope is `read`. For write flows, set `TRELLO_SCOPE=read,write` in `.env` and re-run `login`.

---

## Security

- `.env` and `.data/` are gitignored — never commit them.
- Never print the API key, token, or Power-Up Secret into chat or logs.
