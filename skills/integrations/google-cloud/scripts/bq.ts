import {
  die,
  loadContext,
  print,
  resolveDatasetTarget,
  resolveProjectTarget,
  resolveTableTarget,
  runOrDie,
  withGcloudAccount,
} from './lib.ts';

type Args = Record<string, string | boolean>;

export async function listDatasets(args: Args): Promise<void> {
  const ctx = await loadContext();
  const target = resolveProjectTarget(args, ctx);
  const result = await withGcloudAccount(target.account, () => runOrDie([
      'bq', 'ls',
      `--project_id=${target.project}`,
      '--max_results=1000',
      '--format=prettyjson',
    ]));
  let datasets: unknown[] = [];
  try {
    const items = JSON.parse(result || '[]');
    datasets = items.map((item: any) => ({
      datasetId: item.datasetReference?.datasetId,
      projectId: item.datasetReference?.projectId,
      location: item.location,
    }));
  } catch {}
  print({ project: target.project, account: target.account || null, datasets });
}

export async function listTables(args: Args): Promise<void> {
  const ctx = await loadContext();
  const target = resolveDatasetTarget(args.dataset, args, ctx);
  const result = await withGcloudAccount(target.account, () => runOrDie([
      'bq', 'ls',
      `--project_id=${target.project}`,
      '--max_results=1000',
      '--format=prettyjson',
      target.dataset,
    ]));
  let tables: unknown[] = [];
  try {
    const items = JSON.parse(result || '[]');
    tables = items.map((item: any) => ({
      tableId: item.tableReference?.tableId,
      type: item.type,
    }));
  } catch {}
  print({ project: target.project, account: target.account || null, dataset: target.dataset, tables });
}

export async function showTable(args: Args): Promise<void> {
  const ctx = await loadContext();
  const target = resolveTableTarget(args.table, args, ctx);
  const result = await withGcloudAccount(target.account, () => runOrDie([
      'bq', 'show',
      `--project_id=${target.project}`,
      '--format=prettyjson',
      target.table,
    ]));
  const data = JSON.parse(result);
  print({
    tableId: data.tableReference?.tableId,
    dataset: data.tableReference?.datasetId,
    project: data.tableReference?.projectId,
    type: data.type,
    numRows: data.numRows,
    numBytes: data.numBytes,
    location: data.location,
    schema: data.schema?.fields?.map((f: any) => ({
      name: f.name,
      type: f.type,
      mode: f.mode,
      description: f.description,
    })),
    timePartitioning: data.timePartitioning,
    clustering: data.clustering,
    creationTime: data.creationTime,
    lastModifiedTime: data.lastModifiedTime,
  });
}

export async function headRows(args: Args): Promise<void> {
  const ctx = await loadContext();
  const target = resolveTableTarget(args.table, args, ctx);
  const cmd = [
    'bq', 'head',
    `--project_id=${target.project}`,
    `--max_rows=${args.rows || '20'}`,
  ];
  if (args.fields) cmd.push(`--selected_fields=${args.fields}`);
  cmd.push(target.table);
  const result = await withGcloudAccount(target.account, () => runOrDie(cmd));
  console.log(result);
}

export async function runBqQuery(args: Args): Promise<void> {
  if (!args.sql) die('Missing --sql "SELECT ..."');
  const ctx = await loadContext();
  const target = resolveProjectTarget(args, ctx);
  const sql = String(args.sql);

  if (!args.execute) {
    console.error('[dry-run] Estimating cost only. Pass --execute to run. Bytes to be processed:');
    const result = await withGcloudAccount(target.account, () => runOrDie([
      'bq', 'query',
      `--project_id=${target.project}`,
      '--use_legacy_sql=false',
      '--dry_run',
      sql,
    ]));
    console.log(result);
    return;
  }

  const result = await withGcloudAccount(target.account, () => runOrDie([
    'bq', 'query',
    `--project_id=${target.project}`,
    '--use_legacy_sql=false',
    `--max_rows=${args.rows || '100'}`,
    `--maximum_bytes_billed=${args.bytes || '1000000000'}`,
    sql,
  ]));
  console.log(result);
}

export async function listJobs(args: Args): Promise<void> {
  const ctx = await loadContext();
  const target = resolveProjectTarget(args, ctx);
  const cmd = [
    'bq', 'ls',
    `--project_id=${target.project}`,
    '--jobs',
    '--all',
    `--max_results=${args.limit || '50'}`,
  ];
  if (args.filter) cmd.push(`--filter=${args.filter}`);
  const result = await withGcloudAccount(target.account, () => runOrDie(cmd));
  console.log(result);
}

export async function showJob(args: Args): Promise<void> {
  if (!args.job) die('Missing --job JOB_ID');
  const ctx = await loadContext();
  const target = resolveProjectTarget(args, ctx);
  const cmd = [
    'bq', 'show',
    `--project_id=${target.project}`,
    '--job',
    '--format=prettyjson',
  ];
  if (args.location) cmd.push(`--location=${args.location}`);
  cmd.push(String(args.job));
  const result = await withGcloudAccount(target.account, () => runOrDie(cmd));
  const data = JSON.parse(result);
  print({
    jobId: data.jobReference?.jobId,
    state: data.status?.state,
    error: data.status?.errorResult,
    errors: data.status?.errors,
    creationTime: data.statistics?.creationTime,
    startTime: data.statistics?.startTime,
    endTime: data.statistics?.endTime,
    totalBytesProcessed: data.statistics?.query?.totalBytesProcessed,
    totalBytesBilled: data.statistics?.query?.totalBytesBilled,
    statementType: data.statistics?.query?.statementType,
    query: data.configuration?.query?.query,
  });
}

export async function headJobRows(args: Args): Promise<void> {
  if (!args.job) die('Missing --job JOB_ID');
  const ctx = await loadContext();
  const target = resolveProjectTarget(args, ctx);
  const cmd = [
    'bq', 'head',
    `--project_id=${target.project}`,
    '--job',
    `--max_rows=${args.rows || '100'}`,
  ];
  if (args.location) cmd.push(`--location=${args.location}`);
  cmd.push(String(args.job));
  const result = await withGcloudAccount(target.account, () => runOrDie(cmd));
  console.log(result);
}
