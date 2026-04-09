#!/usr/bin/env node

// TypeScript compiler trace analyzer — entry point.
//
// Parses `tsc --generateTrace` output and produces a structured JSON report
// on stdout. Progress and errors go to stderr so stdout stays pipeable.
//
// This file is orchestration only. The actual work lives in ./lib/*.mjs,
// which is zero-dep ESM and runs unchanged on Node.js, Bun, or Deno.

import { join } from "node:path";

import { parseArgs, validateTraceDir, printTraceFileSizes } from "./lib/cli.mjs";
import {
  findTraceFiles,
  loadTypes,
  parseTrace,
} from "./lib/trace-parser.mjs";
import { createSourceMap } from "./lib/source-map.mjs";
import { analyzeSpans } from "./lib/aggregate.mjs";
import { detectDuplicatePackages } from "./lib/duplicates.mjs";
import { createTryRelative, round } from "./lib/util.mjs";

// 1. Parse CLI args (may print help and exit).
const { traceDir, topN, projectRoot } = parseArgs(process.argv);

// 2. Make sure the given path exists and is a directory before we do anything.
validateTraceDir(traceDir);

// 3. Discover the trace.json / types.json files. Bail early with a helpful
//    message if the directory is empty of traces.
const { traceFiles, typesFiles } = findTraceFiles(traceDir);

if (traceFiles.length === 0) {
  console.error(
    `Error: no trace.json files found in ${traceDir}\n` +
      `Hint: expected files like trace.json / types.json (optionally numbered). ` +
      `Did tsc crash before writing the trace?`
  );
  process.exit(1);
}

// 4. Show the user what we're about to read and how big it is (stderr).
printTraceFileSizes(traceDir, traceFiles, typesFiles);

function main() {
  // Accumulators shared across every trace/types file pair.
  let allSpans = [];
  let totalPhaseTimes = { parse: 0, bind: 0, check: 0, emit: 0 };
  let allFilesChecked = new Set();
  let typesMap = new Map();

  // Per-run helpers that depend on projectRoot / a fresh line-map cache.
  const tryRelative = createTryRelative(projectRoot);
  const { resolveLocation, extractSnippet } = createSourceMap();

  // Read every trace.json (and its matching types.json, if any), merging
  // spans, phase totals, files-checked set, and the type id lookup.
  for (let i = 0; i < traceFiles.length; i++) {
    const tracePath = join(traceDir, traceFiles[i]);
    const { spans, phaseTimes, filesChecked } = parseTrace(tracePath);

    allSpans = allSpans.concat(spans);
    for (const [k, v] of Object.entries(phaseTimes)) {
      totalPhaseTimes[k] += v;
    }
    for (const f of filesChecked) allFilesChecked.add(f);

    // Load corresponding types file if it exists
    if (typesFiles[i]) {
      const tMap = loadTypes(join(traceDir, typesFiles[i]));
      for (const [id, t] of tMap) typesMap.set(id, t);
    }
  }

  // Summary time is just the sum of the four phase totals.
  const totalTimeMs =
    totalPhaseTimes.parse +
    totalPhaseTimes.bind +
    totalPhaseTimes.check +
    totalPhaseTimes.emit;

  // Rank the hotspots and look for duplicated node_modules packages.
  const { hotspotsByFile, hotspotsBySpan } = analyzeSpans(
    allSpans,
    typesMap,
    topN,
    { tryRelative, resolveLocation, extractSnippet }
  );
  const duplicatePackages = detectDuplicatePackages(
    allFilesChecked,
    tryRelative
  );

  // Assemble the final report and write it to stdout as pretty JSON.
  const output = {
    summary: {
      totalTimeMs: round(totalTimeMs),
      parseMs: round(totalPhaseTimes.parse),
      bindMs: round(totalPhaseTimes.bind),
      checkMs: round(totalPhaseTimes.check),
      emitMs: round(totalPhaseTimes.emit),
      fileCount: allFilesChecked.size,
    },
    hotspotsByFile,
    hotspotsBySpan,
    duplicatePackages,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
