// Source-file line map cache and offset→line:col conversion.
//
// Trace files reference source positions as raw character offsets. To map
// these back to human-friendly line/column pairs (and to pull a snippet of
// the relevant code), we read each referenced file once, precompute the
// array of line starts, and binary-search it on lookup.

import { readFileSync } from "node:fs";

// Factory so each analyzer run gets its own cache and stays self-contained.
export function createSourceMap() {
  const lineMapCache = new Map();

  function getLineMap(filePath) {
    if (lineMapCache.has(filePath)) return lineMapCache.get(filePath);
    try {
      const text = readFileSync(filePath, "utf-8");
      const lineStarts = [0];
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
          lineStarts.push(i + 1);
        }
      }
      const entry = { lineStarts, text };
      lineMapCache.set(filePath, entry);
      return entry;
    } catch {
      return null;
    }
  }

  function offsetToLineCol(lineStarts, offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - lineStarts[lo] + 1 };
  }

  function resolveLocation(filePath, pos, end) {
    const map = getLineMap(filePath);
    if (!map) return null;
    const start = offsetToLineCol(map.lineStarts, pos);
    const endLoc = offsetToLineCol(map.lineStarts, end);
    return {
      line: start.line,
      col: start.col,
      endLine: endLoc.line,
      endCol: endLoc.col,
    };
  }

  function extractSnippet(filePath, pos, end) {
    const map = getLineMap(filePath);
    if (!map) return null;
    const maxLen = 150;
    const snippetEnd = Math.min(end, pos + maxLen);
    let snippet = map.text.slice(pos, snippetEnd).replace(/\s+/g, " ").trim();
    if (end > snippetEnd) snippet += "...";
    return snippet;
  }

  return { resolveLocation, extractSnippet };
}
