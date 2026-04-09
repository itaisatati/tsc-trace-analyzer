// Small shared utilities: rounding, byte formatting, and project-root-aware
// path relativization (with case-insensitive handling for macOS/Windows).

import { relative } from "node:path";
import { platform } from "node:os";

export function round(n) {
  return Math.round(n * 10) / 10;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const isCaseInsensitiveFS =
  platform() === "darwin" || platform() === "win32";

export function normalizePath(p) {
  return isCaseInsensitiveFS ? p.toLowerCase() : p;
}

// Factory: returns a `tryRelative` bound to a specific project root.
// Avoids module-level mutable state that the previous single-file version
// relied on.
export function createTryRelative(projectRoot) {
  return function tryRelative(filePath) {
    if (!filePath) return filePath;
    try {
      // On case-insensitive filesystems, trace paths may differ in case from cwd
      const rel = isCaseInsensitiveFS
        ? relative(normalizePath(projectRoot), normalizePath(filePath))
        : relative(projectRoot, filePath);
      return rel.startsWith("..") ? filePath : rel;
    } catch {
      return filePath;
    }
  };
}
