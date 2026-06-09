---
name: google-office
version: 0.1.1
description: >
  Interact with Google Drive, Google Docs, Google Sheets, and Gmail for one or
  more local Google accounts via OAuth. Use when the user asks to list/search/
  download/upload Drive files, read or edit a Google Sheet, read/create/append
  to a Google Doc, or read/draft/send Gmail messages.
---

# google-office

Read and write Google Drive, Docs, Sheets, and Gmail through local OAuth tokens. Multi-account token storage with one shared OAuth client configured in `.env`.

## Important

- Use the script in this skill directory; invoke with `bun`.
- Secrets live in `.claude/skills/google-office/.env`; never print or read that file into chat.
- Token storage defaults to `.claude/skills/google-office/.data/accounts/<email>.json`; do not print token contents.
- `.env` and `.data/` are gitignored.
- Default scopes are **read + write** across Drive, Docs, Sheets, and Gmail. Switch `GOOGLE_SCOPES` in `.env` to the `*.readonly` variants for read-only access (see `env.example`).
- Write/delete operations change the user's real Drive/Docs/Sheets. Confirm intent before destructive actions (`drive-delete`, overwriting ranges with `sheets-write`).
- **Gmail send operations** (`gmail-send`, `gmail-send-draft`, `gmail-reply`) send real email. Always confirm with the user before executing any send command — see Gmail Hard Rules below.

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

In Google Cloud Console, create or reuse an OAuth client:

1. Enable **Google Drive API**, **Google Docs API**, **Google Sheets API**, and **Gmail API** for the project.
2. Add this authorized redirect URI (Web app clients only — Desktop app clients accept any loopback automatically):

   ```txt
   http://localhost:3457/office/callback
   ```

3. Ensure the consent screen grants the scopes in `GOOGLE_SCOPES` (see `env.example`).

Then run `login`. Each account is logged in separately and reuses the same `.env`.

> **Existing users:** If you previously logged in without the Gmail scope, run `login` again to re-authorize with the updated scope set.

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

## Google Docs API — Hard Rules

> These rules prevent structural failures that require a full document rebuild to fix.

### 1. Never pass multi-paragraph text as a single `--text` argument

`docs-create --text "...\n\n..."` or `docs-append` with a long multi-line string stores everything in **one giant text run** as a single paragraph element. Named styles (`TITLE`, `HEADING_1`) can only target separate paragraph elements — not character ranges inside one blob. `applyFormalStyle` and `docs-format` will silently do nothing useful.

**Rule:** For any document with headings or distinct sections, insert each paragraph as a **separate API call** (loop, calling `docs-append` once per paragraph). Never pass more than one paragraph of content in a single `--text` argument.

### 2. Image insertion index is `el.startIndex`, not `el.startIndex + 1`

To embed an image inside a blank paragraph `[S–E]`, use `insertIndex = S` (the paragraph's `startIndex`). Using `S + 1` equals the next paragraph's `startIndex` — the image silently merges into that paragraph (e.g. into a `HEADING_1`).

**Rule:** When inserting an image into a blank paragraph, set `insertIndex = el.startIndex`.

### 3. After `insertTable`, reset ghost `HEADING_1` empty paragraphs

The Docs API auto-creates an empty paragraph immediately before every inserted table. That paragraph inherits the named style from the surrounding context. If the insertion point is near a `HEADING_1`, the ghost paragraph becomes a `HEADING_1` too — visible as oversized blank space.

**Rule:** After every table insertion, re-fetch the document and scan `body.content` for paragraphs with `namedStyleType === 'HEADING_1'` and empty text. Batch-reset them to `NORMAL_TEXT`.

### 4. `findEnd`/`findStart` only work when paragraphs are separate structural elements

These helpers iterate `body.content` looking for `paragraph` elements whose joined text includes the needle. If the document was built incorrectly (all text in one paragraph), `findEnd` returns the end of the entire document, causing `insertInlineImage` to fail with *"index must be less than end index"*.

**Rule:** Only use `findEnd`/`findStart` after verifying the document has proper paragraph structure. If `body.content.length ≤ 3` for a multi-section document, the structure is broken — rebuild before proceeding.

### 5. Verify document structure before inserting images or tables

After creating a document, check `body.content` element count. A multi-section document with only 2–3 elements means everything is in one blob. Inserting images or tables into a broken structure produces wrong indices and silent API failures.

**Rule:** After `docs-create`, verify paragraph count roughly matches section count before any `insertImage` or `insertTable` call:

```ts
const paraCount = content.filter(e => e.paragraph).length;
// A 7-section doc should have 20+ paragraph elements
if (paraCount < 10) throw new Error('Document structure broken — rebuild first');
```

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

### Gmail

```sh
# Search messages (Gmail search syntax)
office.ts gmail-search --query "from:alice@example.com newer_than:7d has:attachment" --limit 20

# Recent inbox
office.ts gmail-inbox --limit 20

# Read a message (use ID from search)
office.ts gmail-read --id MSG_ID --format full

# Download attachment (use IDs from gmail-read --format full)
office.ts gmail-download-attachment --message-id MSG_ID --attachment-id ATT_ID --filename invoice.pdf

# Create a draft (saves to Drafts, does NOT send)
office.ts gmail-create-draft --to alice@example.com,bob@example.com --subject "Hello" --body "Hi there"
office.ts gmail-create-draft --to alice@example.com --subject "Re: Ticket" --body "Thanks" --reply-to-id ORIG_MSG_ID

# Send an existing draft by its draft ID
office.ts gmail-send-draft --id DRAFT_ID

# Send a new email directly (CONFIRM WITH USER FIRST)
office.ts gmail-send --to alice@example.com --subject "Hello" --body "Hi there"

# Reply to a message (CONFIRM WITH USER FIRST)
office.ts gmail-reply --reply-to-id ORIG_MSG_ID --body "Thanks for reaching out"
```

Common Gmail search operators: `from:`, `to:`, `subject:`, `in:inbox`, `in:sent`, `has:attachment`, `newer_than:7d`, `is:unread`, `label:`.

---

## Gmail — Hard Rules

> These rules are non-negotiable for all Gmail send operations.

### 1. Always confirm before sending

Before executing `gmail-send`, `gmail-send-draft`, or `gmail-reply`, **always** show the user the full email details and ask for explicit confirmation:

- **To** (and Cc/Bcc if set)
- **Subject**
- **Body** (full text)

Do not proceed until the user confirms. This rule applies even if the user previously asked you to draft and send in the same request.

### 2. Prefer draft → review → send

When composing on behalf of the user, the recommended flow is:

1. Run `gmail-create-draft` to save the draft.
2. Show the draft details to the user for review.
3. Only run `gmail-send-draft --id DRAFT_ID` after the user confirms.

Skipping straight to `gmail-send` is acceptable only when the user explicitly says to send immediately and you have shown them the full email content first.

### 3. Never expose tokens or message contents beyond what the user needs

- Do not print raw token data or `.env` contents.
- Message bodies may contain sensitive personal data — only quote what the user needs.

---

## Output discipline

- For large listings or sheet ranges, filter or summarize the script output instead of dumping it all.
- Never expose tokens, client secret, authorization codes, or raw `.env` content.
- Document/sheet contents may be sensitive; only quote what the user needs.
