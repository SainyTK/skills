#!/usr/bin/env bun
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

const NOTEBOOKLM_TAB = `notebooklm-${process.pid}`;

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function ab(args: string[]): Promise<string> {
  const proc = Bun.spawn(
    ['agent-browser', ...args],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(err.trim() || text.trim() || `agent-browser exited ${code}`);
  return text.trim();
}

async function abEval(js: string): Promise<string> {
  try { return await ab(['eval', '-b', Buffer.from(js).toString('base64')]); } catch { return ''; }
}

// Try to dismiss Chrome startup dialogs via DOM.
// Handles: "Something went wrong with profile" (cr-button OK) and
//          "Restore pages?" snackbar (Don't restore / close button).
async function dismissStartupDialogs() {
  await abEval(`
    (function() {
      var btns = Array.from(document.querySelectorAll('cr-button, button'));
      for (var b of btns) {
        var t = (b.innerText || b.textContent || '').trim();
        if (t === 'OK' || t === 'Got it' || t === 'Dismiss') { b.click(); return; }
      }
    })()
  `);
  await sleep(400);
  await abEval(`
    (function() {
      var btns = Array.from(document.querySelectorAll('button, cr-button'));
      for (var b of btns) {
        var t = (b.innerText || b.textContent || '').trim().toLowerCase();
        if (t === "don't restore" || t === 'cancel') { b.click(); return; }
      }
      var close = document.querySelector('[aria-label="Close"], [aria-label="Dismiss"], .close-button');
      if (close) close.click();
    })()
  `);
  await sleep(400);
}

async function isAuthenticated() {
  return existsSync(authInfoFile);
}

async function getAuthInfo() {
  const authenticated = await isAuthenticated();
  const info = (await readJson<AuthInfo>(authInfoFile)) || {};
  return { authenticated, tab: NOTEBOOKLM_TAB, ...info };
}

async function saveAuthInfo() {
  const now = new Date();
  await writeJson(authInfoFile, {
    authenticated_at: now.getTime(),
    authenticated_at_iso: now.toISOString(),
  });
}

async function clearAuth() {
  try { await rm(authInfoFile, { force: true }); } catch {}
}

async function openTaskTab(url: string, showBrowser = false) {
  const args = showBrowser
    ? ['--headed', 'tab', 'new', '--label', NOTEBOOKLM_TAB, url]
    : ['tab', 'new', '--label', NOTEBOOKLM_TAB, url];
  try {
    await ab(args);
  } catch {
    await ab(['tab', NOTEBOOKLM_TAB]);
    await ab(['open', url]);
  }
  await ab(['tab', NOTEBOOKLM_TAB]);
}

async function runLogin(timeoutSeconds = 600) {
  console.error('Verifying NotebookLM access using default profile...');
  await openTaskTab('https://notebooklm.google.com');
  await sleep(2000);
  await dismissStartupDialogs();
  await ab(['wait', '--load', 'networkidle']);
  const currentUrl = await ab(['get', 'url']);

  if (currentUrl.includes('accounts.google.com')) {
    console.error('Not authenticated. Opening browser for login...');
    await openTaskTab('https://notebooklm.google.com', true);
    console.error(`Please log in to Google in the browser window. You have ${timeoutSeconds / 60} minutes.`);
    await ab(['wait', '--url', '**notebooklm.google.com**', '--timeout', String(timeoutSeconds * 1000)]);
    await ab(['wait', '--load', 'networkidle']);
    await sleep(1500);
    console.error('Login successful!');
  }

  await saveAuthInfo();
  return { authenticated: true };
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

async function askNotebookLM(question: string, notebookUrl: string, showBrowser = false): Promise<string | null> {
  console.error(`Asking: ${question}`);
  console.error(`Notebook: ${notebookUrl}`);

  // Use the shared default agent-browser session and this process's own tab.
  console.error('Opening browser...');
  await openTaskTab(notebookUrl, showBrowser);

  try {
    await ab(['tab', NOTEBOOKLM_TAB]);
    await sleep(2500);
    await dismissStartupDialogs();

    const urlAfterOpen = await ab(['get', 'url']);
    console.error(`URL after open: ${urlAfterOpen}`);
    if (!urlAfterOpen.includes('notebooklm.google.com')) {
      if (urlAfterOpen.includes('accounts.google.com')) {
        console.error('Auth redirect detected, need to login first.');
      } else {
        console.error('Not on NotebookLM yet, navigating explicitly...');
        await ab(['open', notebookUrl]);
        await sleep(2000);
        await dismissStartupDialogs();
      }
    }

    await ab(['wait', '--load', 'networkidle']);

    const currentUrl = await ab(['get', 'url']);
    if (currentUrl.includes('accounts.google.com')) {
      console.error('Session expired. Re-authenticating...');
      await runLogin();
      await openTaskTab(notebookUrl, showBrowser);
      await sleep(2500);
      await dismissStartupDialogs();
      await ab(['wait', '--load', 'networkidle']);
      const retryUrl = await ab(['get', 'url']);
      if (retryUrl.includes('accounts.google.com')) {
        console.error('Still not authenticated after reauth');
        return null;
      }
    }

    console.error('Waiting for query input...');
    const inputDeadline = Date.now() + 30_000;
    let inputSel = '';
    outer: while (Date.now() < inputDeadline) {
      for (const sel of QUERY_INPUT_SELECTORS) {
        const found = await abEval(`Boolean(document.querySelector(${JSON.stringify(sel)}))`);
        if (found === 'true') { inputSel = sel; break outer; }
      }
      await sleep(1000);
    }
    if (!inputSel) {
      // Debug: dump what's on screen
      const bodyText = await abEval(`document.body?.innerText?.slice(0,300) ?? ''`);
      console.error(`Could not find query input. Page text: ${bodyText}`);
      const finalUrl = await ab(['get', 'url']);
      console.error(`Final URL: ${finalUrl}`);
      return null;
    }
    console.error(`Found input: ${inputSel}`);

    console.error('Typing question...');
    await ab(['fill', inputSel, question]);
    console.error('Submitting...');
    await ab(['press', 'Enter']);
    await sleep(800);

    console.error('Waiting for answer...');
    const deadline = Date.now() + 120_000;
    let lastText = '', stableCount = 0, answer: string | null = null;

    while (Date.now() < deadline) {
      const thinking = await abEval(
        `Boolean(document.querySelector('div.thinking-message')?.offsetParent)`
      );
      if (thinking === 'true') { await sleep(1000); continue; }

      for (const sel of RESPONSE_SELECTORS) {
        const text = await abEval(
          `Array.from(document.querySelectorAll(${JSON.stringify(sel)})).at(-1)?.innerText?.trim() ?? ""`
        );
        if (text) {
          if (text === lastText) { if (++stableCount >= 3) { answer = text; break; } }
          else { stableCount = 0; lastText = text; }
          break;
        }
      }
      if (answer) break;
      await sleep(1000);
    }

    if (!answer) { console.error('Timeout waiting for answer'); return null; }
    console.error('Got answer!');
    return answer + FOLLOW_UP_REMINDER;
  } finally {
    // Leave the shared browser session alive per agent-browser-core workflow.
  }
}

async function main() {
  const [cmd = 'help', ...cmdRest] = process.argv.slice(2);

  if (cmd === 'help') {
    console.log(`Usage: bun .agents/skills/notebooklm/scripts/notebooklm.ts <command> [options]

Commands:
  status                          Check authentication status and config
  login [--timeout <sec>]         Log in to Google via browser (default: 600s)
  reauth [--timeout <sec>]        Clear auth and log in again
  clear                           Clear local auth marker

  notebooks list                  List all notebooks in library
  notebooks add --url URL --name NAME --description DESC --topics T1,T2
                [--use-cases U1,U2] [--tags T1,T2]
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
          console.error('No notebooks in library. Add one first:');
          console.error('notebooks add --url URL --name NAME --description DESC --topics TOPICS');
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
