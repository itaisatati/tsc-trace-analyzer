# tsc-trace-analyzer

An Agent Skill that figures out why your TypeScript build is slow.

It runs `tsc --generateTrace` on your project, parses the trace files, finds the operations that take the longest, maps them back to your source code (the trace uses character offsets, not line numbers which makes it slow and cumbersome), and then suggests fixes based on the TypeScript project's official recommendations.

## What you get

- A breakdown of where `tsc` actually spends its time (parse / bind / check / emit)
- The slowest files and the slowest individual operations, with line numbers and code snippets
- Concrete fix suggestions
    - Simplify a conditional type
    - Add a return annotation
    - Dedupe a package
- A heads-up when something in `node_modules` is duplicated and slowing things down

## Install

```bash
npx skills add itaisatati/tsc-trace-analyzer
```

## How to use it

After installation just ask your agent (for example, Claude Code) something like "my tsc build is slow, can you take a look?" and the skill kicks in.
It'll find your `tsconfig.json`, run the trace, and walk you through what it found.

If your project is huge and `tsc` runs out of memory, the skill knows to retry with more heap.

## What's inside

- `SKILL.md` — the instructions Claude follows
- `scripts/analyze-trace.mjs` — a small zero-dependency script that does the heavy lifting on the trace files (they can be hundreds of MB which is too big for an LLM to read directly).

That's it. Runs on Node, Bun, or Deno.
