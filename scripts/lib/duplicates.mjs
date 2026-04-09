// Scans the set of files referenced during check for packages that appear
// at more than one path under node_modules. Multiple copies of the same
// package mean TypeScript checks types from each copy separately.

export function detectDuplicatePackages(filesChecked, tryRelative) {
  const packagePaths = new Map();
  for (const f of filesChecked) {
    const nmIdx = f.lastIndexOf("node_modules/");
    if (nmIdx === -1) continue;
    const afterNm = f.slice(nmIdx + "node_modules/".length);
    let pkgName;
    if (afterNm.startsWith("@")) {
      const parts = afterNm.split("/");
      pkgName = parts[0] + "/" + parts[1];
    } else {
      pkgName = afterNm.split("/")[0];
    }
    const pkgDir = f.slice(0, nmIdx + "node_modules/".length + pkgName.length);
    if (!packagePaths.has(pkgName)) packagePaths.set(pkgName, new Set());
    packagePaths.get(pkgName).add(tryRelative(pkgDir));
  }

  return Array.from(packagePaths.entries())
    .filter(([, paths]) => paths.size > 1)
    .map(([name, paths]) => ({ name, paths: Array.from(paths) }));
}
