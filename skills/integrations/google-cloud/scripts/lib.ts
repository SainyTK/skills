import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const execFileAsync = promisify(execFile);

export const skillDir = resolve(import.meta.dir, '..');
const envPath = join(skillDir, '.env');

await loadDotEnv(envPath);

export type ContextAccount = { email: string; status: string };
export type ContextProject = {
  projectId: string;
  name: string;
  account: string;
  scheduler_timezone?: string | string[];
  scheduler_jobs?: Array<{ name: string; schedule: string; timezone: string }>;
};
export type ContextDataset = { projectId: string; datasetId: string; account: string };
export type ContextService = { name: string; projectId: string; account: string; url: string; type: string };
export type Context = {
  _meta: { last_updated: string; note: string };
  project_context?: unknown;
  accounts: ContextAccount[];
  projects: ContextProject[];
  datasets: ContextDataset[];
  services: ContextService[];
};

export const config = {
  defaultProject: process.env.GCLOUD_DEFAULT_PROJECT || '',
  defaultAccount: process.env.GCLOUD_DEFAULT_ACCOUNT || '',
  contextFile: process.env.GCLOUD_CONTEXT_FILE || join(skillDir, '.data', 'context.json'),
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function die(message: string): never {
  console.error(message);
  process.exit(1);
}

export function print(data: unknown) { console.log(JSON.stringify(data, null, 2)); }

export function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const inlineValueIdx = arg.indexOf('=');
    if (inlineValueIdx > 2) {
      out[arg.slice(2, inlineValueIdx)] = arg.slice(inlineValueIdx + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export type RunResult = { stdout: string; stderr: string; ok: boolean };

export async function run(args: string[], opts: { timeout?: number } = {}): Promise<RunResult> {
  const [cmd, ...cmdArgs] = args;
  try {
    const result = await execFileAsync(cmd!, cmdArgs, {
      timeout: opts.timeout ?? 60_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, ok: true };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || err.message, ok: false };
  }
}

export async function runOrDie(args: string[], opts?: { timeout?: number }): Promise<string> {
  const result = await run(args, opts);
  if (!result.ok) die(`Command failed: ${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

export async function loadContext(): Promise<Context | null> {
  try {
    return JSON.parse(await readFile(config.contextFile, 'utf8'));
  } catch {
    return null;
  }
}

export async function saveContext(ctx: Context): Promise<void> {
  await mkdir(dirname(config.contextFile), { recursive: true });
  await writeFile(config.contextFile, JSON.stringify(ctx, null, 2) + '\n');
}

export function resolveProject(explicit?: string | boolean, ctx?: Context | null): string {
  if (explicit && typeof explicit === 'string') return explicit;
  if (config.defaultProject) return config.defaultProject;
  if (ctx?.projects && ctx.projects.length === 1) return ctx.projects[0].projectId;
  die('No project specified. Pass --project PROJECT_ID, set GCLOUD_DEFAULT_PROJECT in .env, or run: bun .agents/skills/google-cloud/scripts/gcloud.ts refresh-context');
}

export function accountArgs(account?: string | boolean): string[] {
  const email = typeof account === 'string' ? account : config.defaultAccount;
  return email ? [`--account=${email}`] : [];
}

export type Target = { project: string; account?: string };
export type TableTarget = Target & { table: string; dataset: string; tableId?: string };

function valueOf(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function matchText(value: string, query: string): boolean {
  return value.toLowerCase() === query.toLowerCase() || value.toLowerCase().includes(query.toLowerCase());
}

function requireOne<T>(items: T[], label: string, query: string, describe: (item: T) => string): T {
  if (items.length === 1) return items[0]!;
  if (items.length === 0) die(`No ${label} matched "${query}". Run refresh-context or pass --project explicitly.`);
  die(`Multiple ${label} values matched "${query}": ${items.map(describe).join(', ')}. Pass --project explicitly.`);
}

export function accountForProject(project: string, ctx?: Context | null, explicitAccount?: string | boolean): string | undefined {
  const explicit = valueOf(explicitAccount);
  if (explicit) return explicit;
  if (config.defaultAccount) return config.defaultAccount;
  const matches = (ctx?.projects || []).filter(p => p.projectId === project);
  const accounts = [...new Set(matches.map(p => p.account).filter(Boolean))];
  return accounts.length === 1 ? accounts[0] : undefined;
}

export function resolveProjectTarget(args: Record<string, string | boolean>, ctx?: Context | null): Target {
  const explicitProject = valueOf(args.project);
  if (explicitProject) return { project: explicitProject, account: accountForProject(explicitProject, ctx, args.account) };
  if (config.defaultProject) return { project: config.defaultProject, account: accountForProject(config.defaultProject, ctx, args.account) };
  if (ctx?.projects && ctx.projects.length === 1) {
    return { project: ctx.projects[0]!.projectId, account: accountForProject(ctx.projects[0]!.projectId, ctx, args.account) };
  }
  return { project: resolveProject(args.project, ctx), account: accountForProject(resolveProject(args.project, ctx), ctx, args.account) };
}

export function resolveDatasetTarget(
  dataset: string | boolean | undefined,
  args: Record<string, string | boolean>,
  ctx?: Context | null,
): Target & { dataset: string } {
  const datasetId = valueOf(dataset) || die('Missing --dataset DATASET_ID');
  const explicitProject = valueOf(args.project);
  if (explicitProject) return { project: explicitProject, dataset: datasetId, account: accountForProject(explicitProject, ctx, args.account) };
  const matches = (ctx?.datasets || []).filter(d => matchText(d.datasetId, datasetId));
  if (matches.length > 0) {
    const match = requireOne(matches, 'datasets', datasetId, d => `${d.projectId}.${d.datasetId}`);
    return { project: match.projectId, dataset: match.datasetId, account: valueOf(args.account) || config.defaultAccount || match.account };
  }
  const target = resolveProjectTarget(args, ctx);
  return { ...target, dataset: datasetId };
}

export function resolveTableTarget(
  table: string | boolean | undefined,
  args: Record<string, string | boolean>,
  ctx?: Context | null,
): TableTarget {
  const rawTable = valueOf(table) || die('Missing --table DATASET.TABLE');
  const parts = rawTable.split('.');
  if (parts.length === 3) {
    const [project, dataset, tableId] = parts as [string, string, string];
    return { project, dataset, table: `${dataset}.${tableId}`, tableId, account: accountForProject(project, ctx, args.account) };
  }
  if (parts.length === 2) {
    const [dataset, tableId] = parts as [string, string];
    const target = resolveDatasetTarget(dataset, args, ctx);
    return { ...target, table: `${target.dataset}.${tableId}`, tableId };
  }
  die('Table must be DATASET.TABLE or PROJECT.DATASET.TABLE');
}

export function resolveServiceTarget(
  service: string | boolean | undefined,
  args: Record<string, string | boolean>,
  ctx?: Context | null,
): Target & { service?: string } {
  const serviceName = valueOf(service);
  const explicitProject = valueOf(args.project);
  if (!serviceName) return resolveProjectTarget(args, ctx);
  if (explicitProject) return { project: explicitProject, service: serviceName, account: accountForProject(explicitProject, ctx, args.account) };
  const matches = (ctx?.services || []).filter(s => matchText(s.name, serviceName));
  if (matches.length > 0) {
    const match = requireOne(matches, 'services', serviceName, s => `${s.projectId}/${s.name}`);
    return { project: match.projectId, service: match.name, account: valueOf(args.account) || config.defaultAccount || match.account };
  }
  const target = resolveProjectTarget(args, ctx);
  return { ...target, service: serviceName };
}

export async function withGcloudAccount<T>(account: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!account) return await fn();
  const active = await run(['gcloud', 'config', 'get-value', 'account']);
  const previous = active.stdout.trim();
  if (previous !== account) await runOrDie(['gcloud', 'config', 'set', 'account', account]);
  try {
    return await fn();
  } finally {
    if (previous && previous !== account) await run(['gcloud', 'config', 'set', 'account', previous]);
  }
}
