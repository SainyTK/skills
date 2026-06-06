#!/usr/bin/env bun
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';

type TokenFile = {
  token: string;
  createdAt: string;
  member?: TrelloMember;
};

type TrelloMember = {
  id?: string;
  username?: string;
  fullName?: string;
  initials?: string;
  url?: string;
};

type TrelloBoard = {
  id: string;
  name: string;
  closed?: boolean;
  pinned?: boolean;
  url?: string;
  dateLastActivity?: string;
};

type TrelloList = {
  id: string;
  name: string;
  closed?: boolean;
  idBoard?: string;
  pos?: number;
};

type TrelloLabel = {
  id?: string;
  name?: string;
  color?: string;
};

type TrelloChecklistItem = {
  id: string;
  name: string;
  state: 'complete' | 'incomplete';
  due?: string | null;
  idMember?: string | null;
};

type TrelloChecklist = {
  id: string;
  name: string;
  checkItems?: TrelloChecklistItem[];
};

type TrelloCard = {
  id: string;
  idShort?: number;
  shortLink?: string;
  idBoard?: string;
  idList?: string;
  name: string;
  desc?: string;
  closed?: boolean;
  due?: string | null;
  dueComplete?: boolean;
  start?: string | null;
  dateLastActivity?: string;
  url?: string;
  shortUrl?: string;
  labels?: TrelloLabel[];
  idMembers?: string[];
  members?: TrelloMember[];
  checklists?: TrelloChecklist[];
};

const skillDir = resolve(import.meta.dir, '..');
const envPath = join(skillDir, '.env');

await loadDotEnv(envPath);

const DEFAULT_REDIRECT_URI = 'http://localhost:3458/trello/callback';

const config = {
  apiKey: process.env.TRELLO_API_KEY,
  appName: process.env.TRELLO_APP_NAME || 'SainyOS',
  redirectUri: process.env.TRELLO_REDIRECT_URI || DEFAULT_REDIRECT_URI,
  scope: process.env.TRELLO_SCOPE || 'read',
  expiration: process.env.TRELLO_EXPIRATION || 'never',
  tokenFile: resolve(process.env.TRELLO_TOKEN_FILE || join(skillDir, '.data', 'trello-token.json')),
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

function requireApiKey() {
  if (!config.apiKey) die('Missing TRELLO_API_KEY. Put it in .agents/skills/read-trello-tasks/.env');
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
  return {
    configured: Boolean(config.apiKey),
    loggedIn: Boolean(token?.token),
    member: token?.member ? {
      id: token.member.id,
      username: token.member.username,
      fullName: token.member.fullName,
      url: token.member.url,
    } : undefined,
    createdAt: token?.createdAt,
    tokenFile: config.tokenFile,
    redirectUri: config.redirectUri,
    scope: config.scope,
    expiration: config.expiration,
  };
}

async function getToken() {
  const stored = await readTokenFile();
  if (!stored?.token) die('Not logged in. Run: bun .agents/skills/read-trello-tasks/scripts/trello.ts login');
  return stored.token;
}

function authHeader(token: string) {
  return `OAuth oauth_consumer_key="${config.apiKey}", oauth_token="${token}"`;
}

async function trelloApi<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  requireApiKey();
  const token = await getToken();
  const url = new URL(`https://api.trello.com/1${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: authHeader(token) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : data.message || data.error || response.statusText;
    die(`Trello API ${path} failed: ${response.status} ${detail}`);
  }
  return data as T;
}

async function trelloApiWithToken<T>(token: string, path: string, params: Record<string, unknown> = {}): Promise<T> {
  requireApiKey();
  const url = new URL(`https://api.trello.com/1${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: authHeader(token) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`Trello API ${path} failed: ${response.status} ${response.statusText}`);
  return data as T;
}

function oauthUrl(state: string) {
  requireApiKey();
  const returnUrl = new URL(config.redirectUri);
  returnUrl.searchParams.set('state', state);
  const url = new URL('https://trello.com/1/authorize');
  url.searchParams.set('expiration', config.expiration);
  url.searchParams.set('name', config.appName);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('key', config.apiKey!);
  url.searchParams.set('return_url', returnUrl.toString());
  url.searchParams.set('callback_method', 'fragment');
  return url.toString();
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? `open ${JSON.stringify(url)}` : process.platform === 'win32' ? `start "" ${JSON.stringify(url)}` : `xdg-open ${JSON.stringify(url)}`;
  exec(command, () => {});
}

function callbackHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<title>SainyOS Trello login</title>
<body>
<h1>SainyOS Trello login</h1>
<p id="status">Finishing login...</p>
<script>
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('token');
const state = params.get('state') || new URLSearchParams(location.search).get('state');
fetch('/trello/token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token, state })
}).then(async (res) => {
  if (!res.ok) throw new Error(await res.text());
  document.getElementById('status').textContent = 'Login complete. You can close this tab.';
}).catch((err) => {
  document.getElementById('status').textContent = 'Login failed: ' + err.message;
});
</script>
</body>`;
}

async function runLogin(timeoutSeconds = 180) {
  requireApiKey();
  const redirect = new URL(config.redirectUri);
  const state = crypto.randomBytes(24).toString('hex');
  const url = oauthUrl(state);
  let server: ReturnType<typeof createServer> | undefined;
  const tokenFile = await new Promise<TokenFile>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      server?.close();
      reject(new Error(`Timed out waiting for Trello callback after ${timeoutSeconds}s. Login URL: ${url}`));
    }, timeoutSeconds * 1000);

    server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', config.redirectUri);
        if (req.method === 'GET' && reqUrl.pathname === redirect.pathname) {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(callbackHtml());
          return;
        }
        if (req.method !== 'POST' || reqUrl.pathname !== '/trello/token') {
          res.writeHead(404).end('Not found');
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (body.state !== state) throw new Error('OAuth state mismatch.');
        if (!body.token || typeof body.token !== 'string') throw new Error('Missing Trello token.');
        const member = await trelloApiWithToken<TrelloMember>(body.token, '/members/me', { fields: 'id,username,fullName,initials,url' });
        const stored = { token: body.token, createdAt: new Date().toISOString(), member };
        await writeTokenFile(stored);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
        clearTimeout(timer);
        server?.close();
        resolvePromise(stored);
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(err.message);
        clearTimeout(timer);
        server?.close();
        reject(err);
      }
    });
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      openBrowser(url);
      console.error(`Trello authorization URL: ${url}`);
    });
    server.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
  return tokenSummary(tokenFile);
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

function compactCard(card: TrelloCard) {
  const checklists = (card.checklists || []).map(checklist => ({
    id: checklist.id,
    name: checklist.name,
    items: (checklist.checkItems || []).map(item => ({
      id: item.id,
      name: item.name,
      state: item.state,
      due: item.due,
      memberId: item.idMember,
    })),
  }));
  return {
    id: card.id,
    idShort: card.idShort,
    shortLink: card.shortLink,
    boardId: card.idBoard,
    listId: card.idList,
    name: card.name,
    desc: card.desc,
    closed: card.closed,
    due: card.due,
    dueComplete: card.dueComplete,
    start: card.start,
    dateLastActivity: card.dateLastActivity,
    labels: (card.labels || []).map(label => ({ id: label.id, name: label.name, color: label.color })),
    members: (card.members || []).map(member => ({ id: member.id, username: member.username, fullName: member.fullName })),
    checklistCount: checklists.length,
    checklists,
    url: card.url,
    shortUrl: card.shortUrl,
  };
}

function limitNumber(args: Record<string, string | boolean>, fallback: number, max: number) {
  return Math.min(Math.max(Number(args.limit || fallback), 1), max);
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'help') {
    console.log(`Usage: bun .agents/skills/read-trello-tasks/scripts/trello.ts <command> [options]\n\nCommands: status, login, logout, me, boards, lists, cards, card, search, actions\n`);
    return;
  }
  if (cmd === 'status') return print(tokenSummary(await readTokenFile()));
  if (cmd === 'login') return print(await runLogin(Number(args.timeout || 180)));
  if (cmd === 'logout') return print({ deleted: await deleteTokenFile(), tokenFile: config.tokenFile });
  if (cmd === 'me') {
    return print(await trelloApi<TrelloMember>('/members/me', { fields: 'id,username,fullName,initials,url' }));
  }
  if (cmd === 'boards') {
    const boards = await trelloApi<TrelloBoard[]>('/members/me/boards', {
      filter: args.filter || 'open',
      fields: 'id,name,closed,pinned,url,dateLastActivity',
      lists: args.lists ? 'open' : undefined,
    });
    return print(boards);
  }
  if (cmd === 'lists') {
    const board = String(args.board || '');
    if (!board) die('Missing --board');
    const lists = await trelloApi<TrelloList[]>(`/boards/${encodeURIComponent(board)}/lists`, {
      filter: args.filter || 'open',
      fields: 'id,name,closed,idBoard,pos',
    });
    return print(lists);
  }
  if (cmd === 'cards') {
    const board = String(args.board || '');
    const list = String(args.list || '');
    if (!board && !list) die('Missing --board or --list');
    const path = board ? `/boards/${encodeURIComponent(board)}/cards` : `/lists/${encodeURIComponent(list)}/cards`;
    const cards = await trelloApi<TrelloCard[]>(path, {
      filter: args['include-closed'] ? 'all' : 'open',
      fields: 'id,idShort,shortLink,idBoard,idList,name,desc,closed,due,dueComplete,start,dateLastActivity,url,shortUrl,labels,idMembers',
      members: true,
      member_fields: 'id,username,fullName',
      checklists: args.checklists === false ? 'none' : 'all',
      limit: limitNumber(args, 100, 1000),
    });
    return print(cards.map(compactCard));
  }
  if (cmd === 'card') {
    const id = String(args.id || args.card || '');
    if (!id) die('Missing --id');
    const card = await trelloApi<TrelloCard>(`/cards/${encodeURIComponent(id)}`, {
      fields: 'id,idShort,shortLink,idBoard,idList,name,desc,closed,due,dueComplete,start,dateLastActivity,url,shortUrl,labels,idMembers',
      members: true,
      member_fields: 'id,username,fullName',
      checklists: 'all',
    });
    return print(compactCard(card));
  }
  if (cmd === 'actions') {
    const board = String(args.board || '');
    const card = String(args.card || '');
    if (!board && !card) die('Missing --board or --card');
    const path = board
      ? `/boards/${encodeURIComponent(board)}/actions`
      : `/cards/${encodeURIComponent(card)}/actions`;
    const actions = await trelloApi<any[]>(path, {
      filter: String(args.filter || 'all'),
      limit: limitNumber(args, 50, 1000),
      fields: 'id,type,date,data,memberCreator',
      memberCreator_fields: 'id,username,fullName',
    });
    return print(actions.map(a => ({
      id: a.id,
      type: a.type,
      date: a.date,
      by: a.memberCreator ? { username: a.memberCreator.username, fullName: a.memberCreator.fullName } : null,
      data: a.data,
    })));
  }
  if (cmd === 'search') {
    const query = String(args.query || '');
    if (!query) die('Missing --query');
    const data = await trelloApi<any>('/search', {
      query,
      modelTypes: 'cards',
      card_fields: 'id,idShort,shortLink,idBoard,idList,name,desc,closed,due,dueComplete,start,dateLastActivity,url,shortUrl,labels,idMembers',
      cards_limit: limitNumber(args, 20, 100),
      partial: args.partial ? true : undefined,
    });
    return print({ cards: (data.cards || []).map(compactCard) });
  }
  die(`Unknown command: ${cmd}`);
}

main().catch((err) => die(err.stack || err.message || String(err)));
