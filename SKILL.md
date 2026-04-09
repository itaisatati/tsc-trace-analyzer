---
name: tsc-trace-analyzer
description: Run and analyze TypeScript compiler traces using --generateTrace. Identifies slow type-checking operations, maps them to source code, and suggests concrete fixes. Use when users mention slow tsc builds, TypeScript performance, type-checking bottlenecks, or compilation speed.
---

# tsc-trace-analyzer

Run `tsc --generateTrace` on a TypeScript project, parse the resulting trace files, identify compilation bottlenecks, and suggest concrete code fixes.

## When to use

Use this skill whenever the user complains that the TypeScript compiler or compilation is slow, or when they want to investigate where `tsc` is spending time. Triggers include — but are not limited to — any of the following:

- "The TypeScript compiler is slow" / "tsc is slow" / "compilation is slow"
- "My TypeScript build is slow" / "the build takes forever"
- "Type checking is slow" / "type checking takes forever" / "tsc takes forever"
- "Why is my TypeScript project so slow to compile?"
- "How do I make tsc faster?" / "How do I speed up TypeScript?"
- "Find TypeScript performance bottlenecks" / "Find type-checking hotspots"
- "Profile the TypeScript compiler" / "profile tsc"
- Any mention of `--generateTrace`, `trace.json`, `types.json`, "tsc trace", or "TypeScript tracing"
- `tsc` is crashing with a JavaScript heap out-of-memory error and the user wants to understand or fix it
- The user wants to know what the TypeScript compiler is spending its time on
- The user asks for help reducing TypeScript compile times, build times, or CI times caused by `tsc`

Also use it proactively if the user shares a slow `tsc` build log, a long type-checking duration, or asks for advice on TypeScript performance optimization.

## Instructions

Follow these steps in order:

### Step 1: Find tsconfig.json

Search for `tsconfig.json` files in the project:
- Use Glob to find `**/tsconfig.json` files, excluding `node_modules`
- If exactly one is found, use it
- If multiple are found, pick by this priority order:
  1. **Root `tsconfig.json`** at the project root — use it if present
  2. **`src/tsconfig.json`** — use it if there is no root tsconfig
  3. **Otherwise, ask the user** which one to analyze
- If none are found, tell the user this skill requires a TypeScript project with a `tsconfig.json`

### Step 2: Generate the trace

Run the TypeScript compiler with tracing enabled:

```bash
STAMP=$(date +%s)
TRACE_DIR="/tmp/tsc-trace-$STAMP"
EMIT_DIR="/tmp/tsc-emit-$STAMP"
npx tsc -p <tsconfig_path> --generateTrace "$TRACE_DIR" --outDir "$EMIT_DIR" --incremental false 2>&1
```

Important flags:
- `--incremental false` ensures a full compilation (incremental builds skip files and produce incomplete traces)
- `--outDir "$EMIT_DIR"` redirects emitted `.js` (and `.d.ts`) files to a temp directory so we don't pollute the project. **Do NOT use `--noEmit`** — skipping emit makes the emit phase appear as 0ms in the trace and produces a profile that doesn't match a real production build.
- If the project uses a build tool wrapper (e.g., `vue-tsc`, `tspc`), use the appropriate compiler binary instead of `npx tsc`

After analysis is complete, the temp emit directory can be deleted (`rm -rf "$EMIT_DIR"`). Don't delete it during analysis — some hotspot investigations may want to inspect the emitted output.

If the compilation fails with errors, that's OK — the trace is still generated and useful. Inform the user that compilation errors exist but proceed with the analysis.

**If the trace fails with a memory error** (V8 stack traces, "JavaScript heap out of memory", "FATAL ERROR: Reached heap limit"), retry with more heap. The flag changes nothing about the trace output — it just gives V8 enough memory to finish:

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc -p <tsconfig_path> --generateTrace "$TRACE_DIR" --outDir "$EMIT_DIR" --incremental false
```

Or, equivalently using the npx flag form:

```bash
npx --node-options="--max-old-space-size=8192" tsc -p <tsconfig_path> --generateTrace "$TRACE_DIR" --outDir "$EMIT_DIR" --incremental false
```

Bump higher (e.g. `12288`, `16384`) if 8GB still isn't enough on very large projects.

### Step 3: Run the analyzer

Run the helper script to parse and aggregate the trace data. The script is plain ESM with zero dependencies, so it runs unchanged on Node.js, Bun, or Deno. Try them in order:

**Preferred — Node.js:**
```bash
node <SKILL_DIR>/scripts/analyze-trace.mjs "$TRACE_DIR" --top 15 --cwd <project_root>
```

**Fallback — Bun (if `node` is not on PATH):**
```bash
bun run <SKILL_DIR>/scripts/analyze-trace.mjs "$TRACE_DIR" --top 15 --cwd <project_root>
```

**Fallback — Deno (if neither `node` nor `bun` is available):**
```bash
deno run --allow-read --allow-env <SKILL_DIR>/scripts/analyze-trace.mjs "$TRACE_DIR" --top 15 --cwd <project_root>
```

Check availability with `command -v node`, `command -v bun`, `command -v deno`. If none of the three are installed, tell the user this skill requires Node.js, Bun, or Deno to run the analyzer.

Where `<SKILL_DIR>` is the directory containing this SKILL.md file.

The script outputs a JSON object with:
- `summary`: Total time broken down by phase (parse, bind, check, emit)
- `hotspotsByFile`: Files ranked by total check time
- `hotspotsBySpan`: Individual operations ranked by duration, with source locations and code snippets
- `duplicatePackages`: npm packages found at multiple paths in node_modules

### Step 4: Read and analyze results

1. Parse the JSON output from the script
2. For each hotspot in `hotspotsBySpan`, read the relevant source file at the indicated location to understand the full code context
3. Identify which fix patterns (see reference below) apply to each hotspot

### Step 5: Present findings

Format the results as shown below. **Color the phase times** in the summary line using ANSI escape codes so they stand out in the terminal: green for fast phases (<10% of total), yellow for moderate (10–40%), red for hot phases (>40%). Also color individual phase labels consistently — Parse (cyan), Bind (magenta), Check (yellow), Emit (blue) — so the audience can track them at a glance during a demo.

Use these ANSI codes (wrap each value):
- Reset: `\033[0m`
- Bold: `\033[1m`
- Red: `\033[31m`, Green: `\033[32m`, Yellow: `\033[33m`, Blue: `\033[34m`, Magenta: `\033[35m`, Cyan: `\033[36m`

Example colored summary line (literal output, terminal will render colors):
```
Total: 35.0s  | Parse: 2.8s  Bind: 2.5s  Check: 29.7s  Emit: 0.0s
        ^bold     ^cyan         ^magenta    ^yellow+RED   ^blue
```

The format itself:

```
## TypeScript Compiler Performance Analysis

**Total compilation time:** <colored>Xs</colored> (Parse: <cyan>Xs</cyan> | Bind: <magenta>Xs</magenta> | Check: <colored>Xs</colored> | Emit: <blue>Xs</blue>)
**Files analyzed:** N

### Top Bottlenecks

| # | Duration | File | Location | Operation | Issue |
|---|----------|------|----------|-----------|-------|
| 1 | X,XXXms  | path | L##-##   | eventName | brief description |
| ... |

### Detailed Analysis

#### 1. path/to/file.ts:L##-## (X,XXXms)

[Explanation of what's slow and why]

**Current code:**
[relevant code snippet]

**Suggested fix:**
[concrete code change with explanation]
```

When emitting the summary line specifically, print it as a raw line with ANSI codes (not inside a markdown code block) so the terminal renders the colors. The table and detailed analysis sections remain plain markdown.

If `duplicatePackages` is non-empty, add a section about duplicate packages and recommend `npm dedupe`.

### Step 6: Suggest fixes

For each hotspot, propose concrete code changes based on the patterns below. Show before/after code. Don't auto-apply changes — present them for the user to review.

## Fix Patterns Reference

When analyzing hotspots, match them against these common TypeScript performance antipatterns:

### 1. Deeply nested conditional types
**Symptom:** `structuredTypeRelatedTo` or `checkExpression` is slow on conditional type expressions.
**Fix:** Break `A extends B ? (C extends D ? ...) : ...` into named type aliases at each level:
```typescript
// Before
type Result<T> = T extends A ? (T extends B ? X : Y) : (T extends C ? Z : W);

// After
type HandleA<T> = T extends B ? X : Y;
type HandleOther<T> = T extends C ? Z : W;
type Result<T> = T extends A ? HandleA<T> : HandleOther<T>;
```

### 2. Large union types
**Symptom:** `structuredTypeRelatedTo` comparing unions with many members (>20).
**Fix:** Use discriminated unions with a `kind` field, or break into smaller union groups:
```typescript
// Before
type Event = ClickEvent | HoverEvent | ScrollEvent | ... (50+ members)

// After — discriminated union
type Event = { kind: 'click'; ... } | { kind: 'hover'; ... } | ...
```

### 3. Missing return type annotations
**Symptom:** `checkExpression` is slow on function bodies, especially exported or generic functions.
**Fix:** Add explicit return type annotations so TypeScript can skip inference:
```typescript
// Before
export function processData(items: Item[]) {
  // complex body — TS must infer the return type
}

// After
export function processData(items: Item[]): ProcessedResult {
  // TS knows the return type, skips inference
}
```

### 4. Deep generic nesting
**Symptom:** `getVariancesWorker` or `structuredTypeRelatedTo` with deeply nested generics.
**Fix:** Flatten into intermediate named types:
```typescript
// Before
type Deep = Promise<Array<Map<string, Set<Record<string, T>>>>>;

// After
type InnerMap = Map<string, Set<Record<string, T>>>;
type Deep = Promise<Array<InnerMap>>;
```

### 5. `type` aliases for object shapes
**Symptom:** Slow `structuredTypeRelatedTo` between object types defined with `type`.
**Fix:** Use `interface` instead — interfaces are cached by name and compared faster:
```typescript
// Before
type User = { id: string; name: string; ... };

// After
interface User { id: string; name: string; ... }
```

### 6. Mapped types over large key sets
**Symptom:** Slow check events involving `{ [K in keyof LargeType]: ... }`.
**Fix:** Use `Pick<T, RelevantKeys>` to reduce the mapped surface:
```typescript
// Before
type Partial<T> = { [K in keyof T]?: T[K] };  // over 100+ key type

// After
type RelevantPartial = Partial<Pick<LargeType, 'key1' | 'key2' | 'key3'>>;
```

### 7. Duplicate node_modules packages
**Symptom:** `duplicatePackages` array is non-empty in analyzer output.
**Fix:** Run `npm dedupe` or fix version conflicts. Multiple copies of the same package means TypeScript checks types from each copy separately.

### 8. Large projects without project references
**Symptom:** High overall `checkMs` across many files (>500 files, >10s check time).
**Fix:** Split into project references with `composite: true` for incremental checking:
```json
// tsconfig.json
{
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/ui" }
  ]
}
```

### 9. Checking declaration files from node_modules
**Symptom:** Files in `node_modules` appear in `hotspotsByFile`.
**Fix:** Enable `"skipLibCheck": true` in tsconfig.json to skip checking `.d.ts` files.

### 10. Barrel file re-exports
**Symptom:** `index.ts` barrel files appear in hotspots with high check times.
**Fix:** Replace barrel re-exports with direct imports:
```typescript
// Before — forces TS to load and check everything
import { Button } from '@/components';

// After — only loads what's needed
import { Button } from '@/components/Button';
```
