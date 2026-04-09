// Reads trace.json / types.json files produced by `tsc --generateTrace`
// and turns them into a flat list of spans plus per-phase totals.
//
// The trace uses Chrome Trace Event Format: events with ph:"X" are complete
// (have dur), while ph:"B" / ph:"E" pairs wrap begin/end around child work.
// We only count a small allow-list of "marker" event names toward phase
// totals to avoid double-counting parent + child durations.

import { readFileSync, readdirSync, existsSync } from "node:fs";

export function findTraceFiles(dir) {
  const files = readdirSync(dir);
  const traceFiles = files
    .filter((f) => /^trace(\.\d+)?\.json$/.test(f))
    .sort();
  const typesFiles = files
    .filter((f) => /^types(\.\d+)?\.json$/.test(f))
    .sort();
  return { traceFiles, typesFiles };
}

export function loadTypes(typesFile) {
  const typesMap = new Map();
  if (!typesFile || !existsSync(typesFile)) return typesMap;
  try {
    const types = JSON.parse(readFileSync(typesFile, "utf-8"));
    for (const t of types) {
      typesMap.set(t.id, t);
    }
  } catch {
    // types.json may be malformed or missing
  }
  return typesMap;
}

export function parseTrace(traceFile) {
  const raw = readFileSync(traceFile, "utf-8");
  let events;
  try {
    events = JSON.parse(raw);
  } catch {
    // Try to handle truncated JSON (common with large traces)
    const trimmed = raw.replace(/,?\s*$/, "]");
    events = JSON.parse(trimmed);
  }

  const spans = [];
  const stack = [];
  // Track top-level phase durations from specific marker events only
  const phaseTimes = { parse: 0, bind: 0, check: 0, emit: 0 };
  const phaseMarkers = {
    checkSourceFile: "check",
    bindSourceFile: "bind",
    parseSourceFile: "parse",
    createSourceFile: "parse",
    emitDeclarationFileOrBundle: "emit",
    emitJsFileOrBundle: "emit",
    emit: "emit",
  };
  const filesChecked = new Set();

  for (const ev of events) {
    if (ev.ph === "X") {
      // Complete event — has dur field (in microseconds)
      const durMs = ev.dur / 1000;
      const cat = ev.cat || "";

      // Only count top-level phase markers to avoid double-counting
      if (ev.name in phaseMarkers) {
        phaseTimes[phaseMarkers[ev.name]] += durMs;
      }

      const filePath = ev.args?.path;
      if (filePath) filesChecked.add(filePath);

      spans.push({
        name: ev.name,
        cat,
        durMs,
        file: filePath || null,
        pos: ev.args?.pos,
        end: ev.args?.end,
        args: ev.args || {},
      });
    } else if (ev.ph === "B") {
      stack.push(ev);
    } else if (ev.ph === "E") {
      const begin = stack.pop();
      if (begin) {
        const durMs = (ev.ts - begin.ts) / 1000;
        const cat = begin.cat || ev.cat || "";
        const name = begin.name || ev.name;

        if (name in phaseMarkers) {
          phaseTimes[phaseMarkers[name]] += durMs;
        }

        const mergedArgs = { ...begin.args, ...ev.args };
        const filePath = mergedArgs.path;
        if (filePath) filesChecked.add(filePath);

        spans.push({
          name,
          cat,
          durMs,
          file: filePath || null,
          pos: mergedArgs.pos,
          end: mergedArgs.end,
          args: mergedArgs,
        });
      }
    }
  }

  return { spans, phaseTimes, filesChecked };
}
