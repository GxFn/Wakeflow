import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspaceConfig, resolveConfigPath, testWindowNames, workspaceLedgerPaths } from "./wakeflow-config.mjs";
import { WakeflowStateLockTimeoutError, withFileLock } from "./wakeflow-state-lock.mjs";

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

function activeDemandSnapshots(currentDir) {
  if (!existsSync(currentDir)) return [];
  return readdirSync(currentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const root = path.join(currentDir, entry.name);
      const stateFile = path.join(root, "wakeflow-state.json");
      if (!existsSync(stateFile)) return [];
      try {
        const state = JSON.parse(readFileSync(stateFile, "utf8"));
        if (state.state === "archived") return [];
        return [{ root, state }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => String(right.state.updatedAt ?? "").localeCompare(String(left.state.updatedAt ?? "")));
}

function splitMarkdownRow(line) {
  const text = line.trim();
  if (!text.startsWith("|") || !text.endsWith("|")) return [];
  return text.slice(1, -1).split("|").map((cell) => cell.trim());
}

export function archiveWorkspaceTodo({ workspaceRoot, designKey, archiveMount, config = null }) {
  if (!designKey) return { changed: false, reason: "no-design-key" };
  const loaded = config ?? loadWorkspaceConfig({ workspaceRoot });
  const paths = workspaceLedgerPaths({ workspaceRoot, config: loaded });
  const board = paths.globalTodoPath;
  if (!existsSync(board)) return { changed: false, reason: "board-missing" };
  try {
    return withFileLock(`${board}.lock`, () => {
      const lines = readFileSync(board, "utf8").split("\n");
      const headerIndex = lines.findIndex((line) => {
        const cells = splitMarkdownRow(line);
        return cells.includes("ID") && cells.includes("Status");
      });
      if (headerIndex < 0) return { changed: false, reason: "header-missing" };
      const header = splitMarkdownRow(lines[headerIndex]);
      const statusIndex = header.indexOf("Status");
      const mountIndex = header.indexOf("Current Mount");
      const rowIndex = lines.findIndex((line, index) => index > headerIndex && splitMarkdownRow(line)[0] === designKey);
      if (rowIndex < 0) return { changed: false, reason: "row-missing" };
      const row = splitMarkdownRow(lines[rowIndex]);
      row[statusIndex] = "completed / archived";
      if (mountIndex >= 0) row[mountIndex] = archiveMount;
      lines[rowIndex] = `| ${row.join(" | ")} |`;
      atomicWrite(board, lines.join("\n"));
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
  const demands = activeDemandSnapshots(paths.workspaceCurrentDir);
  const statusFile = paths.workspaceCurrentStatusPath;
  const statusDir = path.dirname(statusFile);
  const testExchangeFile = resolveConfigPath(
    workspaceRoot,
    loaded.testExchangePath ?? path.join(paths.workspaceCurrentDir, "test-exchange.md"),
  );
  const testWindowLabel = testWindowNames(loaded).join(", ") || "Test";
  const overall = demands.length === 0 ? "idle" : demands.some((item) => item.state.state === "blocked") ? "blocked" : "active";
  const demandLines = demands.length === 0
    ? ["- Active demand: none."]
    : demands.map(({ root, state }) => {
        const progress = path.join(root, state.projection?.progressDoc ?? "developer-progress.md");
        return `- [${state.demandKey}](${posixRelative(statusDir, progress)}) — \`${state.state}\`, revision ${state.revision}, controller host \`${state.controllerHost ?? "unclaimed"}\`.`;
      });
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
    `| ${loaded.controllerWindow} | ${overall} | ${demands.length ? `${demands.length} active/unarchived demand(s)` : "No active demand; waiting for controller task."} | See Active Demands above. |`,
    `| ${loaded.designWindow} | standby | Design intake only. | Global TODO delivery rows. |`,
    `| ${testWindowLabel} | standby | Test only when assigned by a state root. | State-root test cards. |`,
    "",
    "## Copyable Prompt",
    "",
    demands.length
      ? "Open the active demand link above and continue only through its allowed state-machine action."
      : "No active demand exists. Wait for a controller task or claim an eligible delivered TODO.",
    "",
    "## Backfill Area",
    "",
    `- ${updatedAt}: Workspace entry projection refreshed from ${demands.length} unarchived demand(s).`,
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
    `| ${loaded.controllerWindow} | ${overall} | ${demands.length ? `${demands.length} unarchived demand(s).` : "No active demand; ready for controller work."} |`,
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
    "| complete | Work is accepted and awaiting archive or already archived. |",
    "",
    ...(demands.length
      ? ["## Active Demands", "", ...demands.map(({ root, state }) => `- [${state.demandKey}](${posixRelative(indexDir, root)}/) — \`${state.state}\`, revision ${state.revision}`), ""]
      : ["No active demand is initialized. Windows are ready and should wait for a task wakeup.", ""]),
  ].join("\n");

  atomicWrite(statusFile, status);
  atomicWrite(paths.workspaceIndexPath, index);
  return { statusFile, indexFile: paths.workspaceIndexPath, activeDemandCount: demands.length, status: overall };
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
