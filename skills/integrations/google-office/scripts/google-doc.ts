#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import crypto from 'node:crypto';
import { api, die, handleAuthCmd, parseArgs, parseValues, print, resolveEmail } from './lib';

const DOCS = 'https://docs.googleapis.com/v1/documents';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

function extractDocText(doc: any): string {
  const out: string[] = [];
  const walk = (elements: any[] = []) => {
    for (const el of elements) {
      if (el.paragraph) {
        for (const pe of el.paragraph.elements || []) if (pe.textRun?.content) out.push(pe.textRun.content);
      } else if (el.table) {
        for (const row of el.table.tableRows || []) for (const cell of row.tableCells || []) walk(cell.content || []);
      } else if (el.tableOfContents) {
        walk(el.tableOfContents.content || []);
      }
    }
  };
  walk(doc.body?.content || []);
  return out.join('');
}

// Returns true if the line looks like a section heading:
// all-uppercase, at least 4 capital letters, at most 100 chars, no stray lowercase.
function isHeadingLike(raw: string): boolean {
  const t = raw.trim().replace(/\n$/, '');
  if (t.length < 3 || t.length > 100) return false;
  if (t !== t.toUpperCase()) return false;
  return (t.match(/[A-Z]/g) || []).length >= 4;
}

// Resolve end-of-doc insertion index (position just before the final structural \n).
async function resolveEndIndex(email: string, docId: string): Promise<number> {
  const doc = await api(`${DOCS}/${encodeURIComponent(docId)}`, email);
  const content: any[] = doc.body?.content || [];
  const last = content[content.length - 1];
  return Math.max(last?.endIndex ? last.endIndex - 1 : 1, 1);
}

// Find the last table element in a doc's content and return [row][col] → paragraph startIndex.
function lastTableCellIndices(content: any[]): number[][] {
  let lastTable: any = null;
  for (const el of content) if (el.table) lastTable = el;
  if (!lastTable) return [];
  return (lastTable.table.tableRows || []).map((row: any) =>
    (row.tableCells || []).map((cell: any) => {
      const first = (cell.content || [])[0];
      return typeof first?.startIndex === 'number' ? first.startIndex : null;
    })
  );
}

// ---- Exported functions ----

// Apply heading styles to an existing doc based on ALL_CAPS line detection.
// First qualifying heading → TITLE; subsequent ones → HEADING_2.
export async function docsFormat(email: string, docId: string) {
  const doc = await api(`${DOCS}/${encodeURIComponent(docId)}`, email);
  const content: any[] = doc.body?.content || [];
  const requests: any[] = [];
  let titleAssigned = false;

  for (const el of content) {
    if (!el.paragraph) continue;
    const text: string = (el.paragraph.elements || []).map((e: any) => e.textRun?.content || '').join('');
    if (!text.trim()) continue;

    if (isHeadingLike(text)) {
      const namedStyleType = titleAssigned ? 'HEADING_2' : 'TITLE';
      titleAssigned = true;
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: el.startIndex, endIndex: el.endIndex },
          paragraphStyle: { namedStyleType },
          fields: 'namedStyleType',
        },
      });
    }
  }

  if (requests.length > 0) {
    await api(`${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, email, {
      method: 'POST',
      body: { requests },
    });
  }

  return { documentId: docId, stylesApplied: requests.length };
}

export async function docsGet(email: string, id: string) {
  const doc = await api(`${DOCS}/${encodeURIComponent(id)}`, email);
  return { documentId: doc.documentId, title: doc.title, text: extractDocText(doc) };
}

export async function docsCreate(email: string, title: string, text?: string) {
  const doc = await api(DOCS, email, { method: 'POST', body: { title } });
  if (text) {
    await docsAppend(email, doc.documentId, text);
    await docsFormat(email, doc.documentId);
  }
  return { documentId: doc.documentId, title: doc.title, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
}

export async function docsAppend(email: string, id: string, text: string) {
  const idx = await resolveEndIndex(email, id);
  await api(`${DOCS}/${encodeURIComponent(id)}:batchUpdate`, email, {
    method: 'POST',
    body: { requests: [{ insertText: { location: { index: idx }, text } }] },
  });
  return { documentId: id, insertedAt: idx, insertedChars: text.length };
}

// Insert a table populated with `values` (2-D string array).
// Inserts at end of doc by default; pass `insertIndex` to override.
export async function docsInsertTable(
  email: string,
  docId: string,
  values: string[][],
  insertIndex?: number,
) {
  const rows = values.length;
  if (rows === 0) die('--values must have at least one row');
  const cols = Math.max(...values.map(r => r.length));
  if (cols === 0) die('--values rows must have at least one column');

  const idx = insertIndex !== undefined ? Math.max(insertIndex, 1) : await resolveEndIndex(email, docId);

  // Step 1: insert empty table
  await api(`${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, email, {
    method: 'POST',
    body: { requests: [{ insertTable: { rows, columns: cols, location: { index: idx } } }] },
  });

  // Step 2: read doc back to discover cell positions
  const updated = await api(`${DOCS}/${encodeURIComponent(docId)}`, email);
  const cellIndices = lastTableCellIndices(updated.body?.content || []);

  // Step 3: fill cells — reverse order so earlier indices stay valid
  const textRequests: any[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const text = values[r]?.[c] ?? '';
      const cellIdx = cellIndices[r]?.[c];
      if (text && typeof cellIdx === 'number') {
        textRequests.push({ insertText: { location: { index: cellIdx }, text } });
      }
    }
  }

  if (textRequests.length > 0) {
    await api(`${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, email, {
      method: 'POST',
      body: { requests: textRequests },
    });
  }

  return { documentId: docId, rows, cols };
}

// Insert an inline image from a publicly accessible URL.
// Width/height are in points (1 pt = 1/72 inch). Omit to keep the image's native size.
export async function docsInsertImage(
  email: string,
  docId: string,
  uri: string,
  opts: { width?: number; height?: number; index?: number } = {},
) {
  const idx = opts.index !== undefined ? Math.max(opts.index, 1) : await resolveEndIndex(email, docId);

  const req: any = { insertInlineImage: { uri, location: { index: idx } } };
  if (opts.width || opts.height) {
    req.insertInlineImage.objectSize = {
      ...(opts.width ? { width: { magnitude: opts.width, unit: 'PT' } } : {}),
      ...(opts.height ? { height: { magnitude: opts.height, unit: 'PT' } } : {}),
    };
  }

  await api(`${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, email, {
    method: 'POST',
    body: { requests: [req] },
  });

  return { documentId: docId, insertedAt: idx };
}

// Upload a local image file to Drive (making it publicly readable), then embed it in the doc.
// The Drive file remains publicly readable after insertion — delete it or revoke permissions
// via Drive UI or `drive-delete --id DRIVE_FILE_ID` when no longer needed.
export async function docsInsertImageFromFile(
  email: string,
  docId: string,
  filePath: string,
  opts: { width?: number; height?: number; index?: number } = {},
) {
  if (!existsSync(filePath)) die(`File not found: ${filePath}`);

  const extMatch = filePath.match(/\.([^.]+)$/);
  const ext = (extMatch?.[1] || 'png').toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
  };
  const mime = mimeMap[ext] || 'image/png';

  // Upload to Drive (multipart)
  const bytes = await readFile(filePath);
  const name = basename(filePath);
  const boundary = `sainyos${crypto.randomBytes(8).toString('hex')}`;
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const post = Buffer.from(`\r\n--${boundary}--`);
  const driveFile = await api(DRIVE_UPLOAD, email, {
    method: 'POST',
    query: { uploadType: 'multipart', fields: 'id,name' },
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([pre, bytes, post]),
  });

  // Grant public read — required by Docs API insertInlineImage (URI must be publicly accessible)
  await api(`${DRIVE_FILES}/${driveFile.id}/permissions`, email, {
    method: 'POST',
    body: { type: 'anyone', role: 'reader' },
  });

  const publicUrl = `https://drive.google.com/uc?export=view&id=${driveFile.id}`;
  const result = await docsInsertImage(email, docId, publicUrl, opts);

  return {
    ...result,
    driveFileId: driveFile.id,
    driveFileName: name,
    note: 'Drive file is publicly readable for embedding. Remove public access via drive-delete or Drive UI when done.',
  };
}

export async function handleDocCmd(cmd: string, args: Record<string, string | boolean>, email: string): Promise<boolean> {
  if (cmd === 'docs-get') {
    if (!args.id) die('Missing --id');
    print({ email, ...(await docsGet(email, String(args.id))) });
    return true;
  }
  if (cmd === 'docs-create') {
    if (!args.title) die('Missing --title');
    print({ email, ...(await docsCreate(email, String(args.title), typeof args.text === 'string' ? args.text : undefined)) });
    return true;
  }
  if (cmd === 'docs-append') {
    if (!args.id || typeof args.text !== 'string') die('Missing --id or --text');
    print({ email, ...(await docsAppend(email, String(args.id), args.text)) });
    return true;
  }
  if (cmd === 'docs-format') {
    if (!args.id) die('Missing --id');
    print({ email, ...(await docsFormat(email, String(args.id))) });
    return true;
  }
  if (cmd === 'docs-insert-table') {
    if (!args.id) die('Missing --id');
    if (!args.values) die('Missing --values (2-D JSON array)');
    const values = await parseValues(String(args.values)) as string[][];
    const index = args.index !== undefined ? Number(args.index) : undefined;
    print({ email, ...(await docsInsertTable(email, String(args.id), values, index)) });
    return true;
  }
  if (cmd === 'docs-insert-image') {
    if (!args.id) die('Missing --id');
    const opts = {
      width: args.width ? Number(args.width) : undefined,
      height: args.height ? Number(args.height) : undefined,
      index: args.index !== undefined ? Number(args.index) : undefined,
    };
    if (args.file) {
      print({ email, ...(await docsInsertImageFromFile(email, String(args.id), String(args.file), opts)) });
    } else if (args.url) {
      print({ email, ...(await docsInsertImage(email, String(args.id), String(args.url), opts)) });
    } else {
      die('Missing --url URL or --file PATH');
    }
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
    console.log(`Usage: bun google-doc.ts <command> [options]

Auth:    status | login | accounts | default-account --email E | logout [--email E]
Docs:    docs-get --id ID
         docs-create --title TITLE [--text TEXT]
         docs-append --id ID --text TEXT
         docs-format --id ID
         docs-insert-table --id ID --values JSON-or-path [--index N]
         docs-insert-image --id ID --url URL [--width PT] [--height PT] [--index N]
         docs-insert-image --id ID --file PATH [--width PT] [--height PT] [--index N]

--id is the document ID from its URL.
--values is a 2-D JSON array e.g. '[["Name","Score"],["Alice",95]]' or a path to such a file.
--width / --height are in points (72 pt = 1 inch). Omit to use the image's native size.
--index overrides the insertion point; defaults to end of document.
--file uploads the local image to Drive (makes it publicly readable) then embeds it.
`);
    return;
  }

  if (await handleAuthCmd(cmd, args)) return;

  const resolved = await resolveEmail(email);
  if (await handleDocCmd(cmd, args, resolved)) return;

  die(`Unknown command: ${cmd}`);
}

if (import.meta.main) {
  main().catch((err) => die(err.stack || err.message || String(err)));
}
