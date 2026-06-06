# Workspace Ledgers And Document Surfaces

Use this reference when creating, moving, syncing, or archiving Wakeflow control documents, status mirrors, indexes, templates, Design handoff ledgers, test exchange entries, or workspace skill assets.

`AGENTS.md` remains the hard boundary source. This file only describes document locations, ledger usage, and template fields.

## Main Reading Surfaces

- Human-facing workspace surfaces should stay scarce:
  - final goal / stage confirmation documents;
  - the single `developer-progress.md` inside the active controller state root.
- Legacy current control plan / window dispatch documents remain readable only
  for historical plans that have not migrated to state roots.
- Generated indexes, current status mirrors, Design inboxes, test exchanges, archive summaries, script format notes, and script-readable anchors are maintenance / evidence surfaces.
- When a workflow can be checked or synchronized mechanically, prefer script-maintained concise surfaces over repeated hand-written prose.

## AGENTS Map And Skill Pointers

- `AGENTS.md` is the resident map and hard boundary source. It should explain:
  - highest stop rules;
  - total-control identity and repository boundaries;
  - decision checklist;
  - task entrypoints;
  - confirmation, testing, acceptance, dispatch, workspace governance, skill layering, and validation boundaries.
- A pointer from `AGENTS.md` to a skill / reference must include the trigger scenario and the boundary that remains resident in `AGENTS.md`.
- References may hold command order, templates, examples, script details, and troubleshooting. They must not be the only place that contains hard anti-failure rules created because total control previously made mistakes.
- Before restructuring `AGENTS.md`, make an old-rule migration check:
  - keep in `AGENTS.md`;
  - downshift to a reference;
  - rewrite because later user rules supersede it;
  - discard because it conflicts with current governance.

## Primary Ledgers

- `.workspace-active/workspace/index.md` is the only workspace-level control entrypoint. Every cross-repo plan, current status, task dispatch, document mount, acceptance index, and historical migration entry must be traceable from it.
- `.workspace-active/workspace/current/` holds current status, active TODO, test exchange projections, and active workspace control plans / state roots.
- `.workspace-active/workspace/current/workspace-current-status.md` is a short current snapshot, not the place for large historical backfill.
- `.workspace-active/workspace/current/global-todo-board.md` is the cross-plan TODO / Backlog ledger.
- Active controller state roots hold real `Test` / configured test-window boundary cards under `test-cards/*.json` and target results under `target-results/*.json`.
- `.workspace-active/workspace/current/test-exchange.md` is a short human-readable projection / exchange point for real Test handoffs and evidence, not the state source.
- `../workspace-ledger/design/` is the internal Design surface when no external design repository is configured. It must include local rules, operating policy, alignment checklist, and original-plan / requirement-design / signal / handoff templates.
- `../workspace-ledger/testing/` is the internal Test surface when no external test repository is configured. It must include local rules, testing operation policy, and the test handoff template.
- `.workspace-active/` is the ignored active working surface. It may hold current task documents and local runtime state, but completed / historical project records must be archived into `../workspace-ledger/`.
- External Design repository `docs/current/` holds Design-side drafts, signals, and handoff boards. Total control receives them, then decides whether to write workspace formal ledgers.
- External Test repository `docs/` holds real-scenario test policies, reports, probe scripts, and evidence when a separate test repository is configured.

## Requirement And Goal Documents

- `../workspace-ledger/requirement-designs/` stores larger requirements:
  - `original-plan-YYYY-MM-DD.md`;
  - `requirement-design-YYYY-MM-DD.md`;
  - `code-implementation-dependency-research-YYYY-MM-DD.md`.
- Do not put wave dispatch, execution acceptance, or noisy backfill into `../workspace-ledger/requirement-designs/`.
- `../workspace-ledger/goal-stage-confirmation/` stores the long-lived process. Specific task-level goal / stage confirmation documents live in `.workspace-active/workspace/current/` and are mounted from the workspace index.
- Mature requirement flow:
  1. original plan;
  2. requirement design;
  3. code implementation dependency research when needed;
  4. goal / stage confirmation;
  5. user confirmation;
  6. wave execution plan;
  7. acceptance / archival.

## Repo-Specific Collaboration Documents

- Long-lived repo-specific collaboration documents should go under each configured window ledger directory, for example `../workspace-ledger/<window-name>/`.
- These directories are generated from `workspace.config.json` through `windowLedgerRoot` and optional `windowLedgerDirs`. They replace the old project-specific `docs/<WindowName>/` pattern for generic installations.
- Single-repo execution backfill should still be linked back from the active workspace control plan or workspace index.
- Child repository internal `docs/` should hold product docs, release docs, or user docs only. Do not scatter cross-repo coordination files inside child repos.
- Real test project docs remain project docs; product validation plans, scans, acceptance, and reproduction records should be kept in workspace control docs or the configured Test repository `docs/`.

## Workspace Git Governance

- Wakeflow may track workspace-owned documentation, scripts, templates, and skill assets only.
- Do not add child repositories, real test projects, gitlinks, submodules, or local runtime state to the workspace repository.
- Child repo source / tests / docs must be committed in their own repositories.
- Other windows may create or backfill workspace docs only when authorized by the active controller state root; they must not run workspace `git add`, `git commit`, or `git push`.
- Total control performs final workspace acceptance, deduplication, index correction, and workspace commits.

## Skill Asset Ledger

- `skills/` stores reusable skill assets or drafts; it does not imply automatic Codex installation.
- `skills/<skill-name>/` stores actively developed skills.
- `skills/library/<skill-name>/` is reserved for workspace-approved stable skills.
- A skill promotion or runtime install must document installation location, consumer, and sync method.
- Skills must avoid secrets, local absolute paths, and child-repo runtime implementation duplication.

## Naming And Privacy

- Use lowercase kebab-case filenames.
- Use execution date `YYYY-MM-DD` for dated control docs.
- Long-term policies and contracts can omit dates when they are stable entrypoints.
- Do not write user machine absolute paths, API keys, tokens, or raw Codex thread ids into tracked documents.
- Raw automation thread ids belong only under ignored `.workspace-local/` runtime state.

## Default Workspace Control Plan Fields

Use these fields when a current plan needs explicit per-window dispatch detail:

```text
窗口：
状态：
派发时间（北京时间，YYYY-MM-DD HH:mm CST）：
状态更新时间（北京时间，YYYY-MM-DD HH:mm CST）：
任务：
目标：
范围：
禁止事项：
验证命令：
阻塞/依赖：
文档动作：新建 / 更新 / 无需新建
保存位置：
挂载入口：
回填位置：
下一步允许启动：是/否，原因：
执行前置硬规则：先读取目标仓库 AGENTS.md，并明确当前窗口定位 / 仓库职责。
```

Use task packages when mainline work and same-window TODOs can be closed together:

```text
任务包 ID：
窗口：
派发时间（北京时间，YYYY-MM-DD HH:mm CST）：
状态更新时间（北京时间，YYYY-MM-DD HH:mm CST）：
阶段目标：
主线动作：
合并 TODO：
明确不包含：
下一处真实阻塞点：
阻塞点之前还能做：
验证命令：
回填要求：
子 agent 使用建议：可选；仅在当前窗口 / 仓库职责和当前计划边界内使用，最终由当前窗口统一复核和回填。
执行前置硬规则：
```

## State Values

New state-machine driven docs should store state intent as machine ids and let
workspace scripts render display labels. Do not hand-write status prose as the
source of truth for current plan, index, current-status, TODO intake, dispatch
eligibility, test-boundary checks, or archive decisions. Existing Chinese
labels remain migration inputs only and are normalized by
`scripts/lib/status-machine.mjs`.

Common ids and rendered labels:

- `pending` -> `待启动`
- `running` -> `执行中`
- `delivered` -> `已投递`
- `review` -> `待验收`
- `blocked` -> `阻塞`
- `completed` -> `已完成`
- `paused` -> `暂停`
- `cancelled` -> `取消`
- `rejected` -> `不做`
- `observing` -> `观察中`
- `none` -> `无任务`
- `idle` -> `空闲`

## Maintenance Commands

- Sync internal/external Design and Test support surfaces:
  `node scripts/control-workspace-install.mjs sync-templates --all --write`
- Render developer progress projection:
  `node scripts/render-progress-doc.mjs --state-root <state-root> --write`
- Verify control center:
  `node scripts/verify-control-center.mjs`
- Verify script changes:
  `node scripts/verify-control-center.mjs --with-script-tests`
- Check script docs:
  `node scripts/check-script-docs.mjs`

Use write/apply modes only when the user goal or active controller state root requires it.
