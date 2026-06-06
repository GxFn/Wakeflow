# Phased Migration Playbook

Use this reference when a task moves, extracts, deletes, or rehomes behavior
across BaseWindow repositories. This is a playbook, not a legacy long-form
execution template. Execution should use a controller state root created from
`templates/control-state-machine/`, with migration stages represented as task
packages and review decisions.

## Core Rules

- Start from real code: imports, entrypoints, routes, package exports, runtime
  packaging, build scripts, and existing tests.
- Split every boundary into five buckets:
  - enters target repo;
  - stays in source repo;
  - stays in host / adapter;
  - delete candidate;
  - must not delete.
- Deletion is later than replacement. Before deleting anything, prove:
  - import / reference scan has no live consumers;
  - replacement entrypoint is connected;
  - representative build / check / lint / smoke passes.
- One task package should close one stage. Do not mix public surface, outer
  consumption, deletion cleanup, and release smoke in one task package.
- Publication / live paths are their own stage. Code compiles do not prove
  Plugin, Dashboard, daemon, npm package, channel, marketplace, or live smoke.
- Observation is a real status only when the trigger for becoming active is
  written down.

## Fact Mining Checklist

- Entry facts: CLI, daemon, HTTP, Dashboard, Plugin, package exports, bin,
  npx/runtime, channel, and marketplace entrypoints.
- Call facts: static imports, dynamic imports, DI tokens, routes, HTTP paths,
  event/job names, schema names, and string keys.
- Capability facts: duplicate implementations, mature implementation, adapter,
  facade, compatibility layer, mock, and test replacement.
- Verification facts: available build/check/test/smoke/release gates and what
  each gate can or cannot prove.

Anything without code evidence is a `待扫描假设`, not a dispatchable fact.

## Stage Pattern

1. **Phase 0: Baseline inventory**
   - Scan current entrypoints, imports, routes, package exports, and runtime
     packaging.
   - Produce source list, stay list, delete-candidate list, and blocked facts.
2. **Phase 1: Target public surface / contract**
   - Build the shared contract or target repo entrypoint.
   - Do not migrate consumers until the public surface is proven.
3. **Phase 2: Outer consumption replacement**
   - Replace host / adapter consumers with the new entrypoint.
   - Preserve compatibility only when a real consumer and removal condition are
     written.
4. **Phase 3: Delete candidate cleanup**
   - Delete only after scans and replacement proof pass.
5. **Phase 4: Release / live seal**
   - Validate packaging, channels, runtime smoke, Dashboard / Plugin live paths,
     or other release surfaces that the migration affects.

## State-Root Stage Fields

Every phased migration demand should record these facts in the state root,
developer progress append log, or task package evidence:

- user goal and non-goals;
- hard stage rules;
- current scan baseline;
- five-bucket boundary list;
- stage table with entry condition, allowed scope, forbidden scope, validation,
  and next trigger;
- task packages;
- TODO / Backlog;
- test boundary judgment;
- acceptance matrix.

## Execution Record Fields

Repo-level execution records should include:

- claimed task and current repo role;
- pre-change scan;
- implementation record;
- verification commands and results;
- commit hash or `无` with reason;
- leftover risks;
- backfill to total control.

## Common Scan Commands

Replace paths and specifiers before use:

```text
git status --short
git log --oneline -8
rg -n "<specifier>|<old alias>|<delete candidate>" lib bin scripts test package.json config
rg -l "<old import prefix>" lib bin scripts test
rg -n "from ['\"]<specifier>|import\\(['\"]<specifier>|require\\(['\"]<specifier>" lib bin scripts test
rg -n "<http path>|<job name>|<router key>|<container token>|<package export>" lib bin scripts test package.json
find <path> -type f | sort
npm run build:check
npm run check
npm run lint
```

## Anti-Patterns

- Writing a deletion plan without scans.
- Reading only historical docs, not real code.
- Starting downstream work before upstream contract evidence exists.
- Compressing multiple stages into one task package for speed.
- Treating an empty facade as migration completion.
- Deleting host adapters because the boundary looks cleaner.
- Skipping release smoke by hiding it inside a code stage.
- Marking "not run" as "passed".
- Moving a window directly from `待启动` to `已完成` without commit and
  validation evidence.
- Covering only the user-named repo and forgetting Dashboard, Plugin, Core,
  packaging, or release paths.
