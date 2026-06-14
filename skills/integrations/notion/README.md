# notion

Read, search, create, and update Notion pages, blocks, databases, and data source rows through the Notion REST API.

For first-time setup see [SETUP_GUIDE.md](https://github.com/SainyTK/skills/blob/main/setup-guides/notion/SETUP_GUIDE.md).

---

## Prerequisites

Install [Bun](https://bun.sh) if not already present:

**macOS**
```sh
curl -fsSL https://bun.sh/install | bash
```

Verify with `bun --version`.

---

## Quick start

```sh
# Check auth status
bun .agents/skills/notion/scripts/notion.ts status

# Search shared Notion content
bun .agents/skills/notion/scripts/notion.ts search --query "meeting notes" --type page
```

---

## Commands

### Account

```sh
bun .agents/skills/notion/scripts/notion.ts status
```

### Search

```sh
bun .agents/skills/notion/scripts/notion.ts search --query "roadmap" --type page --limit 10
bun .agents/skills/notion/scripts/notion.ts search --type data_source --limit 20
```

### Pages and blocks

```sh
bun .agents/skills/notion/scripts/notion.ts page --id PAGE_ID
bun .agents/skills/notion/scripts/notion.ts page --id PAGE_ID --content
bun .agents/skills/notion/scripts/notion.ts blocks --id PAGE_ID --recursive
```

### Databases and data sources

```sh
bun .agents/skills/notion/scripts/notion.ts database --id DATABASE_ID
bun .agents/skills/notion/scripts/notion.ts data-source --id DATA_SOURCE_ID
bun .agents/skills/notion/scripts/notion.ts query-data-source --id DATA_SOURCE_ID --limit 25
```

### Write content

```sh
bun .agents/skills/notion/scripts/notion.ts create-page --parent-page PAGE_ID --title "New notes" --text "First paragraph"
bun .agents/skills/notion/scripts/notion.ts append --id PAGE_ID --text "Added paragraph"
bun .agents/skills/notion/scripts/notion.ts update-page --id PAGE_ID --properties ./properties.json
```

Confirm before destructive writes such as archiving or trashing pages.

---

## Security

- `.env` is gitignored. Never commit it.
- Never print the Notion integration token or raw `.env` content into chat or logs.
- The token can only access content explicitly shared with its Notion connection.
