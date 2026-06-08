#!/usr/bin/env bun
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, unlink, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';

type TokenFile = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  token_type?: string;
  email?: string;
  logged_in_at?: string;
};

type PkcePair = {
  verifier: string;
  challenge: string;
};

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

const skillDir = resolve(import.meta.dir, '..');
const envPath = join(skillDir, '.env');

await loadDotEnv(envPath);

const DEFAULT_REDIRECT_URI = 'http://localhost:3457/gmail/callback';
const DEFAULT_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

const config = {
  clientId: process.env.GMAIL_CLIENT_ID,
  clientSecret: process.env.GMAIL_CLIENT_SECRET,
  redirectUri: process.env.GMAIL_REDIRECT_URI || DEFAULT_REDIRECT_URI,
  scopes: process.env.GMAIL_SCOPES || DEFAULT_SCOPES,
  tokenDir: process.env.GMAIL_TOKEN_DIR || join(skillDir, '.data', 'accounts'),
  defaultAccountFile: process.env.GMAIL_DEFAULT_ACCOUNT_FILE || join(skillDir, '.data', 'default-account'),
};

async function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  const text = await readFile(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireOAuthConfig() {
  if (!config.clientId) die('Missing GMAIL_CLIENT_ID. Put it in .agents/skills/read-gmail/.env');
}

function oauthClientFields(extra: Record<string, string> = {}) {
  const fields: Record<string, string> = { client_id: config.clientId!, ...extra };
  if (config.clientSecret) fields.client_secret = config.clientSecret;
  return fields;
}

function base64Url(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createPkcePair(): PkcePair {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function safeAccountFile(email: string) {
  const safe = email.toLowerCase().replace(/[^a-z0-9@._+-]+/g, '_');
  return join(config.tokenDir, `${safe}.json`);
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function writeTokenFile(token: TokenFile) {
  if (!token.email) die('Cannot store Gmail token without email.');
  const path = safeAccountFile(token.email);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(token, null, 2), { mode: 0o600 });
  try { await chmod(path, 0o600); } catch {}
}

async function listAccounts() {
  try {
    const files = await readdir(config.tokenDir);
    const out = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const token = await readJson<TokenFile>(join(config.tokenDir, file));
      if (token?.email) out.push({ email: token.email, loggedInAt: token.logged_in_at, scopes: token.scope, tokenFile: join(config.tokenDir, file) });
    }
    return out.sort((a, b) => a.email.localeCompare(b.email));
  } catch {
    return [];
  }
}

async function getDefaultEmail() {
  try { return (await readFile(config.defaultAccountFile, 'utf8')).trim() || null; } catch { return null; }
}

async function setDefaultEmail(email: string) {
  await mkdir(dirname(config.defaultAccountFile), { recursive: true });
  await writeFile(config.defaultAccountFile, `${email}\n`, { mode: 0o600 });
  try { await chmod(config.defaultAccountFile, 0o600); } catch {}
}

async function resolveEmail(explicit?: string) {
  if (explicit) return explicit.toLowerCase();
  const defaultEmail = await getDefaultEmail();
  if (defaultEmail) return defaultEmail.toLowerCase();
  const accounts = await listAccounts();
  if (accounts.length === 1) return accounts[0].email.toLowerCase();
  if (accounts.length > 1) die(`Multiple Gmail accounts logged in. Pass --email or set default-account. Accounts: ${accounts.map(a => a.email).join(', ')}`);
  die('No Gmail account logged in. Run: bun .agents/skills/read-gmail/scripts/gmail.ts login');
}

async function readToken(email?: string) {
  const resolved = await resolveEmail(email);
  const token = await readJson<TokenFile>(safeAccountFile(resolved));
  if (!token) die(`No token for ${resolved}. Run login.`);
  return token;
}

async function refreshToken(token: TokenFile) {
  requireOAuthConfig();
  if (!token.refresh_token) die(`No refresh token for ${token.email}. Run login again.`);
  const body = new URLSearchParams(oauthClientFields({
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  }));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Gmail token refresh failed: ${data.error_description || data.error || response.statusText}`);
  const next: TokenFile = {
    ...token,
    access_token: data.access_token,
    expires_in: data.expires_in,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 - 60_000,
    scope: data.scope || token.scope,
    token_type: data.token_type || token.token_type,
  };
  await writeTokenFile(next);
  return next;
}

async function accessToken(email?: string) {
  let token = await readToken(email);
  if (!token.access_token || !token.expires_at || Date.now() > token.expires_at) token = await refreshToken(token);
  return token.access_token!;
}

async function gmailApi(path: string, email?: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const token = await accessToken(email);
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Gmail API failed: ${data.error?.message || response.statusText}`);
  return data;
}

async function gmailDownload(path: string, email?: string) {
  const token = await accessToken(email);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Gmail download failed: ${data.error?.message || response.statusText}`);
  return data;
}

async function gmailApiPost(path: string, email: string | undefined, body: unknown) {
  const token = await accessToken(email);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Gmail API failed: ${data.error?.message || response.statusText}`);
  return data;
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

function toBase64Url(str: string) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '/').replace(/=+$/, '');
}

function oauthUrl(state: string, pkce?: PkcePair) {
  requireOAuthConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId!);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('state', state);
  if (pkce) {
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? `open ${JSON.stringify(url)}` : process.platform === 'win32' ? `start "" ${JSON.stringify(url)}` : `xdg-open ${JSON.stringify(url)}`;
  exec(command, () => {});
}

async function exchangeOAuthCode(code: string, pkce?: PkcePair) {
  requireOAuthConfig();
  const body = new URLSearchParams(oauthClientFields({
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    ...(pkce ? { code_verifier: pkce.verifier } : {}),
  }));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Gmail OAuth failed: ${data.error_description || data.error || response.statusText}`);
  const token: TokenFile = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 - 60_000,
    scope: data.scope,
    token_type: data.token_type,
    logged_in_at: new Date().toISOString(),
  };
  const profile = await gmailApiWithToken('profile', token.access_token!);
  token.email = String(profile.emailAddress || '').toLowerCase();
  if (!token.email) die('Gmail OAuth succeeded but profile email was missing.');
  await writeTokenFile(token);
  const accounts = await listAccounts();
  if (accounts.length === 1 || !(await getDefaultEmail())) await setDefaultEmail(token.email);
  return token;
}

async function gmailApiWithToken(path: string, token: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Gmail API failed: ${data.error?.message || response.statusText}`);
  return data;
}

async function runLogin(timeoutSeconds = 180) {
  const redirect = new URL(config.redirectUri);
  const state = crypto.randomBytes(24).toString('hex');
  const pkce = config.clientSecret ? undefined : createPkcePair();
  const url = oauthUrl(state, pkce);
  let server: ReturnType<typeof createServer> | undefined;
  const token = await new Promise<TokenFile>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      server?.close();
      reject(new Error(`Timed out waiting for Gmail OAuth callback after ${timeoutSeconds}s. Login URL: ${url}`));
    }, timeoutSeconds * 1000);
    server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', config.redirectUri);
        if (reqUrl.pathname !== redirect.pathname) { res.writeHead(404).end('Not found'); return; }
        const returnedState = reqUrl.searchParams.get('state');
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        if (error) throw new Error(`Gmail authorization denied: ${error}`);
        if (returnedState !== state) throw new Error('OAuth state mismatch.');
        if (!code) throw new Error('Missing OAuth code.');
        const t = await exchangeOAuthCode(code, pkce);
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>SainyOS Gmail login complete</h1><p>You can close this tab.</p>');
        clearTimeout(timer); server?.close(); resolvePromise(t);
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(err.message);
        clearTimeout(timer); server?.close(); reject(err);
      }
    });
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      openBrowser(url);
      console.error(`Gmail OAuth URL: ${url}`);
    });
    server.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
  return { email: token.email, scopes: token.scope, tokenFile: safeAccountFile(token.email!) };
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function print(data: unknown) { console.log(JSON.stringify(data, null, 2)); }

function header(part: GmailPart | undefined, name: string) {
  return part?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64Url(data = '') {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function collectParts(part: GmailPart | undefined, out: GmailPart[] = []) {
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

function safeFileName(name: string) {
  return basename(name).replace(/[^A-Za-z0-9._-]+/g, '_') || 'gmail-attachment';
}

async function getMessage(id: string, email?: string, format = 'metadata') {
  return gmailApi(`messages/${encodeURIComponent(id)}`, email, { format }) as Promise<GmailMessage>;
}

async function searchMessages(email: string | undefined, query: string, limit: number) {
  const data = await gmailApi('messages', email, { q: query, maxResults: Math.min(limit, 100) });
  const ids = (data.messages || []).map((m: { id: string }) => m.id);
  const messages = [];
  for (const id of ids) messages.push(summarizeMessage(await getMessage(id, email, 'metadata')));
  return { query, count: messages.length, messages };
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const email = typeof args.email === 'string' ? args.email : undefined;
  if (cmd === 'help') {
    console.log(`Usage: bun .agents/skills/read-gmail/scripts/gmail.ts <command> [options]\n\nCommands: status, login, accounts, default-account, logout, search, inbox, read, download-attachment, create-draft\n`);
    return;
  }
  if (cmd === 'status') {
    return print({ configured: Boolean(config.clientId), hasClientSecret: Boolean(config.clientSecret), defaultEmail: await getDefaultEmail(), accounts: await listAccounts(), tokenDir: config.tokenDir });
  }
  if (cmd === 'login') return print(await runLogin(Number(args.timeout || 180)));
  if (cmd === 'accounts') return print(await listAccounts());
  if (cmd === 'default-account') {
    if (!email) die('Missing --email');
    const token = await readJson<TokenFile>(safeAccountFile(email));
    if (!token) die(`No token for ${email}. Run login first.`);
    await setDefaultEmail(email.toLowerCase());
    return print({ defaultEmail: email.toLowerCase() });
  }
  if (cmd === 'logout') {
    const resolved = await resolveEmail(email);
    let deleted = false;
    try { await unlink(safeAccountFile(resolved)); deleted = true; } catch {}
    if ((await getDefaultEmail()) === resolved) { try { await unlink(config.defaultAccountFile); } catch {} }
    return print({ email: resolved, deleted });
  }
  if (cmd === 'search' || cmd === 'inbox') {
    const resolved = await resolveEmail(email);
    const query = cmd === 'inbox' ? String(args.query || 'in:inbox') : String(args.query || '');
    if (!query) die('Missing --query');
    return print({ email: resolved, ...(await searchMessages(resolved, query, Number(args.limit || 20))) });
  }
  if (cmd === 'read') {
    const id = String(args.id || args.messageId || '');
    if (!id) die('Missing --id');
    const resolved = await resolveEmail(email);
    const format = String(args.format || 'full');
    const message = await getMessage(id, resolved, format);
    return print({ email: resolved, message: summarizeMessage(message), bodies: format === 'full' ? extractBodies(message) : undefined, attachments: format === 'full' ? attachmentList(message) : undefined, raw: format === 'raw' ? message.raw : undefined });
  }
  if (cmd === 'download-attachment') {
    const messageId = String(args['message-id'] || args.messageId || '');
    const attachmentId = String(args['attachment-id'] || args.attachmentId || '');
    const filename = safeFileName(String(args.filename || 'gmail-attachment.bin'));
    if (!messageId || !attachmentId) die('Missing --message-id or --attachment-id');
    const resolved = await resolveEmail(email);
    const data = await gmailDownload(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, resolved);
    const bytes = Buffer.from(String(data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const outPath = resolve(String(args.output || args.out || join(skillDir, '.data', 'downloads', filename)));
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, bytes);
    return print({ email: resolved, path: outPath, bytes: bytes.length });
  }
  if (cmd === 'create-draft') {
    const resolved = await resolveEmail(email);
    const to = String(args.to || '').split(',').map(s => s.trim()).filter(Boolean);
    const cc = String(args.cc || '').split(',').map(s => s.trim()).filter(Boolean);
    const bcc = String(args.bcc || '').split(',').map(s => s.trim()).filter(Boolean);
    const subject = String(args.subject || '');
    const body = String(args.body || '');
    const replyToId = typeof args['reply-to-id'] === 'string' ? args['reply-to-id'] : undefined;
    if (!to.length) die('Missing --to');
    if (!body) die('Missing --body');

    let inReplyTo: string | undefined;
    let references: string | undefined;
    let threadId: string | undefined;

    if (replyToId) {
      const orig = await getMessage(replyToId, resolved, 'metadata') as GmailMessage;
      threadId = orig.threadId;
      const msgIdHeader = orig.payload?.headers?.find(h => h.name.toLowerCase() === 'message-id')?.value;
      const refsHeader = orig.payload?.headers?.find(h => h.name.toLowerCase() === 'references')?.value;
      if (msgIdHeader) {
        inReplyTo = msgIdHeader;
        references = [refsHeader, msgIdHeader].filter(Boolean).join(' ').trim();
      }
    }

    const raw = buildRfc2822({ from: resolved, to, cc, bcc, subject, body, inReplyTo, references });
    const draft = await gmailApiPost('drafts', resolved, {
      message: { raw: toBase64Url(raw), ...(threadId ? { threadId } : {}) },
    });
    return print({ email: resolved, draftId: draft.id, threadId: draft.message?.threadId });
  }
  die(`Unknown command: ${cmd}`);
}

main().catch((err) => die(err.stack || err.message || String(err)));
