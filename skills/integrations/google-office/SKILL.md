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
- Secrets live in `.agents/skills/google-office/.env`; never print or read that file into chat.
- Token storage defaults to `.agents/skills/google-office/.data/accounts/<email>.json`; do not print token contents.
- `.env` and `.data/` are gitignored.
- Default scopes are **read + write** ("interact"). Switch `GOOGLE_SCOPES` in `.env` to the `*.readonly` variants for read-only access (see `env.example`).
- Write/delete operations change the user's real Drive/Docs/Sheets. Confirm intent before destructive actions (`drive-delete`, overwriting ranges with `sheets-write`).

## Setup / status

From repo root:

```sh
bun .agents/skills/google-office/scripts/office.ts status
```

If no account is logged in:

```sh
bun .agents/skills/google-office/scripts/office.ts login
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
bun .agents/skills/google-office/scripts/office.ts login
bun .agents/skills/google-office/scripts/office.ts accounts
bun .agents/skills/google-office/scripts/office.ts default-account --email you@example.com
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

### Docs

`--id` is the document ID (from its URL).

```sh
office.ts docs-get --id DOCUMENT_ID                            # title + plain text
office.ts docs-create --title "Meeting Notes" --text "First line\n"
office.ts docs-append --id DOCUMENT_ID --text "Appended paragraph\n"
office.ts docs-format --id DOCUMENT_ID                         # apply heading styles in-place

# Insert a table (2-D JSON array; also accepts a path to a .json file)
office.ts docs-insert-table --id DOCUMENT_ID --values '[["Name","Score"],["Alice",95]]'

# Insert an image from a public URL
office.ts docs-insert-image --id DOCUMENT_ID --url https://example.com/chart.png --width 400

# Insert a local image file (uploads to Drive, makes publicly readable, embeds, returns Drive file ID)
office.ts docs-insert-image --id DOCUMENT_ID --file ./screenshot.png --width 400 --height 300
```

`docs-create` **automatically formats** the document after inserting text — no manual `docs-format` call needed for new docs. `docs-format` is for applying or re-applying styles to an existing doc.

**Heading detection:** any line that is fully uppercase and contains ≥ 4 capital letters is treated as a heading. The first such line becomes the document `TITLE`; subsequent ones become `HEADING_2`. All other paragraphs keep `NORMAL_TEXT`. To match an existing doc's style instead, call `docs-get` first and inspect the named styles already in use.

**Tables:** `docs-insert-table` inserts at the end of the doc by default. Pass `--index N` to insert at a specific position. The `--values` flag accepts an inline 2-D JSON array or a path to a `.json` file.

**Images — `--url`:** the URI must be publicly accessible (HTTP/HTTPS). Sizes are in points (72 pt = 1 inch).

**Images — `--file`:** uploads the local file to Google Drive, grants `anyoneWithLink` reader access (required by the Docs API), embeds the image, and returns the Drive file ID. The file stays publicly readable after insertion — delete it or revoke its permission via Drive UI or `drive-delete --id DRIVE_FILE_ID` once the document is finalized.

## Styling

**Always apply proper styling** after creating or significantly editing a Sheet or Doc. Never leave a newly created file with default plain formatting.

### For new Google Sheets

After writing data, call `sheets-format` with a `batchUpdate` requests array that covers:

1. **Title row** — merge across all columns; dark background (e.g. navy `#1a237e`), white bold text, centered, padded.
2. **Section / table headers** — bold, medium-color background matching the title palette, white text.
3. **Column headers** — bold, slightly lighter variant of the header color, white text.
4. **Data rows** — alternating white / very-light-gray banding (`addBanding` request) for readability.
5. **Special rows** — highlight notable rows (e.g. launch week, spikes, totals) with a distinct accent color.
6. **Borders** — `updateBorders` with a medium outer border and thin inner grid in a color consistent with the palette.
7. **Column widths** — `updateDimensionProperties` sized to content (label columns ~150–180 px, number columns ~110 px, note columns ~200 px).
8. **Freeze** — freeze the title row (and table header row if applicable) via `updateSheetProperties`.

Colors are specified as `{ red, green, blue }` floats (0.0–1.0). Pick a consistent palette (e.g. one dark anchor color + one medium variant + light tint for section headers).

### For existing Google Sheets

Before writing data or adding a sheet, call `sheets-get` to check existing tabs, then `sheets-read` a sample range and inspect any existing header rows. Mirror the colors, bold style, and column widths already present rather than introducing a new palette.

### For Google Docs

**New docs:** `docs-create --text` automatically applies heading styles — no extra step needed. Structure your text so section headers are fully uppercase (e.g. `KEY METRICS`, `RECOMMENDATIONS`).

**Existing docs:** call `docs-format --id ID` to detect and apply heading styles in place. Before doing so, call `docs-get --id ID` to inspect any named styles already applied; if the doc already has a custom heading palette, use the Docs API `batchUpdate` (`updateTextStyle` / `updateParagraphStyle`) directly via the `api` helper in `lib.ts` to match the existing style rather than resetting to defaults.

## Output discipline

- For large listings or sheet ranges, filter or summarize the script output instead of dumping it all.
- Never expose tokens, client secret, authorization codes, or raw `.env` content.
- Document/sheet contents may be sensitive; only quote what the user needs.
