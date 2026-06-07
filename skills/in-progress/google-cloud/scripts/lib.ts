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
