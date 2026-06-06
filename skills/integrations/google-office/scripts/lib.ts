import { createServer } from 'node:http';
import { mkdir, readFile, readdir, unlink, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';

export type TokenFile = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  token_type?: string;
  email?: string;
  logged_in_at?: string;
};

export type PkcePair = { verifier: string; challenge: string };

export type ApiOptions = {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: boolean;
};

export const skillDir = resolve(import.meta.dir, '..');
const envPath = join(skillDir, '.env');

await loadDotEnv(envPath);

export const config = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3457/office/callback',
  scopes: process.env.GOOGLE_SCOPES || [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' '),
  tokenDir: process.env.GOOGLE_TOKEN_DIR || join(skillDir, '.data', 'accounts'),
  defaultAccountFile: process.env.GOOGLE_DEFAULT_ACCOUNT_FILE || join(skillDir, '.data', 'default-account'),
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

export function die(message: string): never {
  console.error(message);
  process.exit(1);
}

export function requireOAuthConfig() {
  if (!config.clientId) die('Missing GOOGLE_CLIENT_ID. Put it in .agents/skills/google-office/.env');
}

export function oauthClientFields(extra: Record<string, string> = {}) {
  const fields: Record<string, string> = { client_id: config.clientId!, ...extra };
  if (config.clientSecret) fields.client_secret = config.clientSecret;
  return fields;
}

function base64Url(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createPkcePair(): PkcePair {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function safeAccountFile(email: string) {
  const safe = email.toLowerCase().replace(/[^a-z0-9@._+-]+/g, '_');
  return join(config.tokenDir, `${safe}.json`);
}

export async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function writeTokenFile(token: TokenFile) {
  if (!token.email) die('Cannot store Google token without email.');
  const path = safeAccountFile(token.email);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(token, null, 2), { mode: 0o600 });
  try { await chmod(path, 0o600); } catch {}
}

export async function listAccounts() {
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

export async function getDefaultEmail() {
  try { return (await readFile(config.defaultAccountFile, 'utf8')).trim() || null; } catch { return null; }
}

export async function setDefaultEmail(email: string) {
  await mkdir(dirname(config.defaultAccountFile), { recursive: true });
  await writeFile(config.defaultAccountFile, `${email}\n`, { mode: 0o600 });
  try { await chmod(config.defaultAccountFile, 0o600); } catch {}
}

export async function resolveEmail(explicit?: string) {
  if (explicit) return explicit.toLowerCase();
  const defaultEmail = await getDefaultEmail();
  if (defaultEmail) return defaultEmail.toLowerCase();
  const accounts = await listAccounts();
  if (accounts.length === 1) return accounts[0].email.toLowerCase();
  if (accounts.length > 1) die(`Multiple Google accounts logged in. Pass --email or set default-account. Accounts: ${accounts.map(a => a.email).join(', ')}`);
  die('No Google account logged in. Run: bun .agents/skills/google-office/scripts/office.ts login');
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
  if (!response.ok) die(`Google token refresh failed: ${data.error_description || data.error || response.statusText}`);
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

export async function accessToken(email?: string) {
  let token = await readToken(email);
  if (!token.access_token || !token.expires_at || Date.now() > token.expires_at) token = await refreshToken(token);
  return token.access_token!;
}

export async function api(url: string, email: string | undefined, opts: ApiOptions = {}) {
  const token = await accessToken(email);
  const target = new URL(url);
  for (const [key, value] of Object.entries(opts.query || {})) if (value !== undefined && value !== '') target.searchParams.set(key, String(value));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(opts.headers || {}) };
  let body: BodyInit | undefined;
  if (opts.body !== undefined && !(opts.body instanceof Uint8Array)) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    body = headers['Content-Type'] === 'application/json' ? JSON.stringify(opts.body) : (opts.body as BodyInit);
  } else if (opts.body instanceof Uint8Array) {
    body = opts.body;
  }
  const response = await fetch(target, { method: opts.method || 'GET', headers, body });
  if (opts.raw) {
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      die(`Google API failed (${response.status}): ${errText}`);
    }
    return response;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Google API failed (${response.status}): ${data.error?.message || JSON.stringify(data.error) || response.statusText}`);
  return data;
}

// ---------- OAuth login ----------

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

async function fetchEmail(token: string) {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Google userinfo failed: ${data.error?.message || response.statusText}`);
  return String(data.email || '').toLowerCase();
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
  if (!response.ok) die(`Google OAuth failed: ${data.error_description || data.error || response.statusText}`);
  const token: TokenFile = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 - 60_000,
    scope: data.scope,
    token_type: data.token_type,
    logged_in_at: new Date().toISOString(),
  };
  token.email = await fetchEmail(token.access_token!);
  if (!token.email) die('Google OAuth succeeded but profile email was missing.');
  await writeTokenFile(token);
  const accounts = await listAccounts();
  if (accounts.length === 1 || !(await getDefaultEmail())) await setDefaultEmail(token.email);
  return token;
}

export async function runLogin(timeoutSeconds = 180) {
  const redirect = new URL(config.redirectUri);
  const state = crypto.randomBytes(24).toString('hex');
  const pkce = config.clientSecret ? undefined : createPkcePair();
  const url = oauthUrl(state, pkce);
  let server: ReturnType<typeof createServer> | undefined;
  const token = await new Promise<TokenFile>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      server?.close();
      reject(new Error(`Timed out waiting for Google OAuth callback after ${timeoutSeconds}s. Login URL: ${url}`));
    }, timeoutSeconds * 1000);
    server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', config.redirectUri);
        if (reqUrl.pathname !== redirect.pathname) { res.writeHead(404).end('Not found'); return; }
        const returnedState = reqUrl.searchParams.get('state');
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        if (error) throw new Error(`Google authorization denied: ${error}`);
        if (returnedState !== state) throw new Error('OAuth state mismatch.');
        if (!code) throw new Error('Missing OAuth code.');
        const t = await exchangeOAuthCode(code, pkce);
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>SainyOS Google Office login complete</h1><p>You can close this tab.</p>');
        clearTimeout(timer); server?.close(); resolvePromise(t);
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(err.message);
        clearTimeout(timer); server?.close(); reject(err);
      }
    });
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      openBrowser(url);
      console.error(`Google OAuth URL: ${url}`);
    });
    server.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
  return { email: token.email, scopes: token.scope, tokenFile: safeAccountFile(token.email!) };
}

// ---------- CLI utilities ----------

export function parseArgs(argv: string[]) {
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

export function print(data: unknown) { console.log(JSON.stringify(data, null, 2)); }

export function safeFileName(name: string) {
  return basename(name).replace(/[^A-Za-z0-9._-]+/g, '_') || 'google-file';
}

export async function parseValues(input: string): Promise<unknown[][]> {
  let text = input;
  if (existsSync(input)) text = await readFile(input, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { die('--values must be JSON: a 2D array like [["a","b"],["c","d"]] or a path to such a file.'); }
  if (!Array.isArray(parsed)) die('--values must be a JSON 2D array.');
  return (parsed as unknown[]).map(row => (Array.isArray(row) ? row : [row]));
}

export async function parseJsonArg(input: string): Promise<unknown> {
  let text = input;
  if (existsSync(input)) text = await readFile(input, 'utf8');
  try { return JSON.parse(text); } catch { die('--requests must be valid JSON or a path to a JSON file.'); }
}

// ---------- Shared auth command handler ----------

export async function handleAuthCmd(cmd: string, args: Record<string, string | boolean>): Promise<boolean> {
  const email = typeof args.email === 'string' ? args.email : undefined;
  if (cmd === 'status') {
    print({ configured: Boolean(config.clientId), hasClientSecret: Boolean(config.clientSecret), redirectUri: config.redirectUri, scopes: config.scopes, defaultEmail: await getDefaultEmail(), accounts: await listAccounts(), tokenDir: config.tokenDir });
    return true;
  }
  if (cmd === 'login') { print(await runLogin(Number(args.timeout || 180))); return true; }
  if (cmd === 'accounts') { print(await listAccounts()); return true; }
  if (cmd === 'default-account') {
    if (!email) die('Missing --email');
    const token = await readJson<TokenFile>(safeAccountFile(email));
    if (!token) die(`No token for ${email}. Run login first.`);
    await setDefaultEmail(email.toLowerCase());
    print({ defaultEmail: email.toLowerCase() });
    return true;
  }
  if (cmd === 'logout') {
    const resolved = await resolveEmail(email);
    let deleted = false;
    try { await unlink(safeAccountFile(resolved)); deleted = true; } catch {}
    if ((await getDefaultEmail()) === resolved) { try { await unlink(config.defaultAccountFile); } catch {} }
    print({ email: resolved, deleted });
    return true;
  }
  return false;
}
