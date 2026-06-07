import { runOrDie, resolveProject, accountArgs, loadContext } from './lib.ts';

type Args = Record<string, string | boolean>;

// --format=json fails on log payloads with control characters; value() is safe
const LOG_FORMAT = 'value(timestamp,severity,textPayload,jsonPayload.message)';

function buildFilter(args: Args): string {
  const parts: string[] = [];
  const resourceType = typeof args['resource-type'] === 'string' ? args['resource-type'] : 'cloud_run_revision';
  parts.push(`resource.type="${resourceType}"`);
  if (args.service) parts.push(`resource.labels.service_name="${args.service}"`);
  if (args.severity) parts.push(`severity>=${args.severity}`);
  if (args.keyword) parts.push(`textPayload:"${args.keyword}"`);
  if (args.user) parts.push(`protoPayload.authenticationInfo.principalEmail="${args.user}"`);
  if (args['request-id']) parts.push(`labels."run.googleapis.com/request_id"="${args['request-id']}"`);
  if (args.from) parts.push(`timestamp>="${args.from}"`);
  if (args.to) parts.push(`timestamp<="${args.to}"`);
  if (args.status) parts.push(`httpRequest.status>=${args.status}`);
  if (typeof args.filter === 'string') parts.push(args.filter);
  return parts.join(' AND ');
}

export async function readLogs(args: Args): Promise<void> {
  const ctx = await loadContext();
  const project = resolveProject(args.project, ctx);
  const filter = buildFilter(args);

  const cmd = [
    'gcloud', 'logging', 'read',
    filter,
    `--project=${project}`,
    `--limit=${args.limit || '50'}`,
    `--format=${LOG_FORMAT}`,
    `--order=${args.order || 'desc'}`,
    ...accountArgs(args.account),
  ];

  if (!args.from && !args.to) cmd.push(`--freshness=${args.freshness || '1h'}`);

  const result = await runOrDie(cmd);
  console.log(result || '(no log entries found)');
}

export async function readErrors(args: Args): Promise<void> {
  await readLogs({ ...args, severity: 'ERROR', freshness: args.freshness || '24h', limit: args.limit || '100' });
}
