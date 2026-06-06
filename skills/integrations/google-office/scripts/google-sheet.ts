#!/usr/bin/env bun
import { api, die, handleAuthCmd, parseArgs, parseJsonArg, parseValues, print, resolveEmail } from './lib';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function sheetsGet(email: string, id: string) {
  const data = await api(`${SHEETS}/${encodeURIComponent(id)}`, email, { query: { fields: 'spreadsheetId,properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))' } });
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title,
    sheets: (data.sheets || []).map((s: any) => ({ sheetId: s.properties?.sheetId, title: s.properties?.title, index: s.properties?.index, rows: s.properties?.gridProperties?.rowCount, cols: s.properties?.gridProperties?.columnCount })),
  };
}

export async function sheetsRead(email: string, id: string, range: string) {
  const data = await api(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`, email, { query: { majorDimension: 'ROWS' } });
  return { range: data.range, values: data.values || [] };
}

export async function sheetsWrite(email: string, id: string, range: string, values: unknown[][], raw: boolean) {
  const data = await api(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`, email, {
    method: 'PUT',
    query: { valueInputOption: raw ? 'RAW' : 'USER_ENTERED' },
    body: { range, majorDimension: 'ROWS', values },
  });
  return { updatedRange: data.updatedRange, updatedRows: data.updatedRows, updatedColumns: data.updatedColumns, updatedCells: data.updatedCells };
}

export async function sheetsAppend(email: string, id: string, range: string, values: unknown[][], raw: boolean) {
  const data = await api(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append`, email, {
    method: 'POST',
    query: { valueInputOption: raw ? 'RAW' : 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
    body: { range, majorDimension: 'ROWS', values },
  });
  return { updatedRange: data.updates?.updatedRange, updatedRows: data.updates?.updatedRows, updatedCells: data.updates?.updatedCells };
}

export async function sheetsCreate(email: string, title: string) {
  const data = await api(SHEETS, email, { method: 'POST', body: { properties: { title } } });
  return { spreadsheetId: data.spreadsheetId, title: data.properties?.title, url: data.spreadsheetUrl };
}

export async function sheetsFormat(email: string, id: string, requests: unknown[]) {
  const data = await api(`${SHEETS}/${encodeURIComponent(id)}:batchUpdate`, email, {
    method: 'POST',
    body: { requests },
  });
  return { spreadsheetId: data.spreadsheetId, repliesCount: (data.replies || []).length };
}

export async function handleSheetCmd(cmd: string, args: Record<string, string | boolean>, email: string): Promise<boolean> {
  if (cmd === 'sheets-get') { if (!args.id) die('Missing --id'); print({ email, ...(await sheetsGet(email, String(args.id))) }); return true; }
  if (cmd === 'sheets-read') { if (!args.id || !args.range) die('Missing --id or --range'); print({ email, spreadsheetId: String(args.id), ...(await sheetsRead(email, String(args.id), String(args.range))) }); return true; }
  if (cmd === 'sheets-write') { if (!args.id || !args.range || typeof args.values !== 'string') die('Missing --id, --range, or --values'); print({ email, ...(await sheetsWrite(email, String(args.id), String(args.range), await parseValues(args.values), Boolean(args.raw))) }); return true; }
  if (cmd === 'sheets-append') { if (!args.id || !args.range || typeof args.values !== 'string') die('Missing --id, --range, or --values'); print({ email, ...(await sheetsAppend(email, String(args.id), String(args.range), await parseValues(args.values), Boolean(args.raw))) }); return true; }
  if (cmd === 'sheets-create') { if (!args.title) die('Missing --title'); print({ email, ...(await sheetsCreate(email, String(args.title))) }); return true; }
  if (cmd === 'sheets-format') {
    if (!args.id || typeof args.requests !== 'string') die('Missing --id or --requests');
    const parsed = await parseJsonArg(String(args.requests));
    if (!Array.isArray(parsed)) die('--requests must be a JSON array of Sheets API batchUpdate requests');
    print({ email, ...(await sheetsFormat(email, String(args.id), parsed)) });
    return true;
  }
  return false;
}

// ---------- standalone entry ----------

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const email = typeof args.email === 'string' ? args.email : undefined;

  if (cmd === 'help') {
    console.log(`Usage: bun google-sheet.ts <command> [options]

Auth:    status | login | accounts | default-account --email E | logout [--email E]
Sheets:  sheets-get --id ID
         sheets-read --id ID --range A1
         sheets-write --id ID --range A1 --values JSON-or-path [--raw]
         sheets-append --id ID --range A1 --values JSON-or-path [--raw]
         sheets-create --title TITLE
         sheets-format --id ID --requests JSON-or-path

--values accepts an inline JSON 2D array or a path to a .json file.
Values are parsed as formulas/numbers/dates by default (USER_ENTERED). Pass --raw to store literally.
`);
    return;
  }

  if (await handleAuthCmd(cmd, args)) return;

  const resolved = await resolveEmail(email);
  if (await handleSheetCmd(cmd, args, resolved)) return;

  die(`Unknown command: ${cmd}`);
}

if (import.meta.main) {
  main().catch((err) => die(err.stack || err.message || String(err)));
}
