#!/usr/bin/env node
// Helper for scripts/vulgarity-audit.mjs: run the LIVE src/lib/filter.ts over a list of labels
// in a FRESH process, so the audit can compare filter output before vs after it patches the file
// (ESM caches modules, so re-importing in one process would return the stale pre-patch filter).
//
//     node scripts/_filter-eval.mjs <labels.json>
//
// Reads a JSON array of strings, prints a JSON array of checkContent() results (null = clean,
// else the reason string), same order. Needs Node 24+ (imports the .ts filter via type stripping).

import { readFileSync } from 'node:fs';
import { checkContent } from '../src/lib/filter.ts';

const labels = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(labels.map((l) => checkContent(l))));
