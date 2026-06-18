#!/usr/bin/env bun
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

type AuthInfo = {
  authenticated_at: number;
  authenticated_at_iso: string;
};

type Notebook = {
  id: string;
  url: string;
  name: string;
  description: string;
  topics: string[];
  use_cases: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  use_count: number;
  last_used: string | null;
};

type Library = {
  notebooks: Record<string, Notebook>;
  active_notebook_id: string | null;
  updated_at: string;
};

const skillDir = resolve(import.meta.dir, '..');
const envPath = join(skillDir, '.env');
await loadDotEnv(envPath);

const dataDir = process.env.NOTEBOOKLM_DATA_DIR || join(skillDir, '.data');
const authInfoFile = join(dataDir, 'auth-info.json');
const libraryFile = join(dataDir, 'library.json');
const browserProfileDir = join(dataDir, 'browser-profile');
const stateFile = join(dataDir, 'state.json');

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
];

const QUERY_INPUT_SELECTORS = [
  'textarea.query-box-input',
  'textarea[aria-label="Input for queries"]',
  'textarea[aria-label="Feld für Anfragen"]',
  'textarea[placeholder]',
];

const RESPONSE_SELECTORS = [
  '.to-user-container .message-text-content',
  '[data-message-author="bot"]',
  '[data-message-author="assistant"]',
];

const FOLLOW_UP_REMINDER = `\n\nEXTREMELY IMPORTANT: Is that ALL you need to know? You can always ask another question! Think about it carefully: before you reply to the user, review their original request and this answer. If anything is still unclear or missing, ask me another comprehensive question that includes all necessary context (since each question opens a new browser session).`;

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function writeJson(path: string, data: unknown) {
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir) await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { await chmod(path, 0o600); } catch {}
}

function print(data: unknown) { console.log(JSON.stringify(data, null, 2)); }

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

// For login only: persistent context to capture full session cookies
async function launchPersistent(headless = false): Promise<BrowserContext> {
  await mkdir(browserProfileDir, { recursive: true });
  return chromium.launchPersistentContext(browserProfileDir, {
    channel: 'chrome',
    headless,
    ignoreDefaultArgs: ['--enable-automation'],
    args: BROWSER_ARGS,
  });
}

// For queries: ephemeral browser + storageState injection - no profile lock, fully parallel
async function launchEphemeral(headless = true): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    ignoreDefaultArgs: ['--enable-automation'],
    args: BROWSER_ARGS,
  });
  const context = await browser.newContext({
    storageState: existsSync(stateFile) ? stateFile : undefined,
  });
  return { browser, context };
}

async function saveState(context: BrowserContext) {
  await context.storageState({ path: stateFile });
  try { await chmod(stateFile, 0o600); } catch {}
}

async function isAuthenticated() {
  return existsSync(stateFile);
}

async function getAuthInfo() {
  const authenticated = await isAuthenticated();
  const info = (await readJson<AuthInfo>(authInfoFile)) || {};
  return { authenticated, ...info };
}

async function saveAuthInfo() {
  const now = new Date();
  await writeJson(authInfoFile, {
    authenticated_at: now.getTime(),
    authenticated_at_iso: now.toISOString(),
  });
}

async function clearAuth() {
  try { await rm(stateFile, { force: true }); } catch {}
  try { await rm(authInfoFile, { force: true }); } catch {}
}

async function runLogin(timeoutSeconds = 600): Promise<{ authenticated: boolean }> {
  console.error('Opening browser for Google login...');
  const context = await launchPersistent(false); // must be headed for login
  try {
    const page = await context.newPage();
    await page.goto('https://notebooklm.google.com', { waitUntil: 'domcontentloaded' });

    if (page.url().includes('accounts.google.com')) {
      console.error(`Please log in to Google in the browser window. You have ${timeoutSeconds / 60} minutes.`);
      await page.waitForURL('**/notebooklm.google.com/**', { timeout: timeoutSeconds * 1000 });
      await page.waitForLoadState('networkidle');
    }

    await saveState(context);
    await saveAuthInfo();
    console.error('Login successful!');
    return { authenticated: true };
  } finally {
    await context.close();
  }
}

async function snapshotLastResponse(page: Page): Promise<string | null> {
  for (const sel of RESPONSE_SELECTORS) {
    const elements = await page.$$(sel);
    if (elements.length > 0) {
      const text = (await elements[elements.length - 1].innerText()).trim();
      if (text) return text;
    }
  }
  return null;
}

async function waitForAnswer(page: Page, previousAnswer: string | null): Promise<string | null> {
  const deadline = Date.now() + 120_000;
  let lastText = '';
  let stableCount = 0;

  while (Date.now() < deadline) {
    const thinking = await page.$('div.thinking-message');
    if (thinking && await thinking.isVisible()) {
      await page.waitForTimeout(1000);
      continue;
    }

    for (const sel of RESPONSE_SELECTORS) {
      const elements = await page.$$(sel);
      if (elements.length > 0) {
        const text = (await elements[elements.length - 1].innerText()).trim();
        if (text && text !== previousAnswer) {
          if (text === lastText) {
            if (++stableCount >= 3) return text;
          } else {
            stableCount = 0;
            lastText = text;
          }
          break;
        }
      }
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function askNotebookLM(question: string, notebookUrl: string, showBrowser = false): Promise<string | null> {
  console.error(`Asking: ${question}`);
  console.error(`Notebook: ${notebookUrl}`);

  if (!await isAuthenticated()) {
    console.error('Not authenticated. Run: bun notebooklm.ts login');
    return null;
  }

  const { browser, context } = await launchEphemeral(!showBrowser);
  try {
    const page = await context.newPage();
    console.error('Navigating to notebook...');
    await page.goto(notebookUrl, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('accounts.google.com')) {
      console.error('Session expired. Re-authenticating...');
      await browser.close();
      await runLogin();
      return askNotebookLM(question, notebookUrl, showBrowser);
    }

    console.error('Waiting for query input...');
    let inputSel = '';
    for (const sel of QUERY_INPUT_SELECTORS) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout: 30_000 });
        inputSel = sel;
        break;
      } catch { continue; }
    }

    if (!inputSel) {
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '');
      console.error(`Could not find query input. Page text: ${bodyText}`);
      console.error(`Current URL: ${page.url()}`);
      return null;
    }
    console.error(`Found input: ${inputSel}`);

    const previousAnswer = await snapshotLastResponse(page);

    console.error('Typing question...');
    await page.fill(inputSel, question);
    console.error('Submitting...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    console.error('Waiting for answer...');
    const answer = await waitForAnswer(page, previousAnswer);
    if (!answer) { console.error('Timeout waiting for answer'); return null; }
    console.error('Got answer!');
    return answer + FOLLOW_UP_REMINDER;
  } finally {
    await browser.close();
  }
}

async function loadLibrary(): Promise<Library> {
  return (await readJson<Library>(libraryFile)) || {
    notebooks: {},
    active_notebook_id: null,
    updated_at: new Date().toISOString(),
  };
}

async function saveLibrary(lib: Library) {
  lib.updated_at = new Date().toISOString();
  await writeJson(libraryFile, lib);
}

function toNotebookId(name: string) {
  return name.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function main() {
  const [cmd = 'help', ...cmdRest] = process.argv.slice(2);

  if (cmd === 'help') {
    console.log(`Usage: bun notebooklm.ts <command> [options]

Commands:
  status                          Check authentication status
  login [--timeout <sec>]         Log in to Google via browser (default: 600s)
  reauth [--timeout <sec>]        Clear auth and log in again
  clear                           Clear local auth state

  notebooks list                  List all notebooks in library
  notebooks add --url URL --name NAME --description DESC --topics T1,T2
  notebooks search --query QUERY  Search notebooks by keyword
  notebooks activate --id ID      Set the active notebook
  notebooks remove --id ID        Remove notebook from library
  notebooks stats                 Show library statistics

  ask --question "..."            Ask a question to NotebookLM
      [--notebook-id ID]          Use specific notebook by ID
      [--notebook-url URL]        Use notebook URL directly
      [--show-browser]            Show browser window (for debugging)
`);
    return;
  }

  if (cmd === 'status') {
    return print(await getAuthInfo());
  }

  if (cmd === 'login') {
    const args = parseArgs(cmdRest);
    return print(await runLogin(Number(args.timeout || 600)));
  }

  if (cmd === 'reauth') {
    const args = parseArgs(cmdRest);
    console.error('Clearing existing auth...');
    await clearAuth();
    return print(await runLogin(Number(args.timeout || 600)));
  }

  if (cmd === 'clear') {
    await clearAuth();
    return print({ cleared: true });
  }

  if (cmd === 'notebooks') {
    const [sub = 'list', ...subRest] = cmdRest;
    const args = parseArgs(subRest);
    const lib = await loadLibrary();

    if (sub === 'list' || sub === 'ls') {
      return print({
        count: Object.keys(lib.notebooks).length,
        activeId: lib.active_notebook_id,
        notebooks: Object.values(lib.notebooks),
      });
    }

    if (sub === 'add') {
      const url = String(args.url || '');
      const name = String(args.name || '');
      const description = String(args.description || '');
      const topicsStr = String(args.topics || '');
      if (!url) die('Missing --url');
      if (!name) die('Missing --name');
      if (!description) die('Missing --description');
      if (!topicsStr) die('Missing --topics');
      const id = toNotebookId(name);
      if (lib.notebooks[id]) die(`Notebook with ID '${id}' already exists. Remove it first or use a different name.`);
      const topics = topicsStr.split(',').map(s => s.trim()).filter(Boolean);
      const use_cases = String(args['use-cases'] || '').split(',').map(s => s.trim()).filter(Boolean);
      const tags = String(args.tags || '').split(',').map(s => s.trim()).filter(Boolean);
      const now = new Date().toISOString();
      const notebook: Notebook = { id, url, name, description, topics, use_cases, tags, created_at: now, updated_at: now, use_count: 0, last_used: null };
      lib.notebooks[id] = notebook;
      if (!lib.active_notebook_id) lib.active_notebook_id = id;
      await saveLibrary(lib);
      return print(notebook);
    }

    if (sub === 'search') {
      const query = String(args.query || '');
      if (!query) die('Missing --query');
      const q = query.toLowerCase();
      const results = Object.values(lib.notebooks).filter(nb =>
        [nb.name, nb.description, ...nb.topics, ...nb.tags, ...nb.use_cases].join(' ').toLowerCase().includes(q)
      );
      return print({ query, count: results.length, notebooks: results });
    }

    if (sub === 'activate') {
      const id = String(args.id || '');
      if (!id) die('Missing --id');
      if (!lib.notebooks[id]) die(`Notebook not found: ${id}`);
      lib.active_notebook_id = id;
      await saveLibrary(lib);
      return print({ activeId: id, notebook: lib.notebooks[id] });
    }

    if (sub === 'remove') {
      const id = String(args.id || '');
      if (!id) die('Missing --id');
      if (!lib.notebooks[id]) die(`Notebook not found: ${id}`);
      delete lib.notebooks[id];
      if (lib.active_notebook_id === id) {
        const remaining = Object.keys(lib.notebooks);
        lib.active_notebook_id = remaining.length ? remaining[0] : null;
      }
      await saveLibrary(lib);
      return print({ removed: id, newActiveId: lib.active_notebook_id });
    }

    if (sub === 'stats') {
      const all = Object.values(lib.notebooks);
      const allTopics = new Set(all.flatMap(n => n.topics));
      const totalUses = all.reduce((s, n) => s + n.use_count, 0);
      const mostUsed = [...all].sort((a, b) => b.use_count - a.use_count)[0] ?? null;
      return print({
        totalNotebooks: all.length,
        totalTopics: allTopics.size,
        totalUses,
        activeId: lib.active_notebook_id,
        mostUsed: mostUsed ? { id: mostUsed.id, name: mostUsed.name, use_count: mostUsed.use_count } : null,
      });
    }

    die(`Unknown notebooks subcommand: ${sub}. Run help for usage.`);
  }

  if (cmd === 'ask') {
    const args = parseArgs(cmdRest);
    const question = String(args.question || '');
    if (!question) die('Missing --question');

    let notebookUrl = String(args['notebook-url'] || '');

    if (!notebookUrl && args['notebook-id']) {
      const lib = await loadLibrary();
      const nb = lib.notebooks[String(args['notebook-id'])];
      if (!nb) die(`Notebook not found: ${args['notebook-id']}`);
      notebookUrl = nb.url;
    }

    if (!notebookUrl) {
      const lib = await loadLibrary();
      const activeNb = lib.active_notebook_id ? lib.notebooks[lib.active_notebook_id] : null;
      if (activeNb) {
        console.error(`Using active notebook: ${activeNb.name}`);
        notebookUrl = activeNb.url;
      } else {
        const all = Object.values(lib.notebooks);
        if (all.length) {
          console.error('Available notebooks:');
          all.forEach(nb => console.error(`  ${nb.id}: ${nb.name}`));
          console.error('\nSpecify with --notebook-id or set active: notebooks activate --id ID');
        } else {
          console.error('No notebooks in library. Add one first.');
        }
        die('No notebook specified or active');
      }
    }

    const answer = await askNotebookLM(question, notebookUrl, Boolean(args['show-browser']));
    if (!answer) die('Failed to get answer from NotebookLM');

    console.log('\n' + '='.repeat(60));
    console.log(`Question: ${question}`);
    console.log('='.repeat(60) + '\n');
    console.log(answer);
    console.log('\n' + '='.repeat(60));
    return;
  }

  die(`Unknown command: ${cmd}. Run help for usage.`);
}

main().catch(err => die(err.stack || err.message || String(err)));
