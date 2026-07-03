---
name: google-office
version: 1.0.1
description: >
  Use the goog CLI effectively for Google Drive, Google Docs, Google Sheets,
  and GoogleMail through local OAuth. Use when the user asks to list/search/
  download/upload Drive files, read or edit a Google Sheet, read or edit a
  Google Doc, or read/search/download Gmail messages.
---

# google-office

Use `goog` as the only execution surface for Google Drive, Docs, Sheets, and GoogleMail work.
The CLI owns installation, OAuth app setup, account tokens, incremental scopes, and multi-account selection.

## Start Here

First verify the CLI is present and inspect the available surface:

```sh
goog --help
goog auth --help
goog drive --help
goog docs --help
goog sheets --help
goog mail --help
```

If the CLI is missing, send the user to the `goog-cli` installation guide:

https://github.com/SainyTK/goog-cli#installation

If OAuth has not been configured, send the user to the `goog-cli` OAuth setup guide:

https://github.com/SainyTK/goog-cli#oauth-setup

For OAuth app setup and login, use the CLI's flow:

```sh
goog auth setup
goog auth login
goog auth list
```

Use `goog auth switch ACCOUNT_EMAIL` to change the active account.
Use `goog --account ACCOUNT_EMAIL ...` for a one-off command with a different account.
Use `goog auth export` only for headless environments that cannot access the OS keychain, and never commit or print the exported token file.

## Operating Rules

- Treat Google Drive, Docs, Sheets, and Gmail data as sensitive.
- Quote only the minimum document, sheet, file, or message content the user needs.
- Never print OAuth client secrets, authorization codes, token exports, keychain contents, or config files.
- Prefer `--json` where available when another command or script needs structured output.
- Use `--quiet` for automation when progress output would make parsing harder.
- Confirm intent before destructive or broad write operations, including overwriting sheet ranges, clearing values, replacing all matching text, structural batch updates, and Drive uploads that could confuse the target folder.
- Gmail support is currently read/search/attachment download oriented.
- Do not claim this skill can draft or send email unless `goog mail --help` shows send commands in the installed CLI.

## Drive

Use Drive commands for discovery, upload, and download.
For search-style filtering, inspect `goog drive list --help`; for folder browsing, prefer `goog drive ls`.

```sh
goog drive ls --limit 20
goog drive ls --folder FOLDER_ID --json
goog drive list --help
goog drive upload ./report.pdf --folder FOLDER_ID
goog drive download FILE_ID --output ./report.pdf
```

When the user provides a Google Docs, Sheets, or Drive URL, most `goog docs` and `goog sheets` commands can accept the URL directly or you can extract the ID from it.
For Drive operations, use the file ID.

## Docs

Prefer high-level Document Map commands for ordinary edits.
They reduce raw UTF-16 index handling and support dry runs for write previews.

```sh
goog docs map DOCUMENT_ID
goog docs search-text DOCUMENT_ID "quarterly plan"
goog docs get-content DOCUMENT_ID --heading "Summary"
goog docs insert-text DOCUMENT_ID "New paragraph text" --after-heading "Summary" --dry-run
goog docs replace-text DOCUMENT_ID "old text" "new text" --match 1 --dry-run
goog docs insert-table DOCUMENT_ID --after-heading "Risks" --data ./table.tsv --dry-run
goog docs insert-image DOCUMENT_ID https://example.com/chart.png --after-text "Chart:" --dry-run
goog docs apply-styles DOCUMENT_ID --text "Decision" --bold --foreground-color '#163872' --dry-run
goog docs apply-list DOCUMENT_ID --entry 12 --type bullet --dry-run
goog docs show-style-template DOCUMENT_ID
```

After the dry run looks right, repeat the command without `--dry-run`.
For collaborative or high-risk edits, fetch the document first and use the current revision guard if the command supports it:

```sh
goog docs get DOCUMENT_ID --fields 'revisionId,title'
goog docs insert-text DOCUMENT_ID "Approved" --after-heading "Status" --required-revision-id REVISION_ID
```

Use raw reads when you need the Google Docs API `Document` JSON:

```sh
goog docs get DOCUMENT_ID
goog docs get DOCUMENT_ID --include-tabs-content
goog docs get DOCUMENT_ID --fields 'title,body(content(paragraph(elements(textRun(content)))))'
```

Use raw batch updates only when the high-level command cannot express the edit:

```sh
goog docs batch-update DOCUMENT_ID --requests - <<'JSON'
{
  "requests": [
    {
      "insertText": {
        "location": { "index": 1 },
        "text": "Hello from goog\n"
      }
    }
  ]
}
JSON
```

`goog docs batch-update --requests` expects the full `documents.batchUpdate` JSON body, not just the `requests` array.
Locations and ranges use Google Docs UTF-16 indexes from `goog docs get`.

### Docs Style Templates

`goog 0.2.1` can use a locally cached style template for a document.
Use it before styling-heavy edits to inspect what the CLI will apply:

```sh
goog docs show-style-template DOCUMENT_ID
goog docs show-style-template DOCUMENT_ID --json
```

The style template currently affects high-level table insertion, text styling, and list styling commands.
These commands expose `--no-auto-style` when you need to ignore the cached template:

```sh
goog docs insert-table DOCUMENT_ID --after-heading "Risks" --data ./table.tsv --no-auto-style --dry-run
goog docs apply-styles DOCUMENT_ID --text "Decision" --bold --no-auto-style --dry-run
goog docs apply-list DOCUMENT_ID --entry 12 --type numbered --no-auto-style --dry-run
```

Prefer the cached style template when editing a document that already has an established visual system.
Use `--no-auto-style` only when the user asks for a deliberately different style or the template would make a local edit inconsistent.

## Docs Quality Rules

Plan structure before writing substantial content.
Use headings, tables, bullet lists, and numbered lists where they make the document easier to scan.
Avoid producing documents that are only undifferentiated paragraphs.

For existing Docs, inspect the current structure and style before editing:

```sh
goog docs map DOCUMENT_ID
goog docs get DOCUMENT_ID --fields 'title,revisionId,body(content(paragraph(paragraphStyle,elements(textRun(content,textStyle))),table))'
```

If the document already has a custom visual style, mirror it.
Do not overwrite a user's established formatting with a generic palette.

When inserting images, remember that Google Docs `insertInlineImage` requires a publicly reachable image URI.
If the image is local, upload or host it first, then insert the resulting public URI.

For tables, prefer `goog docs list-tables` to identify table handles and `goog docs edit-table --table-id TABLE_ID --data ./table.tsv --dry-run` to replace cell text from CSV or TSV data.
Use `--resize` only after checking current CLI help and confirming the user wants structural table changes.

When using raw batch updates:

- Multi-paragraph content must be inserted as separate paragraphs when later paragraph styling matters.
- Image and table indexes are UTF-16 indexes from the Docs API response, not byte offsets.
- Re-fetch the document after structural edits before computing additional indexes.
- Include `writeControl.requiredRevisionId` for high-risk raw edits when concurrent edits are possible.

## Sheets

Use `goog sheets get` for spreadsheet metadata and `goog sheets values` for cell values.
Use native Google Sheets IDs, not Office `.xlsx` files stored in Drive.
The Google Sheets API cannot write to Excel-format files in Drive.

```sh
goog sheets get SPREADSHEET_ID --fields 'properties.title,sheets.properties'
goog sheets values get SPREADSHEET_ID 'Sheet1!A1:D20'
goog sheets values get SPREADSHEET_ID 'Sheet1!A1:D20' --value-render-option formula
goog sheets values clear SPREADSHEET_ID 'Sheet1!A2:D100'
```

Value writes use a full Google `ValueRange` body from a file or stdin:

```sh
goog sheets values update SPREADSHEET_ID 'Sheet1!A1' --values - <<'JSON'
{
  "range": "Sheet1!A1",
  "majorDimension": "ROWS",
  "values": [
    ["Name", "Total"],
    ["Alice", 42]
  ]
}
JSON
```

Append rows the same way:

```sh
goog sheets values append SPREADSHEET_ID 'Sheet1!A:B' --values - <<'JSON'
{
  "range": "Sheet1!A:B",
  "majorDimension": "ROWS",
  "values": [
    ["Bob", 7]
  ]
}
JSON
```

For multiple ranges, use the nested values commands:

```sh
goog sheets values batch-get --help
goog sheets values batch-update --help
goog sheets values batch-clear --help
```

Use structural batch updates for formatting, adding tabs, freezing rows, resizing columns, filters, merges, and protected ranges:

```sh
goog sheets batch-update SPREADSHEET_ID --requests - <<'JSON'
{
  "requests": [
    {
      "repeatCell": {
        "range": {
          "sheetId": 0,
          "startRowIndex": 0,
          "endRowIndex": 1
        },
        "cell": {
          "userEnteredFormat": {
            "textFormat": { "bold": true },
            "backgroundColor": { "red": 0.09, "green": 0.22, "blue": 0.45 }
          }
        },
        "fields": "userEnteredFormat(textFormat,backgroundColor)"
      }
    }
  ],
  "includeSpreadsheetInResponse": false
}
JSON
```

`goog sheets batch-update --requests` expects the full `spreadsheets.batchUpdate` JSON body, not just the `requests` array.

## Sheets Quality Rules

For new or heavily edited Sheets, leave the result readable and production-quality.
Use clear tab names, frozen header rows, appropriate column widths, header styling, filters where useful, and formulas only where they improve maintainability.

Before writing to an existing Sheet:

```sh
goog sheets get SPREADSHEET_ID --fields 'properties.title,sheets.properties(sheetId,title,gridProperties)'
goog sheets values get SPREADSHEET_ID 'Tab Name!A1:Z20'
```

If the spreadsheet already has a custom style, mirror it.
Do not override established colors, fonts, protected ranges, or formulas unless the user asked for that change.

When writing values:

- Prepare JSON in a temp file or stdin instead of shell-escaping large arrays.
- Use `--value-input-option raw` when literal values matter.
- Keep the default `user-entered` behavior when formulas, numbers, and dates should be interpreted by Sheets.
- Re-read the affected range after mutation to verify the live result.

## GoogleMail

Use `goog mail` for mailbox reads, search, raw message inspection, and attachment downloads.

```sh
goog mail list --limit 10
goog mail list --limit 10 --json
goog mail search 'from:alerts@example.com newer_than:7d has:attachment'
goog mail read MESSAGE_ID
goog mail read MESSAGE_ID --json
goog mail attachment download MESSAGE_ID ATTACHMENT_ID --output invoice.pdf
```

Common Gmail search operators include `from:`, `to:`, `subject:`, `in:inbox`, `in:sent`, `has:attachment`, `newer_than:7d`, `is:unread`, and `label:`.
Message bodies can contain sensitive personal data, so quote only what the user needs.

## Verification

After any write, verify against the live target rather than assuming success:

```sh
goog docs map DOCUMENT_ID
goog docs get-content DOCUMENT_ID --heading "Changed Heading"
goog sheets values get SPREADSHEET_ID 'Sheet1!A1:D20'
goog drive ls --folder FOLDER_ID --json
```

For command details, trust the installed CLI help first:

```sh
goog help
goog docs COMMAND --help
goog sheets values COMMAND --help
```

If installed help conflicts with this skill, follow installed help and update this skill later.
