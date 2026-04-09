// Aggregation: turn the flat list of spans into the two hotspot rankings
// (by file, by individual span) and resolve type info from types.json.

import { round } from "./util.mjs";

// Container/wrapper events that aren't directly actionable on their own
export const CONTAINER_EVENTS = new Set([
  "createProgram",
  "processRootFiles",
  "findSourceFile",
  "emit",
  "printSourceFile",
]);

export function analyzeSpans(
  spans,
  typesMap,
  topN,
  { tryRelative, resolveLocation, extractSnippet }
) {
  // Top N individual spans by duration, excluding broad container events
  const topSpans = spans
    .filter((s) => s.durMs > 0 && !CONTAINER_EVENTS.has(s.name))
    .sort((a, b) => b.durMs - a.durMs)
    .slice(0, topN);

  // Aggregate check time by file — use only top-level checkSourceFile spans
  // (not every nested check span) to avoid counting the same work 4–5× over.
  const fileTimeMap = new Map();
  for (const s of spans) {
    if (s.name === "checkSourceFile" && s.file) {
      fileTimeMap.set(s.file, (fileTimeMap.get(s.file) || 0) + s.durMs);
    }
  }

  const totalCheckMs = Array.from(fileTimeMap.values()).reduce(
    (a, b) => a + b,
    0
  );

  const hotspotsByFile = Array.from(fileTimeMap.entries())
    .map(([file, ms]) => ({
      file: tryRelative(file),
      totalCheckMs: round(ms),
      percentOfTotal: totalCheckMs > 0 ? round((ms / totalCheckMs) * 100) : 0,
    }))
    .sort((a, b) => b.totalCheckMs - a.totalCheckMs)
    .slice(0, topN);

  // Build detailed hotspot entries
  const hotspotsBySpan = topSpans.map((s, i) => {
    const entry = {
      rank: i + 1,
      event: s.name,
      category: s.cat,
      durationMs: round(s.durMs),
      file: s.file ? tryRelative(s.file) : null,
      location: null,
      snippet: null,
    };

    if (s.file && s.pos != null && s.end != null) {
      entry.location = resolveLocation(s.file, s.pos, s.end);
      entry.snippet = extractSnippet(s.file, s.pos, s.end);
    }

    // Resolve type info for type-related events
    if (s.args.sourceId != null && typesMap.has(s.args.sourceId)) {
      entry.sourceType = formatType(typesMap.get(s.args.sourceId), { tryRelative });
    }
    if (s.args.targetId != null && typesMap.has(s.args.targetId)) {
      entry.targetType = formatType(typesMap.get(s.args.targetId), { tryRelative });
    }
    if (
      s.args.id != null &&
      !entry.sourceType &&
      typesMap.has(s.args.id)
    ) {
      entry.type = formatType(typesMap.get(s.args.id), { tryRelative });
    }

    return entry;
  });

  return { hotspotsByFile, hotspotsBySpan };
}

// Note: types.json firstDeclaration.start/end are already {line, character}
// objects (not raw char offsets like trace.json args.pos/end), so we read
// the line directly instead of going through resolveLocation.
export function formatType(typeEntry, { tryRelative }) {
  if (!typeEntry) return null;
  const result = {
    id: typeEntry.id,
    name: typeEntry.symbolName || typeEntry.display || `type#${typeEntry.id}`,
  };
  if (typeEntry.firstDeclaration) {
    result.declarationFile = tryRelative(typeEntry.firstDeclaration.path);
    if (typeEntry.firstDeclaration.start?.line != null) {
      result.declarationLine = typeEntry.firstDeclaration.start.line;
    }
  }
  return result;
}
