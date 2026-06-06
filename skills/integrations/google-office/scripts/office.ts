#!/usr/bin/env bun
import { die, handleAuthCmd, parseArgs, resolveEmail } from './lib';
import { handleDriveCmd } from './google-drive';
import { handleSheetCmd } from './google-sheet';
import { handleDocCmd } from './google-doc';

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const email = typeof args.email === 'string' ? args.email : undefined;

  if (cmd === 'help') {
    console.log(`Usage: bun .agents/skills/google-office/scripts/office.ts <command> [options]

Auth:    status | login | accounts | default-account --email E | logout [--email E]
Drive:   drive-list [--query Q] [--limit N]
         drive-get --id ID
         drive-download --id ID [--output PATH] [--export-mime MIME]
         drive-create-folder --name NAME [--parent ID]
         drive-upload --file PATH [--name NAME] [--parent ID] [--mime MIME]
         drive-delete --id ID [--hard]
Sheets:  sheets-get --id ID
         sheets-read --id ID --range A1
         sheets-write --id ID --range A1 --values JSON-or-path [--raw]
         sheets-append --id ID --range A1 --values JSON-or-path [--raw]
         sheets-create --title TITLE
         sheets-format --id ID --requests JSON-or-path
Docs:    docs-get --id ID
         docs-create --title TITLE [--text TEXT]
         docs-append --id ID --text TEXT
         docs-format --id ID
         docs-insert-table --id ID --values JSON-or-path [--index N]
         docs-insert-image --id ID --url URL [--width PT] [--height PT] [--index N]
         docs-insert-image --id ID --file PATH [--width PT] [--height PT] [--index N]
`);
    return;
  }

  if (await handleAuthCmd(cmd, args)) return;

  const resolved = await resolveEmail(email);
  if (await handleDriveCmd(cmd, args, resolved)) return;
  if (await handleSheetCmd(cmd, args, resolved)) return;
  if (await handleDocCmd(cmd, args, resolved)) return;

  die(`Unknown command: ${cmd}`);
}

main().catch((err) => die(err.stack || err.message || String(err)));
