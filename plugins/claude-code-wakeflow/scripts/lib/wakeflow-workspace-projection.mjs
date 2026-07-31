import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  inspectActiveDemandStateRoot,
  isWakeflowInitStagingEntry,
} from "./wakeflow-active-demands.mjs";
import { loadWorkspaceConfig, resolveConfigPath, testWindowNames, workspaceLedgerPaths } from "./wakeflow-config.mjs";
import { listPodReservations } from "./wakeflow-pod-reservations.mjs";
import { WakeflowStateLockTimeoutError, withFileLock } from "./wakeflow-state-lock.mjs";
import {
  formatTodoRow,
  normalizeTodoBoard,
  replaceTodoSection,
  todoBoardLockPath,
} from "./wakeflow-todo-table.mjs";

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join("/") || ".";
}

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function activeDemandSnapshots(currentDir, workspaceRoot) {
  if (!existsSync(currentDir)) return [];
  return readdirSync(currentDir, { withFileTypes: true })
    .filter((entry) => !isWakeflowInitStagingEntry(entry.name))
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .flatMap((entry) => {
      const root = path.join(currentDir, entry.name);
      const inspected = inspectActiveDemandStateRoot({ workspaceRoot, stateRoot: root });
      if (inspected.missingState && inspected.issues.length === 0) return [];
      if (inspected.state?.state === "archived") return [];
      return [{
        root,
        state: inspected.state,
        progress: inspected.progressFile,
        issues: inspected.issues,
      }];
    })
    .sort((left, right) => {
      if (!left.state || !right.state) return left.state ? 1 : right.state ? -1 : left.root.localeCompare(right.root);
      return String(right.state.updatedAt ?? "").localeCompare(String(left.state.updatedAt ?? ""));
    });
}

function countValues(items, key, expected = []) {
  const counts = Object.fromEntries(expected.map((value) => [value, 0]));
  for (const item of items) {
    const value = typeof item?.[key] === "string" && item[key] ? item[key] : "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function canonicalExecutionProjection(state) {
  const placement = state?.executionPlacement ?? {};
  const isPod = placement.mode === "isolated"
    && placement.selection === "explicit-user-pod";
  const provisioning = isPod && state?.podProvisioning && typeof state.podProvisioning === "object"
    ? state.podProvisioning
    : null;
  const windows = Array.isArray(provisioning?.windows) ? provisioning.windows : [];
  return {
    placement: isPod ? "pod" : "main",
    podId: isPod ? placement.podId ?? provisioning?.podId ?? null : null,
    host: isPod ? provisioning?.host ?? null : state?.controllerHost ?? null,
    phase: isPod ? provisioning?.phase ?? null : null,
    logicalWindows: {
      total: windows.length,
      byStatus: countValues(windows, "status", ["planned", "bound", "closed"]),
      byRole: countValues(windows, "role", ["controller", "design", "test", "product"]),
    },
  };
}

function logicalWindowSummaryText(logicalWindows) {
  const counts = logicalWindows?.byStatus ?? {};
  return `${logicalWindows?.total ?? 0} logical window(s): `
    + `${counts.planned ?? 0} planned, ${counts.bound ?? 0} bound, ${counts.closed ?? 0} closed`;
}

function legacyPodReservationMigration(workspaceRoot, demandKeys) {
  const snapshot = listPodReservations(workspaceRoot);
  const records = snapshot.reservations.slice(0, 10).map(({ value }) => ({
    demandKey: value.demandKey,
    podId: value.podId ?? null,
    status: value.status,
    hasCanonicalDemand: demandKeys.has(value.demandKey),
  }));
  return {
    status: snapshot.issues.length > 0
      ? "legacy-artifacts-unreadable"
      : records.length > 0
        ? "legacy-artifacts-present"
        : "not-needed",
    reservationCount: snapshot.reservations.length,
    issueCount: snapshot.issues.length,
    records,
    recordsTruncated: Math.max(0, snapshot.reservations.length - records.length),
  };
}

export function archiveWorkspaceTodo({ workspaceRoot, designKey, archiveMount, rowStatus = "completed / archived", config = null }) {
  if (!designKey) return { changed: false, reason: "no-design-key" };
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot });
  const paths = workspaceLedgerPaths({ workspaceRoot, config: loaded });
  const board = paths.globalTodoPath;
  if (!existsSync(board)) return { changed: false, reason: "board-missing" };
  try {
    return withFileLock(todoBoardLockPath(board), () => {
      const normalized = normalizeTodoBoard(readFileSync(board, "utf8"));
      if (!normalized.range || normalized.headerIndex === undefined) {
        return { changed: false, reason: normalized.issues[0] ?? "header-missing" };
      }
      const record = normalized.rows.find((row) => row.value.ID === designKey);
      if (!record) return { changed: false, reason: "row-missing" };
      const lines = [...normalized.lines];
      lines[record.lineIndex] = formatTodoRow({
        ...record.value,
        Status: rowStatus,
        "Current Mount": archiveMount,
      });
      atomicWrite(board, replaceTodoSection(normalized.content, normalized, lines));
      return { changed: true, board, designKey, archiveMount };
    });
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) return { changed: false, reason: error.message };
    throw error;
  }
}

function refreshWorkspaceProjectionUnlocked({ workspaceRoot, config = null, updatedAt = new Date().toISOString() }) {
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot });
  const paths = workspaceLedgerPaths({ workspaceRoot, config: loaded });
  const demands = activeDemandSnapshots(paths.workspaceCurrentDir, workspaceRoot);
  const unreadableDemands = demands.filter((item) => !item.state);
  const unhealthyDemands = demands.filter((item) => item.issues.length > 0);
  const demandKeys = new Set(demands.flatMap((item) => (
    item.state?.demandKey ? [item.state.demandKey] : [path.basename(item.root)]
  )));
  const canonicalDemands = demands.map((item) => ({
    ...item,
    execution: item.state ? canonicalExecutionProjection(item.state) : null,
  }));
  const canonicalPods = canonicalDemands.filter((item) => item.execution?.placement === "pod");
  const podPhaseCounts = countValues(
    canonicalPods.map((item) => ({ phase: item.execution.phase ?? "not-provisioned" })),
    "phase",
  );
  const legacyMigration = legacyPodReservationMigration(workspaceRoot, demandKeys);
  const statusFile = paths.workspaceCurrentStatusPath;
  const statusDir = path.dirname(statusFile);
  const testExchangeFile = resolveConfigPath(
    workspaceRoot,
    loaded.testExchangePath ?? path.join(paths.workspaceCurrentDir, "test-exchange.md"),
  );
  const testWindowLabel = testWindowNames(loaded).join(", ") || "Test";
  const overall = unhealthyDemands.length > 0
    ? "degraded"
    : demands.some((item) => item.state?.state === "blocked")
      ? "blocked"
      : demands.length > 0
        ? "active"
        : "idle";
  const demandLines = [
    ...(canonicalDemands.length === 0 ? ["- Active demand: none."] : canonicalDemands.map(({
      root,
      state,
      progress,
      issues,
      execution,
    }) => {
        const issueText = issues.map((item) => item.error).join("; ");
        if (!state) {
          return `- Unreadable state root \`${path.basename(root)}\` — \`degraded\`: ${issueText}.`;
        }
        if (issues.length > 0) {
          return `- [${state.demandKey}](${posixRelative(statusDir, root)}/) — \`degraded\`: ${issueText}.`;
        }
        if (execution.placement === "pod") {
          return `- [${state.demandKey}](${posixRelative(statusDir, progress)}) — \`${state.state}\`, revision ${state.revision}, placement \`pod\`, pod \`${execution.podId ?? "unassigned"}\`, host \`${execution.host ?? "unbound"}\`, phase \`${execution.phase ?? "not-provisioned"}\`, ${logicalWindowSummaryText(execution.logicalWindows)}.`;
        }
        return `- [${state.demandKey}](${posixRelative(statusDir, progress)}) — \`${state.state}\`, revision ${state.revision}, controller host \`${state.controllerHost ?? "unclaimed"}\`, placement \`main\`.`;
      })),
  ];
  const legacyMigrationSection = legacyMigration.status === "not-needed"
    ? []
    : [
        "",
        "## Legacy Pod Reservation Migration",
        "",
        "Legacy `.wakeflow-local/pod-reservations/` artifacts are migration evidence only. They do not define active placement, Pod phase, workspace health, or the next action.",
        `- Legacy reservations: ${legacyMigration.reservationCount}.`,
        `- Unreadable legacy artifacts: ${legacyMigration.issueCount}.`,
        ...legacyMigration.records.slice(0, 10).map((item) => (
          `- \`${item.demandKey}\` — legacy status \`${item.status}\`; canonical demand state ${item.hasCanonicalDemand ? "exists" : "is absent"}.`
        )),
      ];
  const status = [
    "# Wakeflow Current Status",
    "",
    `Updated: ${updatedAt}`,
    `Controller window: ${loaded.controllerWindow}`,
    `Status: ${overall}`,
    "",
    "## Status Summary",
    "",
    ...demandLines,
    "",
    "This file is a generated entry projection. Each demand's `wakeflow-state.json` is authoritative; delivery transport state is local under `.wakeflow-local/wakeflow-delivery/`.",
    "",
    "## Current Ledgers",
    "",
    `- Global TODO: [global-todo-board.md](${posixRelative(statusDir, paths.globalTodoPath)})`,
    `- Test exchange: [${posixRelative(statusDir, testExchangeFile)}](${posixRelative(statusDir, testExchangeFile)})`,
    `- Current map: [index.md](${posixRelative(statusDir, paths.workspaceCurrentIndexPath)})`,
    "",
    "## Window Dispatch",
    "",
    "| Window | Status | Assigned Work | Evidence |",
    "| --- | --- | --- | --- |",
    `| ${loaded.controllerWindow} | ${overall} | ${
      demands.length
        ? `${demands.length} active/unarchived demand(s)`
        : "No active demand; waiting for controller task."
    } | See Active Demands above. |`,
    `| ${loaded.designWindow} | standby | Design intake only. | Global TODO delivery rows. |`,
    `| ${testWindowLabel} | standby | Test only when assigned by a state root. | State-root test cards. |`,
    "",
    "## Copyable Prompt",
    "",
    overall === "degraded"
      ? "Repair the degraded state-root authority issue listed above before claiming or advancing demand work."
      : demands.length
        ? "Open the active demand link above and continue only through its allowed state-machine action."
        : "No active demand exists. Wait for a controller task or claim an eligible delivered TODO.",
    ...legacyMigrationSection,
    "",
    "## Backfill Area",
    "",
    `- ${updatedAt}: Workspace entry projection refreshed from ${demands.length} unarchived demand(s), including ${canonicalPods.length} explicitly placed Pod demand(s).`,
    "",
  ].join("\n");

  const indexDir = path.dirname(paths.workspaceIndexPath);
  const index = [
    "# Wakeflow Workspace Index",
    "",
    "Status: generated runtime entry",
    "",
    "> Demand state roots are authoritative.",
    "",
    "## Current Controller Entry",
    "",
    "| Type | Document | Status | Notes |",
    "| --- | --- | --- | --- |",
    `| Current Status | [${posixRelative(indexDir, statusFile)}](${posixRelative(indexDir, statusFile)}) | ${overall} | Generated from all unarchived demand state roots. |`,
    `| Current Work Area | [current/](current/) | maintained | Current status, active TODO, Design/Test intake, and active state roots. |`,
    "",
    "## Window Coverage Status",
    "",
    "| Window | Status | Notes |",
    "| --- | --- | --- |",
    `| ${loaded.controllerWindow} | ${overall} | ${
      demands.length
        ? `${demands.length} unarchived demand(s).`
        : "No active demand; ready for controller work."
    } |`,
    `| ${loaded.designWindow} | standby | Delivers requirements through the global TODO board. |`,
    `| ${testWindowLabel} | standby | Receives only explicit state-root test work. |`,
    "",
    "## Status Enum",
    "",
    "| Status | Meaning |",
    "| --- | --- |",
    "| idle | No active controller demand is running. |",
    "| standby | Window exists but has no assigned task package. |",
    "| active | At least one unarchived demand is active. |",
    "| blocked | A demand has a blocking state. |",
    "| degraded | A canonical demand state authority artifact is corrupt or inconsistent. |",
    "| complete | Work is accepted and awaiting archive or already archived. |",
    "",
    ...(demands.length
      ? [
          "## Active Demands",
          "",
          ...canonicalDemands.map(({ root, state, issues, execution }) => {
            const issueText = issues.map((item) => item.error).join("; ");
            if (!state) {
              return `- Unreadable state root \`${path.basename(root)}\` — \`degraded\`: ${issueText}.`;
            }
            return issues.length > 0
              ? `- [${state.demandKey}](${posixRelative(indexDir, root)}/) — \`degraded\`: ${issueText}.`
              : execution.placement === "pod"
                ? `- [${state.demandKey}](${posixRelative(indexDir, root)}/) — \`${state.state}\`, revision ${state.revision}, placement \`pod\`, pod \`${execution.podId ?? "unassigned"}\`, host \`${execution.host ?? "unbound"}\`, phase \`${execution.phase ?? "not-provisioned"}\`, ${logicalWindowSummaryText(execution.logicalWindows)}.`
                : `- [${state.demandKey}](${posixRelative(indexDir, root)}/) — \`${state.state}\`, revision ${state.revision}, placement \`main\`.`;
          }),
          "",
        ]
      : ["No active demand is initialized. Windows are ready and should wait for a task wakeup.", ""]),
    ...(legacyMigration.status === "not-needed"
      ? []
      : [
          "## Legacy Pod Reservation Migration",
          "",
          "Legacy reservation artifacts are non-authoritative migration evidence and do not affect this index status.",
          `- Legacy reservations: ${legacyMigration.reservationCount}.`,
          `- Unreadable legacy artifacts: ${legacyMigration.issueCount}.`,
          "",
        ]),
  ].join("\n");

  atomicWrite(statusFile, status);
  atomicWrite(paths.workspaceIndexPath, index);
  return {
    statusFile,
    indexFile: paths.workspaceIndexPath,
    activeDemandCount: demands.length,
    unreadableDemandCount: unreadableDemands.length,
    unhealthyDemandCount: unhealthyDemands.length,
    podDemandCount: canonicalPods.length,
    podPhaseCounts,
    pods: canonicalPods.map(({ root, state, execution }) => ({
      demandKey: state.demandKey,
      stateRoot: posixRelative(workspaceRoot, root),
      state: state.state,
      ...execution,
    })),
    legacyMigration,
    status: overall,
  };
}

export function refreshWorkspaceProjection({ workspaceRoot, config = null, updatedAt = new Date().toISOString() }) {
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot });
  const paths = workspaceLedgerPaths({ workspaceRoot, config: loaded });
  const lockFile = `${paths.workspaceIndexPath}.lock`;
  mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    // One lock covers the snapshot scan and BOTH projection writes. Without it,
    // two demand pods can interleave so an older snapshot overwrites the newer
    // status/index pair after a create, complete, render, or archive transition.
    return withFileLock(lockFile, () => refreshWorkspaceProjectionUnlocked({
      workspaceRoot,
      config: loaded,
      updatedAt,
    }));
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) {
      // Projections are regenerable and another writer owns this exact refresh
      // boundary. Never turn an already-committed state transition into a false
      // failure solely because the projection lock remained busy.
      return {
        statusFile: paths.workspaceCurrentStatusPath,
        indexFile: paths.workspaceIndexPath,
        skipped: true,
        reason: error.message,
      };
    }
    throw error;
  }
}
