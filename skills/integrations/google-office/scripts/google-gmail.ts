#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { api, die, handleAuthCmd, parseArgs, print, resolveEmail, safeFileName, skillDir } from './lib';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
  raw?: string;
};

function header(part: GmailPart | undefined, name: string) {
  return part?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64Url(data = '') {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function toBase64Url(str: string) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function collectParts(part: GmailPart | undefined, out: GmailPart[] = []): GmailPart[] {
  if (!part) return out;
  out.push(part);
  for (const child of part.parts || []) collectParts(child, out);
  return out;
}

function extractBodies(message: GmailMessage) {
  const parts = collectParts(message.payload);
  const text = parts.find(p => p.mimeType === 'text/plain' && p.body?.data)?.body?.data;
  const html = parts.find(p => p.mimeType === 'text/html' && p.body?.data)?.body?.data;
  return {
    text: text ? decodeBase64Url(text) : '',
    html: html ? decodeBase64Url(html) : '',
  };
}

function summarizeMessage(message: GmailMessage) {
  return {
    id: message.id,
    threadId: message.threadId,
    date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : header(message.payload, 'Date'),
    from: header(message.payload, 'From'),
    to: header(message.payload, 'To'),
    cc: header(message.payload, 'Cc'),
    subject: header(message.payload, 'Subject'),
    snippet: message.snippet,
    labels: message.labelIds,
  };
}

function attachmentList(message: GmailMessage) {
  return collectParts(message.payload)
    .filter(p => p.filename && p.body?.attachmentId)
    .map(p => ({ filename: p.filename, mimeType: p.mimeType, size: p.body?.size, attachmentId: p.body?.attachmentId }));
}

function buildRfc2822(fields: { from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; inReplyTo?: string; references?: string }) {
  const lines: string[] = [];
  lines.push(`From: ${fields.from}`);
  lines.push(`To: ${fields.to.join(', ')}`);
  if (fields.cc?.length) lines.push(`Cc: ${fields.cc.join(', ')}`);
  if (fields.bcc?.length) lines.push(`Bcc: ${fields.bcc.join(', ')}`);
  lines.push(`Subject: ${fields.subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 8bit');
  if (fields.inReplyTo) lines.push(`In-Reply-To: ${fields.inReplyTo}`);
  if (fields.references) lines.push(`References: ${fields.references}`);
  lines.push('');
  lines.push(fields.body);
  return lines.join('\r\n');
}

async function getMessage(email: string, id: string, format = 'metadata'): Promise<GmailMessage> {
  return api(`${GMAIL}/messages/${encodeURIComponent(id)}`, email, { query: { format } }) as Promise<GmailMessage>;
}

export async function gmailSearch(email: string, query: string, limit: number) {
  const data = await api(`${GMAIL}/messages`, email, { query: { q: query, maxResults: Math.min(limit, 100) } });
  const ids = ((data.messages || []) as { id: string }[]).map(m => m.id);
  const messages = [];
  for (const id of ids) messages.push(summarizeMessage(await getMessage(email, id, 'metadata')));
  return { query, count: messages.length, messages };
}

export async function gmailRead(email: string, id: string, format: string) {
  const message = await getMessage(email, id, format);
  return {
    message: summarizeMessage(message),
    bodies: format === 'full' ? extractBodies(message) : undefined,
    attachments: format === 'full' ? attachmentList(message) : undefined,
    raw: format === 'raw' ? message.raw : undefined,
  };
}

export async function gmailDownloadAttachment(email: string, messageId: string, attachmentId: string, filename: string, outArg?: string) {
  const data = await api(`${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, email);
  const bytes = Buffer.from(String(data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const safeName = safeFileName(filename || 'gmail-attachment.bin');
  const outPath = resolvePath(outArg || join(skillDir, '.data', 'downloads', safeName));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  return { path: outPath, bytes: bytes.length };
}

export async function gmailCreateDraft(email: string, opts: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; replyToId?: string }) {
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let threadId: string | undefined;

  if (opts.replyToId) {
    const orig = await getMessage(email, opts.replyToId, 'metadata');
    threadId = orig.threadId;
    const msgIdHeader = orig.payload?.headers?.find(h => h.name.toLowerCase() === 'message-id')?.value;
    const refsHeader = orig.payload?.headers?.find(h => h.name.toLowerCase() === 'references')?.value;
    if (msgIdHeader) {
      inReplyTo = msgIdHeader;
      references = [refsHeader, msgIdHeader].filter(Boolean).join(' ').trim();
    }
  }

  const raw = buildRfc2822({ from: email, to: opts.to, cc: opts.cc, bcc: opts.bcc, subject: opts.subject, body: opts.body, inReplyTo, references });
  const draft = await api(`${GMAIL}/drafts`, email, {
    method: 'POST',
    body: { message: { raw: toBase64Url(raw), ...(threadId ? { threadId } : {}) } },
  });
  return { draftId: draft.id, threadId: draft.message?.threadId };
}

export async function gmailSendDraft(email: string, draftId: string) {
  const result = await api(`${GMAIL}/drafts/send`, email, {
    method: 'POST',
    body: { id: draftId },
  });
  return { messageId: result.id, threadId: result.threadId, labelIds: result.labelIds };
}

export async function gmailSend(email: string, opts: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string }) {
  const raw = buildRfc2822({ from: email, to: opts.to, cc: opts.cc, bcc: opts.bcc, subject: opts.subject, body: opts.body });
  const result = await api(`${GMAIL}/messages/send`, email, {
    method: 'POST',
    body: { raw: toBase64Url(raw) },
  });
  return { messageId: result.id, threadId: result.threadId, labelIds: result.labelIds };
}

export async function gmailReply(email: string, replyToId: string, opts: { body: string; cc?: string[]; bcc?: string[] }) {
  const orig = await getMessage(email, replyToId, 'metadata');
  const threadId = orig.threadId;
  const origSubject = header(orig.payload, 'Subject');
  const origFrom = header(orig.payload, 'From');
  const msgIdHeader = orig.payload?.headers?.find(h => h.name.toLowerCase() === 'message-id')?.value;
  const refsHeader = orig.payload?.headers?.find(h => h.name.toLowerCase() === 'references')?.value;
  const inReplyTo = msgIdHeader;
  const references = [refsHeader, msgIdHeader].filter(Boolean).join(' ').trim();
  const subject = origSubject.startsWith('Re:') ? origSubject : `Re: ${origSubject}`;
  const raw = buildRfc2822({ from: email, to: [origFrom], cc: opts.cc, bcc: opts.bcc, subject, body: opts.body, inReplyTo, references });
  const result = await api(`${GMAIL}/messages/send`, email, {
    method: 'POST',
    body: { raw: toBase64Url(raw), threadId },
  });
  return { messageId: result.id, threadId: result.threadId, labelIds: result.labelIds };
}

export async function handleGmailCmd(cmd: string, args: Record<string, string | boolean>, email: string): Promise<boolean> {
  if (cmd === 'gmail-search' || cmd === 'gmail-inbox') {
    const query = cmd === 'gmail-inbox' ? String(args.query || 'in:inbox') : String(args.query || '');
    if (!query) die('Missing --query');
    print({ email, ...(await gmailSearch(email, query, Number(args.limit || 20))) });
    return true;
  }
  if (cmd === 'gmail-read') {
    if (!args.id) die('Missing --id');
    print({ email, ...(await gmailRead(email, String(args.id), String(args.format || 'full'))) });
    return true;
  }
  if (cmd === 'gmail-download-attachment') {
    const messageId = String(args['message-id'] || args.messageId || '');
    const attachmentId = String(args['attachment-id'] || args.attachmentId || '');
    const filename = String(args.filename || 'gmail-attachment.bin');
    if (!messageId || !attachmentId) die('Missing --message-id or --attachment-id');
    print({ email, ...(await gmailDownloadAttachment(email, messageId, attachmentId, filename, typeof args.output === 'string' ? args.output : (typeof args.out === 'string' ? args.out : undefined))) });
    return true;
  }
  if (cmd === 'gmail-create-draft') {
    const to = String(args.to || '').split(',').map(s => s.trim()).filter(Boolean);
    const cc = String(args.cc || '').split(',').map(s => s.trim()).filter(Boolean);
    const bcc = String(args.bcc || '').split(',').map(s => s.trim()).filter(Boolean);
    const subject = String(args.subject || '');
    const body = String(args.body || '');
    const replyToId = typeof args['reply-to-id'] === 'string' ? args['reply-to-id'] : undefined;
    if (!to.length) die('Missing --to');
    if (!body) die('Missing --body');
    print({ email, ...(await gmailCreateDraft(email, { to, cc, bcc, subject, body, replyToId })) });
    return true;
  }
  if (cmd === 'gmail-send-draft') {
    if (!args.id) die('Missing --id (draft ID)');
    print({ email, ...(await gmailSendDraft(email, String(args.id))) });
    return true;
  }
  if (cmd === 'gmail-send') {
    const to = String(args.to || '').split(',').map(s => s.trim()).filter(Boolean);
    const cc = String(args.cc || '').split(',').map(s => s.trim()).filter(Boolean);
    const bcc = String(args.bcc || '').split(',').map(s => s.trim()).filter(Boolean);
    const subject = String(args.subject || '');
    const body = String(args.body || '');
    if (!to.length) die('Missing --to');
    if (!body) die('Missing --body');
    print({ email, ...(await gmailSend(email, { to, cc, bcc, subject, body })) });
    return true;
  }
  if (cmd === 'gmail-reply') {
    const replyToId = String(args['reply-to-id'] || args.replyToId || '');
    const body = String(args.body || '');
    const cc = String(args.cc || '').split(',').map(s => s.trim()).filter(Boolean);
    const bcc = String(args.bcc || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!replyToId) die('Missing --reply-to-id');
    if (!body) die('Missing --body');
    print({ email, ...(await gmailReply(email, replyToId, { body, cc, bcc })) });
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
    console.log(`Usage: bun google-gmail.ts <command> [options]

Auth:    status | login | accounts | default-account --email E | logout [--email E]
Gmail:   gmail-search --query Q [--limit N]
         gmail-inbox [--limit N]
         gmail-read --id MSG_ID [--format full|metadata|raw]
         gmail-download-attachment --message-id MSGID --attachment-id ATTID --filename NAME [--output PATH]
         gmail-create-draft --to A,B --subject S --body TEXT [--cc C] [--bcc B] [--reply-to-id ID]
         gmail-send-draft --id DRAFT_ID
         gmail-send --to A,B --subject S --body TEXT [--cc C] [--bcc B]
         gmail-reply --reply-to-id MSG_ID --body TEXT [--cc C] [--bcc B]
`);
    return;
  }

  if (await handleAuthCmd(cmd, args)) return;

  const resolved = await resolveEmail(email);
  if (await handleGmailCmd(cmd, args, resolved)) return;

  die(`Unknown command: ${cmd}`);
}

if (import.meta.main) {
  main().catch((err) => die(err.stack || err.message || String(err)));
}
