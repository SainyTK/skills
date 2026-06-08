#!/usr/bin/env bun
import { createServer } from 'node:http';
import { mkdir, readFile, unlink, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';

type TokenFile = {
  ok?: boolean;
  access_token?: string;
  authed_user?: { id?: string; access_token?: string };
  team?: { id?: string; name?: string };
  enterprise?: { id?: string; name?: string };
  bot_user_id?: string;
  installed_at?: string;
};

type SlackUser = { id: string; name?: string; real_name?: string; profile?: { display_name?: string } };
type SlackChannel = { id: string; name?: string; user?: string; is_channel?: boolean; is_group?: boolean; is_im?: boolean; is_mpim?: boolean; is_private?: boolean; is_member?: boolean; num_members?: number };
type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  pretty_type?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  thumb_64?: string;
  thumb_80?: string;
  thumb_160?: string;
  thumb_360?: string;
  thumb_480?: string;
  thumb_720?: string;
  thumb_960?: string;
  thumb_1024?: string;
  original_w?: number;
  original_h?: number;
};
type SlackMessage = { ts: string; text?: string; user?: string; username?: string; bot_id?: string; thread_ts?: string; reply_count?: number; permalink?: string; files?: SlackFile[] };

const skillDir = resolve(import.meta.dir, '..');
const envPath = join(skillDir, '.env');

await loadDotEnv(envPath);

const DEFAULT_REDIRECT_URI = 'http://localhost:3456/slack/callback';
const DEFAULT_USER_SCOPES = [
  'channels:read', 'channels:history',
  'groups:read', 'groups:history',
  'im:read', 'im:history',
  'mpim:read', 'mpim:history',
  'users:read', 'search:read', 'files:read',
].join(',');

const config = {
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  redirectUri: process.env.SLACK_REDIRECT_URI || DEFAULT_REDIRECT_URI,
  botScopes: process.env.SLACK_BOT_SCOPES || '',
  userScopes: process.env.SLACK_USER_SCOPES || DEFAULT_USER_SCOPES,
  tokenFile: process.env.SLACK_TOKEN_FILE || join(skillDir, '.data', 'slack-token.json'),
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
  if (!config.clientId || !config.clientSecret) die('Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET. Put them in .agents/skills/read-slack-messages/.env');
}

async function readTokenFile(): Promise<TokenFile | null> {
  try { return JSON.parse(await readFile(config.tokenFile, 'utf8')); } catch { return null; }
}

async function writeTokenFile(data: TokenFile) {
  await mkdir(dirname(config.tokenFile), { recursive: true });
  await writeFile(config.tokenFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { await chmod(config.tokenFile, 0o600); } catch {}
}

async function deleteTokenFile() {
  try { await unlink(config.tokenFile); return true; } catch { return false; }
}

function tokenSummary(token: TokenFile | null) {
  if (!token) return { loggedIn: false, tokenFile: config.tokenFile };
  return {
    loggedIn: true,
    team: token.team?.name || token.team?.id,
    teamId: token.team?.id,
    enterpriseId: token.enterprise?.id,
    botUserId: token.bot_user_id,
    hasBotToken: Boolean(token.access_token),
    hasUserToken: Boolean(token.authed_user?.access_token),
    authedUserId: token.authed_user?.id,
    installedAt: token.installed_at,
    tokenFile: config.tokenFile,
  };
}

function chooseToken(stored: TokenFile | null, preference: 'any' | 'user' | 'bot' = 'any') {
  if (!stored) die('Not logged in. Run: bun .agents/skills/read-slack-messages/scripts/slack.ts login');
  if (preference === 'user') {
    if (!stored.authed_user?.access_token) die('No user token available. Re-run login.');
    return stored.authed_user.access_token;
  }
  if (preference === 'bot') {
    if (!stored.access_token) die('No bot token available.');
    return stored.access_token;
  }
  return stored.authed_user?.access_token || stored.access_token || die('No Slack token available.');
}

async function slackApi(method: string, params: Record<string, unknown> = {}, tokenPreference: 'any' | 'user' | 'bot' = 'any', opts: { get?: boolean } = {}) {
  const token = chooseToken(await readTokenFile(), tokenPreference);
  const url = new URL(`https://slack.com/api/${method}`);
  const fetchOptions: RequestInit = { method: 'POST', headers: { Authorization: `Bearer ${token}` } };
  if (opts.get) {
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    fetchOptions.method = 'GET';
  } else {
    (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchOptions.body = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  }
  const response = await fetch(url, fetchOptions);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) die(`Slack API ${method} failed: ${data.error || response.statusText}`);
  return data;
}

async function slackDownload(url: string, outPath: string) {
  const token = chooseToken(await readTokenFile(), 'user');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) die(`Slack file download failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) die('Slack file download returned HTML. Check file URL and token scopes.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  return { path: outPath, bytes: bytes.byteLength, contentType };
}

function oauthUrl(state: string) {
  requireOAuthConfig();
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', config.clientId!);
  if (config.botScopes) url.searchParams.set('scope', config.botScopes);
  if (config.userScopes) url.searchParams.set('user_scope', config.userScopes);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? `open ${JSON.stringify(url)}` : process.platform === 'win32' ? `start "" ${JSON.stringify(url)}` : `xdg-open ${JSON.stringify(url)}`;
  exec(command, () => {});
}

async function exchangeOAuthCode(code: string) {
  requireOAuthConfig();
  const body = new URLSearchParams({ client_id: config.clientId!, client_secret: config.clientSecret!, code, redirect_uri: config.redirectUri });
  const response = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json();
  if (!response.ok || !data.ok) die(`Slack OAuth failed: ${data.error || response.statusText}`);
  data.installed_at = new Date().toISOString();
  await writeTokenFile(data);
  return data as TokenFile;
}

async function runLogin(timeoutSeconds = 180) {
  const redirect = new URL(config.redirectUri);
  const state = crypto.randomBytes(24).toString('hex');
  const url = oauthUrl(state);
  let server: ReturnType<typeof createServer> | undefined;
  const token = await new Promise<TokenFile>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      server?.close();
      reject(new Error(`Timed out waiting for Slack OAuth callback after ${timeoutSeconds}s. Login URL: ${url}`));
    }, timeoutSeconds * 1000);
    server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', config.redirectUri);
        if (reqUrl.pathname !== redirect.pathname) { res.writeHead(404).end('Not found'); return; }
        const returnedState = reqUrl.searchParams.get('state');
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        if (error) throw new Error(`Slack authorization denied: ${error}`);
        if (returnedState !== state) throw new Error('OAuth state mismatch.');
        if (!code) throw new Error('Missing OAuth code.');
        const t = await exchangeOAuthCode(code);
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>SainyOS Slack login complete</h1><p>You can close this tab.</p>');
        clearTimeout(timer); server?.close(); resolvePromise(t);
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(err.message);
        clearTimeout(timer); server?.close(); reject(err);
      }
    });
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      openBrowser(url);
      console.error(`Slack OAuth URL: ${url}`);
    });
    server.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
  return { loginUrl: url, status: tokenSummary(token) };
}

const usersCache = { expiresAt: 0, byId: new Map<string, string>() };
async function getUsersMap() {
  if (Date.now() < usersCache.expiresAt) return usersCache.byId;
  const byId = new Map<string, string>();
  let cursor = '';
  do {
    const data = await slackApi('users.list', { limit: 200, cursor }, 'user');
    for (const user of (data.members || []) as SlackUser[]) byId.set(user.id, user.profile?.display_name || user.real_name || user.name || user.id);
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);
  usersCache.byId = byId;
  usersCache.expiresAt = Date.now() + 10 * 60 * 1000;
  return byId;
}

async function resolveConversation(channel: string) {
  if (/^[CGD][A-Z0-9]+$/.test(channel)) return channel;
  const wanted = channel.replace(/^#/, '').toLowerCase();
  let cursor = '';
  do {
    const data = await slackApi('conversations.list', { types: 'public_channel,private_channel,im,mpim', exclude_archived: true, limit: 200, cursor }, 'user');
    const match = ((data.channels || []) as SlackChannel[]).find(c => (c.name || c.user || c.id || '').toLowerCase() === wanted);
    if (match) return match.id;
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);
  die(`Conversation not found: ${channel}. Use channel ID for DMs/private channels.`);
}

function formatTs(ts?: string) {
  if (!ts) return ts;
  const ms = Number(String(ts).split('.')[0]) * 1000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : ts;
}

function cleanMessageText(s = '', users = new Map<string, string>()) {
  return s.replace(/<@([A-Z0-9]+)>/g, (_, id) => `@${users.get(id) || id}`)
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<([^>]+)>/g, '$1');
}

function bestThumb(file: SlackFile) {
  return file.thumb_1024 || file.thumb_960 || file.thumb_720 || file.thumb_480 || file.thumb_360 || file.thumb_160 || file.thumb_80 || file.thumb_64;
}

function formatFiles(files: SlackFile[] = []) {
  return files.map(file => ({
    id: file.id,
    name: file.name,
    title: file.title,
    mimetype: file.mimetype,
    filetype: file.filetype,
    pretty_type: file.pretty_type,
    size: file.size,
    is_image: Boolean(file.mimetype?.startsWith('image/') || bestThumb(file)),
    width: file.original_w,
    height: file.original_h,
    url_private: file.url_private,
    url_private_download: file.url_private_download,
    thumb: bestThumb(file),
  }));
}

async function formatMessages(messages: SlackMessage[]) {
  const users = await getUsersMap();
  return messages.map(m => ({
    ts: m.ts,
    time: formatTs(m.ts),
    user: users.get(m.user || '') || m.username || m.user || m.bot_id || 'unknown',
    text: cleanMessageText(m.text || '', users),
    thread_ts: m.thread_ts,
    reply_count: m.reply_count,
    permalink: m.permalink,
    files: formatFiles(m.files || []),
  }));
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

function safeFileName(name: string) {
  return basename(name).replace(/[^A-Za-z0-9._-]+/g, '_') || 'slack-file';
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'help') {
    console.log(`Usage: bun .agents/skills/read-slack-messages/scripts/slack.ts <command> [options]\n\nCommands: status, login, logout, list, read, thread, search, download-file, send\n`);
    return;
  }
  if (cmd === 'status') return print(tokenSummary(await readTokenFile()));
  if (cmd === 'login') return print(await runLogin(Number(args.timeout || 180)));
  if (cmd === 'logout') return print({ deleted: await deleteTokenFile(), tokenFile: config.tokenFile });
  if (cmd === 'list') {
    const limit = Math.min(Number(args.limit || 100), 1000);
    const out: unknown[] = [];
    let cursor = '';
    while (out.length < limit) {
      const data = await slackApi('conversations.list', { types: String(args.types || 'public_channel,private_channel,im,mpim'), exclude_archived: true, limit: Math.min(200, limit - out.length), cursor }, 'user');
      out.push(...((data.channels || []) as SlackChannel[]).map(c => ({ id: c.id, name: c.name, user: c.user, is_channel: c.is_channel, is_group: c.is_group, is_im: c.is_im, is_mpim: c.is_mpim, is_private: c.is_private, is_member: c.is_member, num_members: c.num_members })));
      cursor = data.response_metadata?.next_cursor || '';
      if (!cursor) break;
    }
    return print(out);
  }
  if (cmd === 'read') {
    const channelArg = String(args.channel || '');
    if (!channelArg) die('Missing --channel');
    const channel = await resolveConversation(channelArg);
    const data = await slackApi('conversations.history', { channel, limit: Math.min(Number(args.limit || 30), 200), oldest: args.oldest, latest: args.latest, inclusive: true }, 'user');
    return print({ channel, messages: await formatMessages(data.messages || []) });
  }
  if (cmd === 'thread') {
    const channelArg = String(args.channel || '');
    const ts = String(args.ts || args.threadTs || '');
    if (!channelArg || !ts) die('Missing --channel or --ts');
    const channel = await resolveConversation(channelArg);
    const data = await slackApi('conversations.replies', { channel, ts, limit: Math.min(Number(args.limit || 100), 200) }, 'user');
    return print({ channel, threadTs: ts, messages: await formatMessages(data.messages || []) });
  }
  if (cmd === 'search') {
    const query = String(args.query || '');
    if (!query) die('Missing --query');
    const data = await slackApi('search.messages', { query, count: Math.min(Number(args.limit || args.count || 20), 100), sort: args.sort || 'timestamp', sort_dir: args.sortDir || 'desc' }, 'user', { get: true });
    return print({ total: data.messages?.total, matches: (data.messages?.matches || []).map((m: any) => ({ channel: m.channel?.name || m.channel?.id, channelId: m.channel?.id, user: m.user_name || m.user, ts: m.ts, time: formatTs(m.ts), text: cleanMessageText(m.text || ''), permalink: m.permalink })) });
  }
  if (cmd === 'download-file') {
    const url = String(args.url || args.fileUrl || '');
    if (!url) die('Missing --url');
    if (!url.startsWith('https://files.slack.com/') && !url.startsWith('https://slack-files.com/')) die('Only Slack file URLs are supported.');
    const parsed = new URL(url);
    const base = safeFileName(parsed.pathname.split('/').pop() || 'slack-file');
    const inferredExt = extname(base) ? '' : '.bin';
    const outPath = resolve(String(args.output || args.out || join(skillDir, '.data', 'downloads', `${base}${inferredExt}`)));
    const result = await slackDownload(url, outPath);
    return print(result);
  }
  if (cmd === 'send') {
    const channelArg = String(args.channel || '');
    const message = String(args.text || '');
    if (!channelArg || !message) die('Missing --channel or --text');
    const channel = await resolveConversation(channelArg);
    const data = await slackApi('chat.postMessage', { channel, text: message }, 'user');
    return print({ ok: true, channel: data.channel, ts: data.ts });
  }
  die(`Unknown command: ${cmd}`);
}

main().catch((err) => die(err.stack || err.message || String(err)));
