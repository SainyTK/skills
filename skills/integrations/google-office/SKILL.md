---
name: google-office
description: >
  Interact with Google Drive, Google Docs, and Google Sheets for one or more
  local Google accounts via OAuth. Use when the user asks to list/search/
  download/upload Drive files, read or edit a Google Sheet, or read/create/
  append to a Google Doc.
---

# google-office

Read and write Google Drive, Docs, and Sheets through local OAuth tokens. Same auth mechanism as the `read-gmail` skill (localhost OAuth callback, multi-account token storage), with one shared OAuth client configured in `.env`.

## Important

- Use the script in this skill directory; invoke with `bun`.
- Secrets live in `.claude/skills/google-office/.env`; never print or read that file into chat.
- Token storage defaults to `.claude/skills/google-office/.data/accounts/<email>.json`; do not print token contents.
- `.env` and `.data/` are gitignored.
- Default scopes are **read + write** ("interact"). Switch `GOOGLE_SCOPES` in `.env` to the `*.readonly` variants for read-only access (see `env.example`).
- Write/delete operations change the user's real Drive/Docs/Sheets. Confirm intent before destructive actions (`drive-delete`, overwriting ranges with `sheets-write`).

## Setup / status

From repo root:

```sh
bun .claude/skills/google-office/scripts/office.ts status
```

If no account is logged in:

```sh
bun .claude/skills/google-office/scripts/office.ts login
```

The login command opens Google OAuth and waits for the localhost callback. The authenticated email is detected from the userinfo endpoint and saved as the account key.

## OAuth setup (one time)

You can reuse the **same OAuth client** as `read-gmail`. Copy its client id/secret into this skill's `.env` (as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). Then, in Google Cloud Console for that client:

1. Enable the **Google Drive API**, **Google Docs API**, and **Google Sheets API** for the project.
2. Add this authorized redirect URI (Web app clients only — Desktop app clients accept any loopback automatically):

   ```txt
   http://localhost:3457/office/callback
   ```

3. Ensure the consent screen grants the scopes in `GOOGLE_SCOPES`.

Then run `login`. Each account is logged in separately and reuses the same `.env`.

## Multiple accounts

```sh
bun .claude/skills/google-office/scripts/office.ts login
bun .claude/skills/google-office/scripts/office.ts accounts
bun .claude/skills/google-office/scripts/office.ts default-account --email you@example.com
```

Most commands use `--email` when provided, otherwise the default account, otherwise the only logged-in account.

## Commands

### Auth

```sh
office.ts status
office.ts login
office.ts accounts
office.ts default-account --email you@example.com
office.ts logout --email you@example.com
```

### Drive

```sh
# Search / list (uses Drive query syntax in --query)
office.ts drive-list --query "name contains 'budget' and mimeType='application/vnd.google-apps.spreadsheet'" --limit 20
office.ts drive-list --query "'<FOLDER_ID>' in parents and trashed=false"

# Metadata for one file
office.ts drive-get --id FILE_ID

# Download (Google-native files are exported; default Docs→txt, Sheets→csv, Slides→pdf)
office.ts drive-download --id FILE_ID --output ./out.pdf
office.ts drive-download --id DOC_ID --export-mime application/pdf

# Create folder / upload a local file
office.ts drive-create-folder --name "Reports" --parent PARENT_FOLDER_ID
office.ts drive-upload --file ./report.pdf --name "Q2 Report.pdf" --parent FOLDER_ID --mime application/pdf

# Delete (trash by default; --hard permanently deletes)
office.ts drive-delete --id FILE_ID
office.ts drive-delete --id FILE_ID --hard
```

Common Drive `--query` clauses: `name contains 'x'`, `mimeType='application/vnd.google-apps.document'`, `'FOLDER_ID' in parents`, `trashed=false`, `modifiedTime > '2026-01-01T00:00:00'`.

### Sheets

`--id` is the spreadsheet ID (from its URL). `--range` is A1 notation, e.g. `Sheet1!A1:C10`.

```sh
office.ts sheets-get --id SPREADSHEET_ID                       # tab names, sizes
office.ts sheets-read --id SPREADSHEET_ID --range "Sheet1!A1:D20"
office.ts sheets-write --id SPREADSHEET_ID --range "Sheet1!A1" --values '[["Name","Total"],["Alice",42]]'
office.ts sheets-append --id SPREADSHEET_ID --range "Sheet1!A1" --values '[["Bob",7]]'
office.ts sheets-create --title "New Tracker"
office.ts sheets-format --id SPREADSHEET_ID --requests JSON-or-path
```

- `--values` accepts an inline JSON 2D array or a path to a `.json` file containing one.
- Values are parsed as formulas/numbers/dates by default (USER_ENTERED). Pass `--raw` to store literally.
- `--requests` for `sheets-format` accepts an inline JSON array or a path to a `.json` file of Sheets API `batchUpdate` request objects.

#### Reusable Google Sheet scripts (`scripts/google-sheet/`)

Higher-level scripts live in `scripts/google-sheet/` and accept any spreadsheet ID via `--id`. Import helpers from `sheet-utils.ts` rather than duplicating logic in ad-hoc scripts.

```sh
# Apply formal style to any spreadsheet (first tab, with title row)
bun .claude/skills/google-office/scripts/google-sheet/apply-style.ts --id SPREADSHEET_ID

# Target a specific tab
bun .claude/skills/google-office/scripts/google-sheet/apply-style.ts --id SPREADSHEET_ID --sheet "Sheet1"

# Data starts with column headers (no merged title row)
bun .claude/skills/google-office/scripts/google-sheet/apply-style.ts --id SPREADSHEET_ID --no-title-row

# Style tokens live in one place — edit to restyle everything at once
.claude/skills/google-office/scripts/google-sheet/style.config.ts
```

**`sheet-utils.ts` exports:**
- `applyFormalStyle(email, spreadsheetId, opts?)` — full style pass: title merge, header row, alternating banding, borders, freeze, column widths
- `batchUpdate(email, spreadsheetId, requests)` — low-level Sheets API batchUpdate wrapper

**`SheetStyleOptions`:**
- `sheetName?: string` — which tab to style (default: first tab)
- `hasTitleRow?: boolean` — row 0 is a merged title (default: `true`)

**Style defaults (change in `style.config.ts`):**

| Element | Font | Size | Background |
|---------|------|------|------------|
| Title row (merged) | Poppins | 14 pt | `#0f2060` deep navy |
| Column header row | Poppins | 11 pt | `#163872` navy blue |
| Data rows (even) | Inter | 10 pt | white |
| Data rows (odd) | Inter | 10 pt | `#eef2fa` light blue |

Column widths: first column 200 px (label), remaining 150 px (default). All tokens in `style.config.ts`.

### Docs

`--id` is the document ID (from its URL).

```sh
office.ts docs-get --id DOCUMENT_ID                            # title + plain text
office.ts docs-create --title "Meeting Notes" --text "First line\n"
office.ts docs-append --id DOCUMENT_ID --text "Appended paragraph\n"
office.ts docs-format --id DOCUMENT_ID                         # detect ALL_CAPS headings, assign named styles

# Insert a table (2-D JSON array; also accepts a path to a .json file)
office.ts docs-insert-table --id DOCUMENT_ID --values '[["Name","Score"],["Alice",95]]'

# Insert an image from a public URL
office.ts docs-insert-image --id DOCUMENT_ID --url https://example.com/chart.png --width 400

# Insert a local image file (uploads to Drive, makes publicly readable, embeds, returns Drive file ID)
office.ts docs-insert-image --id DOCUMENT_ID --file ./screenshot.png --width 400 --height 300
```

#### Reusable Google Doc scripts (`scripts/google-doc/`)

Higher-level scripts live in `scripts/google-doc/` and accept any doc ID via `--id`. Import helpers from `doc-utils.ts` rather than duplicating logic in ad-hoc scripts.

```sh
# Apply formal style (fonts, colours, spacing, margins) to any existing doc
bun .claude/skills/google-office/scripts/google-doc/apply-style.ts --id DOC_ID

# Style tokens live in one place — edit to restyle everything at once
.claude/skills/google-office/scripts/google-doc/style.config.ts
```

**`doc-utils.ts` exports:**
- `applyFormalStyle(email, docId)` — full style pass: margins, title, headings, body
- `insertStyledTable(email, docId, insertIndex, values)` — inserts a table with styled header row
- `insertImage(email, docId, insertIndex, uri, width?, height?)` — inserts and centres an image
- `findEnd(content, needle)` / `findStart(content, needle)` — locate paragraphs by text

**Style defaults (change in `style.config.ts`):**

| Element | Font | Size |
|---------|------|------|
| Title | Poppins | 22 pt |
| Heading 1 | Poppins | 16 pt |
| Heading 2 | Poppins | 14 pt |
| Heading 3 | Poppins | 12 pt |
| Body | Inter | 11 pt |
| Table | Inter | 10.5 pt |

Colour palette: deep navy title (`#0f2060`), navy-blue headings (`#163872`), table header (`#163872`/white), muted grey captions (`#666666`). All tokens are in `style.config.ts`.

---

## Styling — Hard Rules

> These rules are non-negotiable. Apply them on every Google Doc operation.

### 1. Plan structure BEFORE writing content

Before creating or significantly editing a Google Doc, explicitly decide:

- **Sections** — what top-level sections does the document need?
- **Tables** — what comparative, statistical, or reference data should be a table instead of prose?
- **Bullet points** — what lists of items, features, or attributes should be bulleted?
- **Numbered lists** — what sequential steps, ranked items, or ordered processes should be numbered?

Do not start writing prose until the outline is clear. Documents that contain only paragraphs are unacceptable — structure information visually wherever it helps the reader.

### 2. Always use structured content

Every Google Doc must include the appropriate mix of:

| Content type | Use when |
|---|---|
| **Table** | Comparing options, listing specs/stats, timelines with 2+ columns, pros-vs-cons |
| **Bullet list** | Unordered features, characteristics, requirements, observations |
| **Numbered list** | Steps, ranked priorities, sequential processes |
| **Prose paragraphs** | Narrative explanation, context, analysis — not raw data |

A document that is only bullets, or only prose, is a signal that structure has not been thought through.

### 3. Always apply formal styling — never leave a doc unstyled

**For every new doc:**
1. Write the text with ALL_CAPS section headers (e.g. `EXECUTIVE SUMMARY`, `KEY FINDINGS`).
2. Run `docs-create --text` (which auto-applies named styles) then immediately run:
   ```sh
   bun .claude/skills/google-office/scripts/google-doc/apply-style.ts --id DOC_ID
   ```
3. Insert all tables using `insertStyledTable` from `doc-utils.ts` — never use unstyled `docs-insert-table` for new content.

**For existing docs:**
1. Call `docs-get --id ID` to read current content and named styles.
2. If the doc uses default Google fonts (Arial/Calibri) with no custom colours, apply the formal style:
   ```sh
   bun .claude/skills/google-office/scripts/google-doc/apply-style.ts --id DOC_ID
   ```
3. If the doc already has a custom style, mirror it — do not override with the default palette.

**Never** leave a newly created document with:
- Default Google font (Arial)
- No heading colours
- No page margin adjustment
- Plain unformatted tables

### 4. Default font stack

| Role | Font |
|------|------|
| Title, all headings | **Poppins** |
| Body text, table cells, captions | **Inter** |

Both fonts are available in Google Docs without installation. Do not use Arial, Calibri, or Times New Roman unless the user explicitly requests them.

### 5. Writing ad-hoc doc scripts

When you need to write a one-off script for a specific doc (e.g. enriching content, batch-inserting tables):

- Place the script in `scripts/google-doc/` (not directly in `scripts/`).
- Accept doc ID via `--id DOC_ID` — never hardcode an ID.
- Import helpers from `./doc-utils.ts` and style tokens from `./style.config.ts`.
- Delete or generalise the script after use so the folder stays clean.

---

## Styling — Google Sheets — Hard Rules

> These rules are non-negotiable. Apply them on every Google Sheet operation.

### 1. Always apply formal styling — never leave a sheet unstyled

**For every new sheet:**
1. Write data with `sheets-write` or `sheets-append`.
2. Immediately run:
   ```sh
   bun .claude/skills/google-office/scripts/google-sheet/apply-style.ts --id SPREADSHEET_ID
   ```
   Add `--no-title-row` if row 0 is already the column-header row (no separate title).

**For existing sheets:**
1. Call `sheets-get --id ID` to inspect existing tabs.
2. Call `sheets-read` on a sample range to check whether headers are already styled.
3. If the sheet uses default Google styling (no custom colours, no frozen rows), apply formal style:
   ```sh
   bun .claude/skills/google-office/scripts/google-sheet/apply-style.ts --id SPREADSHEET_ID --sheet "Tab Name"
   ```
4. If the sheet already has a custom palette, mirror it — do not override with the default palette.

**Never** leave a newly created sheet with:
- Default font (Arial)
- No background on the header row
- No alternating row banding
- No frozen rows
- Default column widths

### 2. Default font stack

| Role | Font |
|------|------|
| Title row, column headers | **Poppins** |
| Data cells, body content | **Inter** |

### 3. Writing ad-hoc sheet scripts

When you need a one-off script for a specific spreadsheet:

- Place it in `scripts/google-sheet/` (not directly in `scripts/`).
- Accept the spreadsheet ID via `--id` — never hardcode an ID.
- Import helpers from `./sheet-utils.ts` and tokens from `./style.config.ts`.
- Delete or generalise the script after use so the folder stays clean.

---

## Output discipline

- For large listings or sheet ranges, filter or summarize the script output instead of dumping it all.
- Never expose tokens, client secret, authorization codes, or raw `.env` content.
- Document/sheet contents may be sensitive; only quote what the user needs.
