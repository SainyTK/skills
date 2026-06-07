#!/usr/bin/env bun
// Apply formal styling (Poppins + Inter, colours, spacing, margins) to any Google Doc.
//
// Usage:
//   bun apply-style.ts --id DOC_ID
//   bun apply-style.ts --id DOC_ID --email you@example.com
//
// The script reads style tokens from style.config.ts — edit that file to change
// fonts, colours, or spacing globally.

import { parseArgs, print, resolveEmail } from '../lib';
import { applyFormalStyle } from './doc-utils';

const args  = parseArgs(process.argv.slice(2));
const docId = typeof args.id === 'string' ? args.id : null;

if (!docId) {
  console.error('Missing --id DOC_ID');
  console.error('Usage: bun apply-style.ts --id DOC_ID [--email EMAIL]');
  process.exit(1);
}

const email  = await resolveEmail(typeof args.email === 'string' ? args.email : undefined);
const result = await applyFormalStyle(email, docId);
print({ success: true, docId, email, ...result });
