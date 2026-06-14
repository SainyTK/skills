#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Json = Record<string, any>;

const skillDir = resolve(import.meta.dir, '..');
const envPath = join(skillDir, '.env');

await loadDotEnv(envPath);

const config = {
  token: process.env.NOTION_API_KEY || process.env.NOTION_TOKEN,
  version: process.env.NOTION_VERSION || '2026-03-11',
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

function requireToken() {
  if (!config.token) die(`Missing NOTION_API_KEY. Put it in ${envPath}`);
}

function parseArgs(argv: string[]) {
  const out: { _: string[]; [key: string]: any } = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function boolFlag(value: unknown) {
  if (value === undefined || value === false) return undefined;
  if (value === true) return true;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  die(`Invalid boolean value: ${value}`);
}

function intFlag(value: unknown, fallback: number, max = 100) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1) die(`Invalid positive integer: ${value}`);
  return Math.min(n, max);
}

async function jsonArg(value: unknown, fallback: Json = {}) {
  if (value === undefined || value === true) return fallback;
  const raw = String(value);
  const text = existsSync(raw) ? await readFile(raw, 'utf8') : raw;
  try {
    return JSON.parse(text);
  } catch (err: any) {
    die(`Invalid JSON or JSON file ${raw}: ${err.message}`);
  }
}

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

async function notionApi(method: string, path: string, body?: Json, query: Record<string, unknown> = {}) {
  requireToken();
  const url = new URL(path.startsWith('http') ? path : `https://api.notion.com${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    'Notion-Version': config.version,
  };
  const options: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    die(`Notion API ${method} ${url.pathname} failed: ${response.status} ${message}`);
  }
  return data;
}

async function pagedList(path: string, params: Json = {}, limit = 100) {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const pageSize = Math.min(100, limit - results.length);
    const data = await notionApi('GET', path, undefined, { ...params, page_size: pageSize, start_cursor: cursor });
    results.push(...(data.results || []));
    cursor = data.has_more && results.length < limit ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function pagedPost(path: string, body: Json = {}, limit = 100) {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const pageSize = Math.min(100, limit - results.length);
    const data = await notionApi('POST', path, { ...body, page_size: body.page_size || pageSize, start_cursor: cursor });
    results.push(...(data.results || []));
    cursor = data.has_more && results.length < limit ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

function textBlock(type: string, text: string) {
  const richText = [{ type: 'text', text: { content: text } }];
  if (type === 'to_do') return { object: 'block', type, [type]: { rich_text: richText, checked: false } };
  return { object: 'block', type, [type]: { rich_text: richText } };
}

function textToBlocks(text: string, type = 'paragraph') {
  const allowed = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do']);
  if (!allowed.has(type)) die(`Unsupported block type: ${type}`);
  const parts = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  return (parts.length ? parts : ['']).slice(0, 100).map(part => textBlock(type, part));
}

async function readChildren(id: string, recursive = false, limit = 100): Promise<any[]> {
  const children = await pagedList(`/v1/blocks/${id}/children`, {}, limit);
  if (!recursive) return children;
  for (const child of children) {
    if (child.has_children) child.children = await readChildren(child.id, true, limit);
  }
  return children;
}

function titleProperty(title: string) {
  return {
    title: {
      title: [{ type: 'text', text: { content: title } }],
    },
  };
}

async function commandStatus() {
  if (!config.token) {
    printJson({ configured: false, envPath, version: config.version });
    return;
  }
  const me = await notionApi('GET', '/v1/users/me');
  printJson({
    configured: true,
    version: config.version,
    envPath,
    bot: {
      id: me.id,
      name: me.name,
      type: me.type,
      workspace_name: me.bot?.workspace_name,
      owner: me.bot?.owner?.type,
    },
  });
}

async function main() {
  const [command, ...commandArgs] = process.argv.slice(2);
  const args = parseArgs(command === 'api' ? commandArgs.slice(1) : commandArgs);

  switch (command) {
    case undefined:
    case 'help':
      printJson({
        commands: ['status', 'search', 'page', 'blocks', 'database', 'data-source', 'query-data-source', 'create-page', 'append', 'update-page', 'api'],
      });
      break;

    case 'status':
      await commandStatus();
      break;

    case 'search': {
      const limit = intFlag(args.limit, 20, 100);
      const body: Json = {};
      if (args.query) body.query = String(args.query);
      if (args.type) body.filter = { property: 'object', value: String(args.type) };
      body.sort = { direction: 'descending', timestamp: 'last_edited_time' };
      printJson({ results: await pagedPost('/v1/search', body, limit) });
      break;
    }

    case 'page': {
      if (!args.id) die('Missing --id PAGE_ID');
      const page = await notionApi('GET', `/v1/pages/${args.id}`);
      if (args.content) {
        page.children = await readChildren(String(args.id), boolFlag(args.recursive) === true, intFlag(args.limit, 100, 100));
      }
      printJson(page);
      break;
    }

    case 'blocks': {
      if (!args.id) die('Missing --id PAGE_OR_BLOCK_ID');
      printJson({ results: await readChildren(String(args.id), boolFlag(args.recursive) === true, intFlag(args.limit, 100, 100)) });
      break;
    }

    case 'database': {
      if (!args.id) die('Missing --id DATABASE_ID');
      printJson(await notionApi('GET', `/v1/databases/${args.id}`));
      break;
    }

    case 'data-source': {
      if (!args.id) die('Missing --id DATA_SOURCE_ID');
      printJson(await notionApi('GET', `/v1/data_sources/${args.id}`));
      break;
    }

    case 'query-data-source': {
      if (!args.id) die('Missing --id DATA_SOURCE_ID');
      const body = await jsonArg(args.body, {});
      const limit = intFlag(args.limit, body.page_size || 25, 100);
      printJson({ results: await pagedPost(`/v1/data_sources/${args.id}/query`, body, limit) });
      break;
    }

    case 'create-page': {
      const body: Json = {};
      if (args.parentPage) body.parent = { type: 'page_id', page_id: String(args.parentPage) };
      if (args['parent-page']) body.parent = { type: 'page_id', page_id: String(args['parent-page']) };
      if (args.dataSource) body.parent = { type: 'data_source_id', data_source_id: String(args.dataSource) };
      if (args['data-source']) body.parent = { type: 'data_source_id', data_source_id: String(args['data-source']) };
      if (!body.parent) die('Missing --parent-page PAGE_ID or --data-source DATA_SOURCE_ID');

      if (args.properties) {
        body.properties = await jsonArg(args.properties);
      } else if (args.title) {
        body.properties = titleProperty(String(args.title));
      } else {
        die('Missing --title or --properties JSON');
      }
      if (args.text) body.children = textToBlocks(String(args.text), String(args.type || 'paragraph'));
      if (args.position && body.parent.type === 'page_id') body.position = { type: String(args.position) };
      printJson(await notionApi('POST', '/v1/pages', body));
      break;
    }

    case 'append': {
      if (!args.id) die('Missing --id PAGE_OR_BLOCK_ID');
      let body: Json;
      if (args.body) {
        const rawBody = await jsonArg(args.body);
        body = Array.isArray(rawBody) ? { children: rawBody } : rawBody;
        if (!Array.isArray(body.children)) die('Append body must contain a children array, or be a children array');
      } else {
        if (!args.text) die('Missing --text TEXT or --body JSON');
        body = { children: textToBlocks(String(args.text), String(args.type || 'paragraph')) };
      }
      if (args.after) body.after = String(args.after);
      printJson(await notionApi('PATCH', `/v1/blocks/${args.id}/children`, body));
      break;
    }

    case 'update-page': {
      if (!args.id) die('Missing --id PAGE_ID');
      const body: Json = await jsonArg(args.body, {});
      if (args.properties) body.properties = await jsonArg(args.properties);
      if (args.icon) body.icon = await jsonArg(args.icon);
      if (args.cover) body.cover = await jsonArg(args.cover);
      const archive = boolFlag(args.archive);
      const trash = boolFlag(args.trash);
      const locked = boolFlag(args.lock);
      if (archive !== undefined) body.archived = archive;
      if (trash !== undefined) body.in_trash = trash;
      if (locked !== undefined) body.is_locked = locked;
      printJson(await notionApi('PATCH', `/v1/pages/${args.id}`, body));
      break;
    }

    case 'api': {
      const method = commandArgs[0]?.toUpperCase();
      const path = args._[0];
      if (!method || !path) die('Usage: notion.ts api METHOD /v1/path [--body JSON]');
      const body = method === 'GET' ? undefined : await jsonArg(args.body, {});
      printJson(await notionApi(method, path, body));
      break;
    }

    default:
      die(`Unknown command: ${command}. Run: bun ${join(skillDir, 'scripts', 'notion.ts')} help`);
  }
}

await main();
