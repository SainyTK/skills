---
name: notion
version: 0.0.1
description: >
  Read, search, create, and update Notion workspace content through a local
  Notion integration token. Use when the user asks to inspect Notion pages,
  page blocks, databases, data sources, database rows, or to write/append
  Notion content programmatically.
---

# notion

Read and write Notion pages, blocks, databases, and data sources through a local integration token.

## Important

- Use the script in this skill directory; invoke with `bun`.
- Secrets live in the skill's `.env` file; never print or read that file into chat.
  - **Claude Code:** `.claude/skills/notion/.env`
  - **Codex:** `.agents/skills/notion/.env`
- `.env` is gitignored.
- The default Notion API version is `2026-03-11`. Override with `NOTION_VERSION` only when the task requires an older API contract.
- Notion integrations only see pages/databases explicitly shared with the connection.
- Write operations change real Notion content. Confirm intent before creating, appending, updating, archiving, trashing, or locking pages.
- Page metadata is not page content. Use `blocks --id PAGE_ID` or `page --id PAGE_ID --content` to read page body blocks.
- For current Notion APIs, query rows through data sources: `query-data-source --id DATA_SOURCE_ID`. Retrieve a database first if you only have a database ID.

## Setup / status

From repo root:

**Claude Code**
```sh
bun .claude/skills/notion/scripts/notion.ts status
```

**Codex**
```sh
bun .agents/skills/notion/scripts/notion.ts status
```

If not configured, create an internal Notion connection, grant it access to target pages/databases, and put the token in `.env`:

```dotenv
NOTION_API_KEY=ntn_...
NOTION_VERSION=2026-03-11
```

For first-time setup, use `setup-guides/notion/SETUP_GUIDE.md`.

## Commands

Replace `<skill_path>` with:
- `.claude/skills/notion` for Claude Code
- `.agents/skills/notion` for Codex

### Auth

```sh
bun <skill_path>/scripts/notion.ts status
```

### Search

```sh
bun <skill_path>/scripts/notion.ts search --query "meeting notes" --type page --limit 10
bun <skill_path>/scripts/notion.ts search --query "tasks" --type data_source --limit 20
bun <skill_path>/scripts/notion.ts search --limit 50
```

`--type` accepts `page` or `data_source`. Omit `--query` to list shared pages/data sources.

### Pages and blocks

```sh
bun <skill_path>/scripts/notion.ts page --id PAGE_ID
bun <skill_path>/scripts/notion.ts page --id PAGE_ID --content
bun <skill_path>/scripts/notion.ts blocks --id PAGE_ID --limit 100
bun <skill_path>/scripts/notion.ts blocks --id BLOCK_ID --recursive --limit 100
```

Use the page ID as `--id` for `blocks` to read page body content.

### Databases and data sources

```sh
bun <skill_path>/scripts/notion.ts database --id DATABASE_ID
bun <skill_path>/scripts/notion.ts data-source --id DATA_SOURCE_ID
bun <skill_path>/scripts/notion.ts query-data-source --id DATA_SOURCE_ID --limit 25
bun <skill_path>/scripts/notion.ts query-data-source --id DATA_SOURCE_ID --body ./query.json
```

`query-data-source --body` accepts inline JSON or a path to JSON containing Notion `filter`, `sorts`, and/or `page_size`.

### Create and append

Create a normal child page under another page:

```sh
bun <skill_path>/scripts/notion.ts create-page --parent-page PAGE_ID --title "New notes" --text "First paragraph"
```

Create a row/page under a data source:

```sh
bun <skill_path>/scripts/notion.ts create-page \
  --data-source DATA_SOURCE_ID \
  --properties '{"Name":{"title":[{"text":{"content":"New task"}}]}}' \
  --text "Details"
```

Append text blocks to a page or block:

```sh
bun <skill_path>/scripts/notion.ts append --id PAGE_ID --text "One paragraph\n\nAnother paragraph"
bun <skill_path>/scripts/notion.ts append --id PAGE_ID --type heading_2 --text "Decision"
```

`append --type` accepts `paragraph`, `heading_1`, `heading_2`, `heading_3`, `bulleted_list_item`, `numbered_list_item`, and `to_do`.

### Update

Use `update-page` for property updates, icon/cover changes, lock/archive/trash flags, or raw body patches:

```sh
bun <skill_path>/scripts/notion.ts update-page --id PAGE_ID --properties ./properties.json
bun <skill_path>/scripts/notion.ts update-page --id PAGE_ID --body '{"is_locked":true}'
bun <skill_path>/scripts/notion.ts update-page --id PAGE_ID --archive true
```

Confirm with the user before `--archive true`, `--trash true`, or broad property rewrites.

### Raw API escape hatch

```sh
bun <skill_path>/scripts/notion.ts api GET /v1/users/me
bun <skill_path>/scripts/notion.ts api POST /v1/search --body '{"query":"notes"}'
```

## Output discipline

- Summarize large Notion responses instead of dumping raw page bodies into chat.
- Never expose the Notion token or raw `.env` content.
- Prefer IDs over names. Notion titles are not unique.
- If a 404 appears for a page/database that exists, check that the connection was shared with the original page or database, not only a linked database view.
