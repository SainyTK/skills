#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { api, die, handleAuthCmd, parseArgs, print, resolveEmail, safeFileName, skillDir } from './lib';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,owners(emailAddress),parents,webViewLink,trashed';

const EXPORT_DEFAULTS: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'text/plain', ext: 'txt' },
  'application/vnd.google-apps.spreadsheet': { mime: 'text/csv', ext: 'csv' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: 'png' },
};

export async function driveList(email: string, query: string | undefined, limit: number) {
  const data = await api(`${DRIVE}/files`, email, {
    query: {
      q: query || undefined,
      pageSize: Math.min(limit, 100),
      fields: `files(${DRIVE_FILE_FIELDS}),nextPageToken`,
      orderBy: 'modifiedTime desc',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  });
  return { count: (data.files || []).length, files: data.files || [], nextPageToken: data.nextPageToken };
}

export async function driveGet(email: string, id: string) {
  return api(`${DRIVE}/files/${encodeURIComponent(id)}`, email, { query: { fields: DRIVE_FILE_FIELDS, supportsAllDrives: true } });
}

export async function driveDownload(email: string, id: string, outArg: string | undefined, exportMimeArg: string | undefined) {
  const meta = await driveGet(email, id);
  const isGoogleDoc = String(meta.mimeType || '').startsWith('application/vnd.google-apps');
  let response: Response;
  let ext = '';
  if (isGoogleDoc) {
    const fallback = EXPORT_DEFAULTS[meta.mimeType] || { mime: 'application/pdf', ext: 'pdf' };
    const exportMime = exportMimeArg || fallback.mime;
    ext = fallback.ext;
    response = await api(`${DRIVE}/files/${encodeURIComponent(id)}/export`, email, { query: { mimeType: exportMime }, raw: true }) as Response;
  } else {
    response = await api(`${DRIVE}/files/${encodeURIComponent(id)}`, email, { query: { alt: 'media', supportsAllDrives: true }, raw: true }) as Response;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const defaultName = safeFileName(meta.name || 'google-file') + (isGoogleDoc && !String(meta.name || '').includes('.') ? `.${ext}` : '');
  const outPath = resolvePath(String(outArg || join(skillDir, '.data', 'downloads', defaultName)));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  return { id, name: meta.name, mimeType: meta.mimeType, path: outPath, bytes: bytes.length };
}

export async function driveCreateFolder(email: string, name: string, parent?: string) {
  return api(`${DRIVE}/files`, email, {
    method: 'POST',
    query: { fields: DRIVE_FILE_FIELDS, supportsAllDrives: true },
    body: { name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) },
  });
}

export async function driveUpload(email: string, filePath: string, nameArg: string | undefined, parent: string | undefined, mimeArg: string | undefined) {
  if (!existsSync(filePath)) die(`File not found: ${filePath}`);
  const bytes = await readFile(filePath);
  const name = nameArg || basename(filePath);
  const mime = mimeArg || 'application/octet-stream';
  const metadata = { name, ...(parent ? { parents: [parent] } : {}) };
  const boundary = `sainyos${crypto.randomBytes(8).toString('hex')}`;
  const pre = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([pre, bytes, post]);
  return api(`https://www.googleapis.com/upload/drive/v3/files`, email, {
    method: 'POST',
    query: { uploadType: 'multipart', fields: DRIVE_FILE_FIELDS, supportsAllDrives: true },
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function driveDelete(email: string, id: string, hard: boolean) {
  if (hard) {
    await api(`${DRIVE}/files/${encodeURIComponent(id)}`, email, { method: 'DELETE', query: { supportsAllDrives: true }, raw: true });
    return { id, deleted: true, trashed: false };
  }
  const data = await api(`${DRIVE}/files/${encodeURIComponent(id)}`, email, { method: 'PATCH', query: { fields: 'id,name,trashed', supportsAllDrives: true }, body: { trashed: true } });
  return { id: data.id, name: data.name, trashed: data.trashed };
}

export async function handleDriveCmd(cmd: string, args: Record<string, string | boolean>, email: string): Promise<boolean> {
  if (cmd === 'drive-list') { print({ email, ...(await driveList(email, typeof args.query === 'string' ? args.query : undefined, Number(args.limit || 25))) }); return true; }
  if (cmd === 'drive-get') { if (!args.id) die('Missing --id'); print({ email, file: await driveGet(email, String(args.id)) }); return true; }
  if (cmd === 'drive-download') { if (!args.id) die('Missing --id'); print({ email, ...(await driveDownload(email, String(args.id), typeof args.output === 'string' ? args.output : (typeof args.out === 'string' ? args.out : undefined), typeof args['export-mime'] === 'string' ? args['export-mime'] : undefined)) }); return true; }
  if (cmd === 'drive-create-folder') { if (!args.name) die('Missing --name'); print({ email, folder: await driveCreateFolder(email, String(args.name), typeof args.parent === 'string' ? args.parent : undefined) }); return true; }
  if (cmd === 'drive-upload') { if (!args.file) die('Missing --file'); print({ email, file: await driveUpload(email, String(args.file), typeof args.name === 'string' ? args.name : undefined, typeof args.parent === 'string' ? args.parent : undefined, typeof args.mime === 'string' ? args.mime : undefined) }); return true; }
  if (cmd === 'drive-delete') { if (!args.id) die('Missing --id'); print({ email, ...(await driveDelete(email, String(args.id), Boolean(args.hard))) }); return true; }
  return false;
}

// ---------- standalone entry ----------

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const email = typeof args.email === 'string' ? args.email : undefined;

  if (cmd === 'help') {
    console.log(`Usage: bun google-drive.ts <command> [options]

Auth:    status | login | accounts | default-account --email E | logout [--email E]
Drive:   drive-list [--query Q] [--limit N]
         drive-get --id ID
         drive-download --id ID [--output PATH] [--export-mime MIME]
         drive-create-folder --name NAME [--parent ID]
         drive-upload --file PATH [--name NAME] [--parent ID] [--mime MIME]
         drive-delete --id ID [--hard]
`);
    return;
  }

  if (await handleAuthCmd(cmd, args)) return;

  const resolved = await resolveEmail(email);
  if (await handleDriveCmd(cmd, args, resolved)) return;

  die(`Unknown command: ${cmd}`);
}

if (import.meta.main) {
  main().catch((err) => die(err.stack || err.message || String(err)));
}
