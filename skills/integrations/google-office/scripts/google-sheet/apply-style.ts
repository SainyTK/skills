#!/usr/bin/env bun
// Apply formal styling (Poppins + Inter, colours, banding, borders, freeze) to any Google Sheet.
//
// Usage:
//   bun apply-style.ts --id SPREADSHEET_ID
//   bun apply-style.ts --id SPREADSHEET_ID --sheet "Sheet1"
//   bun apply-style.ts --id SPREADSHEET_ID --no-title-row
//   bun apply-style.ts --id SPREADSHEET_ID --email you@example.com
//
// Flags:
//   --sheet NAME        Target a specific sheet tab (default: first tab)
//   --no-title-row      Data starts with column headers at row 0 (no merged title row)
//   --email EMAIL       Use a specific Google account
//
// Style tokens live in style.config.ts — edit that file to change fonts,
// colours, or sizing globally across all sheet scripts.

import { parseArgs, print, resolveEmail } from '../scripts/lib';
import { applyFormalStyle } from './sheet-utils';

const args          = parseArgs(process.argv.slice(2));
const spreadsheetId = typeof args.id === 'string' ? args.id : null;

if (!spreadsheetId) {
  console.error('Missing --id SPREADSHEET_ID');
  console.error('Usage: bun apply-style.ts --id SPREADSHEET_ID [--sheet NAME] [--no-title-row] [--email EMAIL]');
  process.exit(1);
}

const email       = await resolveEmail(typeof args.email === 'string' ? args.email : undefined);
const sheetName   = typeof args.sheet === 'string' ? args.sheet : undefined;
const hasTitleRow = args['no-title-row'] !== true;

const result = await applyFormalStyle(email, spreadsheetId, { sheetName, hasTitleRow });
print({ success: true, spreadsheetId, email, sheetName, hasTitleRow, ...result });
