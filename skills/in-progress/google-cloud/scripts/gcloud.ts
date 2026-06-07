#!/usr/bin/env bun
import { run, runOrDie, die, print, parseArgs, config, loadContext, saveContext, type Context } from './lib.ts';
import * as bq from './bq.ts';
import * as log from './log.ts';

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'help') {
    console.log(`Usage: bun .agents/skills/google-cloud/scripts/gcloud.ts <command> [options]

Auth / context:
  status
  accounts
  use-account --account EMAIL
  projects [--account EMAIL]
  refresh-context

BigQuery:
  bq-datasets [--project P]
  bq-tables --dataset DS [--project P]
  bq-schema --table DS.TABLE [--project P]
  bq-head --table DS.TABLE [--rows N] [--fields f1,f2] [--project P]
  bq-query --sql "SELECT ..." [--project P] [--execute] [--rows N] [--bytes N]
  bq-jobs [--project P] [--limit N] [--filter STATES]
  bq-job --job JOB_ID [--project P] [--location LOC]

Logging:
  log-read [--service S] [--project P] [--severity LEVEL] [--keyword K]
           [--from UTC] [--to UTC] [--freshness 1h] [--limit N] [--order asc|desc]
           [--filter RAW_FILTER] [--resource-type TYPE] [--user EMAIL] [--status CODE]
           [--request-id ID]
  log-errors [--service S] [--project P] [--freshness 24h] [--limit N]

Common flags: --account EMAIL  (overrides active gcloud account for that call)
              --project PROJECT_ID  (overrides default project)
`);
    return;
  }

  switch (cmd) {
    case 'status': await cmdStatus(); break;
    case 'accounts': await cmdAccounts(); break;
    case 'use-account': await cmdUseAccount(args); break;
    case 'projects': await cmdProjects(args); break;
    case 'refresh-context': await cmdRefreshContext(); break;

    case 'bq-datasets': await bq.listDatasets(args); break;
    case 'bq-tables': await bq.listTables(args); break;
    case 'bq-schema':
    case 'bq-show': await bq.showTable(args); break;
    case 'bq-head': await bq.headRows(args); break;
    case 'bq-query': await bq.runBqQuery(args); break;
    case 'bq-jobs': await bq.listJobs(args); break;
    case 'bq-job': await bq.showJob(args); break;

    case 'log-read': await log.readLogs(args); break;
    case 'log-errors': await log.readErrors(args); break;

    default: die(`Unknown command: ${cmd}. Run with 'help' to see available commands.`);
  }
}

async function cmdStatus(): Promise<void> {
  const activeAccount = await run(['gcloud', 'config', 'get-value', 'account']);
  const activeProject = await run(['gcloud', 'config', 'get-value', 'project']);
  const ctx = await loadContext();
  print({
    activeAccount: activeAccount.stdout.trim() || null,
    activeProject: activeProject.stdout.trim() || null,
    defaultAccountFromEnv: config.defaultAccount || null,
    defaultProjectFromEnv: config.defaultProject || null,
    contextFile: config.contextFile,
    contextLastUpdated: ctx?._meta?.last_updated || null,
    accountsInContext: ctx?.accounts?.length ?? 0,
    projectsInContext: ctx?.projects?.length ?? 0,
    datasetsInContext: ctx?.datasets?.length ?? 0,
    servicesInContext: ctx?.services?.length ?? 0,
  });
}

async function cmdAccounts(): Promise<void> {
  const result = await runOrDie(['gcloud', 'auth', 'list', '--format=json']);
  print(JSON.parse(result));
}

async function cmdUseAccount(args: Record<string, string | boolean>): Promise<void> {
  const account = typeof args.account === 'string' ? args.account : die('Missing --account EMAIL');
  await runOrDie(['gcloud', 'config', 'set', 'account', account]);
  print({ activeAccount: account });
}

async function cmdProjects(args: Record<string, string | boolean>): Promise<void> {
  const cmd = ['gcloud', 'projects', 'list', '--format=json'];
  if (typeof args.account === 'string') cmd.push(`--account=${args.account}`);
  const result = await runOrDie(cmd);
  const projects = JSON.parse(result);
  print(projects.map((p: any) => ({ projectId: p.projectId, name: p.name, state: p.lifecycleState })));
}

const SCHEDULER_REGIONS = [
  'asia-southeast1', 'asia-east1', 'asia-northeast1',
  'us-central1', 'us-east1', 'europe-west1',
];

async function getSchedulerJobs(projectId: string, account: string) {
  for (const region of SCHEDULER_REGIONS) {
    const result = await run([
      'gcloud', 'scheduler', 'jobs', 'list',
      `--project=${projectId}`,
      `--account=${account}`,
      `--location=${region}`,
      '--format=value(name,schedule,timeZone)',
    ]);
    if (result.ok && result.stdout.trim()) {
      return result.stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name = '', schedule = '', timezone = ''] = line.split('\t');
        return { name: name.trim(), schedule: schedule.trim(), timezone: timezone.trim() };
      });
    }
  }
  return [];
}

async function cmdRefreshContext(): Promise<void> {
  console.error('Discovering accounts...');
  const accountsResult = await runOrDie(['gcloud', 'auth', 'list', '--format=value(account,status)']);
  const accounts: Context['accounts'] = accountsResult.trim().split('\n').filter(Boolean).map(line => {
    const [email = '', status = ''] = line.split('\t');
    return { email: email.trim(), status: status.trim().replace('*', '').trim() };
  }).filter(a => a.email);

  const projects: Context['projects'] = [];
  const datasets: Context['datasets'] = [];
  const services: Context['services'] = [];
  const seenProjects = new Set<string>();
  const seenDatasets = new Set<string>();
  const seenServices = new Set<string>();

  for (const account of accounts) {
    console.error(`  [${account.email}] fetching projects...`);
    const projResult = await run([
      'gcloud', 'projects', 'list',
      `--account=${account.email}`,
      '--format=value(projectId,name)',
    ]);
    if (!projResult.ok) continue;

    const accountProjects: string[] = [];
    for (const line of projResult.stdout.trim().split('\n').filter(Boolean)) {
      const [projectId = '', name = ''] = line.split('\t');
      const pid = projectId.trim();
      const pname = name.trim() || pid;
      if (!pid || pid.startsWith('gen-lang') || pid.startsWith('sys-')) continue;
      const key = `${pid}:${account.email}`;
      if (seenProjects.has(key)) continue;
      seenProjects.add(key);
      projects.push({ projectId: pid, name: pname, account: account.email });
      accountProjects.push(pid);
    }

    for (const pid of accountProjects) {
      console.error(`    [${pid}] fetching datasets...`);
      const dsResult = await run([
        'bq', '--format=prettyjson', 'ls',
        `--project_id=${pid}`,
        '--max_results=1000',
      ]);
      if (dsResult.ok && dsResult.stdout.trim()) {
        try {
          for (const item of JSON.parse(dsResult.stdout)) {
            const datasetId = item.datasetReference?.datasetId?.trim();
            if (!datasetId) continue;
            const key = `${pid}:${datasetId}`;
            if (seenDatasets.has(key)) continue;
            seenDatasets.add(key);
            datasets.push({ projectId: pid, datasetId, account: account.email });
          }
        } catch {}
      }

      console.error(`    [${pid}] fetching Cloud Run services...`);
      const svcResult = await run([
        'gcloud', 'run', 'services', 'list',
        `--project=${pid}`,
        `--account=${account.email}`,
        '--format=value(metadata.name,status.url)',
      ]);
      if (svcResult.ok && svcResult.stdout.trim()) {
        for (const line of svcResult.stdout.trim().split('\n').filter(Boolean)) {
          const [sname = '', surl = ''] = line.split('\t');
          const name = sname.trim();
          if (!name) continue;
          const key = `${name}:${pid}`;
          if (seenServices.has(key)) continue;
          seenServices.add(key);
          services.push({ name, projectId: pid, account: account.email, url: surl.trim(), type: 'cloud_run' });
        }
      }

      console.error(`    [${pid}] fetching scheduler jobs...`);
      const jobs = await getSchedulerJobs(pid, account.email);
      if (jobs.length > 0) {
        const proj = projects.find(p => p.projectId === pid);
        if (proj) {
          const timezones = [...new Set(jobs.map(j => j.timezone).filter(Boolean))];
          proj.scheduler_timezone = timezones.length === 1 ? timezones[0] : timezones;
          proj.scheduler_jobs = jobs;
        }
      }
    }
  }

  const ctx: Context = {
    _meta: {
      last_updated: new Date().toISOString().slice(0, 10),
      note: 'Auto-generated. Run refresh-context to update. Edit manually if needed — changes are preserved across project/service discovery but not across a full refresh.',
    },
    accounts,
    projects,
    datasets,
    services,
  };

  await saveContext(ctx);
  print({
    contextFile: config.contextFile,
    accounts: accounts.length,
    projects: projects.length,
    datasets: datasets.length,
    services: services.length,
  });
  console.error(`Written: ${config.contextFile}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
