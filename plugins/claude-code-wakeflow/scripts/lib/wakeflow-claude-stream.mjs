/**
 * Parallel-stream registration model for the Claude Code edition.
 *
 * A stream is an ordinary Wakeflow window named `<repo>__<streamId>` whose cwd
 * is a dedicated git worktree on its own branch `<demandKey>/<streamId>`. The
 * ONLY new state is the derived local config overlay: a full regenerated copy
 * of the tracked workspace.config.json plus one repositories[] entry per active
 * stream, written to .wakeflow-local/workspace.config.json — the path every
 * core resolver (evidence repo mapping, window dispatch config, setup) already
 * prefers when present. Locks, thread registry, launch, and group fan-out all
 * key on windowName, so stream windows inherit them without core changes.
 *
 * A hand-maintained .wakeflow-local/workspace.config.json (no derived marker)
 * is a user override surface per CLAUDE.md; stream registration must FAIL
 * CLOSED rather than overwrite it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const OVERLAY_KIND = "WakeflowLocalConfigOverlay";

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "window";
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function trackedConfigFile(workspaceRoot) {
  return path.join(workspaceRoot, "workspace.config.json");
}

export function overlayConfigFile(workspaceRoot) {
  return path.join(workspaceRoot, ".wakeflow-local", "workspace.config.json");
}

// Absent -> null. Unparsable -> throw: a corrupt file might be a user override,
// so regeneration must not silently clobber it.
export function readOverlay(workspaceRoot) {
  const file = overlayConfigFile(workspaceRoot);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`unreadable local config overlay ${file}: ${error.message}; fix or remove it before stream operations.`);
  }
}

export function overlayIsDerived(overlay) {
  return overlay?.derived?.kind === OVERLAY_KIND;
}

export function assertOverlayManageable(workspaceRoot) {
  const overlay = readOverlay(workspaceRoot);
  if (overlay && !overlayIsDerived(overlay)) {
    throw new Error(
      ".wakeflow-local/workspace.config.json exists and is hand-maintained (no derived marker); "
      + "stream registration manages that file as a regenerated derived view and will not overwrite user overrides. "
      + "Fold the override into workspace.config.json (or remove the local file), then retry.",
    );
  }
  return overlay;
}

export function overlayBaseStale(workspaceRoot, overlay) {
  if (!overlayIsDerived(overlay)) return false;
  const tracked = trackedConfigFile(workspaceRoot);
  if (!existsSync(tracked)) return true;
  return sha256(readFileSync(tracked, "utf8")) !== overlay.derived.baseHash;
}

export function streamEntries(config) {
  return (Array.isArray(config?.repositories) ? config.repositories : []).filter((repo) => repo?.stream);
}

export function streamEntryFor(config, windowName) {
  return streamEntries(config).find((entry) => entry.windowName === windowName) ?? null;
}

export function streamWindowName(repoWindow, streamId) {
  return `${repoWindow}__${streamId}`;
}

// Git refs reject spaces, ~ ^ : ? * [ .. @{ and more; a demand key is NOT
// guaranteed ref-safe. The branch gets a sanitized spelling; the stream marker
// keeps the RAW demandKey (the archive gate matches it against state.demandKey
// byte-for-byte).
export function branchNameFor(demandKey, streamId) {
  const safeKey = String(demandKey ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/\.lock$/i, "-lock") || "demand";
  return `${safeKey}/${streamId}`;
}

export function worktreeDirFor(workspaceRoot, repoWindow, streamId) {
  return path.join(workspaceRoot, ".wakeflow-local", "worktrees", `${slug(repoWindow)}__${slug(streamId)}`);
}

export function maxStreamsFor(baseConfig, repoEntry, fallback = 2) {
  const perRepo = repoEntry?.maxStreams;
  if (Number.isInteger(perRepo) && perRepo > 0) return perRepo;
  const hostCap = baseConfig?.hosts?.["claude-code"]?.maxStreamsPerRepo;
  if (Number.isInteger(hostCap) && hostCap > 0) return hostCap;
  return fallback;
}

export function buildStreamEntry({ repoEntry, windowName, worktreeRel, repoWindow, streamId, demandKey, branch }) {
  return {
    windowName,
    path: worktreeRel,
    role: `Parallel stream of ${repoWindow}`,
    mode: "internal",
    managedAgents: false,
    stream: {
      repo: repoWindow,
      repoPath: repoEntry.path,
      streamId,
      demandKey,
      branch,
      openedAt: new Date().toISOString(),
    },
  };
}

// Regenerate the derived overlay from the CURRENT tracked config plus the given
// stream entries. Zero streams removes the overlay (only ever a derived one:
// callers gate on assertOverlayManageable) so resolvers fall back to the base.
export function regenerateOverlay(workspaceRoot, streams) {
  const overlayFile = overlayConfigFile(workspaceRoot);
  if (streams.length === 0) {
    const existing = readOverlay(workspaceRoot);
    if (existing && overlayIsDerived(existing)) rmSync(overlayFile, { force: true });
    return { file: overlayFile, removed: true, streamCount: 0 };
  }
  const tracked = trackedConfigFile(workspaceRoot);
  const raw = readFileSync(tracked, "utf8");
  const base = JSON.parse(raw);
  const names = new Set();
  for (const stream of streams) {
    if (names.has(stream.windowName)) throw new Error(`duplicate stream window name: ${stream.windowName}`);
    names.add(stream.windowName);
  }
  const baseRepos = Array.isArray(base.repositories) ? base.repositories : [];
  for (const repo of baseRepos) {
    if (names.has(repo.windowName)) throw new Error(`stream window name collides with a configured repository: ${repo.windowName}`);
  }
  const config = {
    ...base,
    repositories: [...baseRepos, ...streams],
    derived: {
      kind: OVERLAY_KIND,
      version: 1,
      from: "workspace.config.json",
      baseHash: sha256(raw),
      generatedAt: new Date().toISOString(),
      streamWindows: [...names],
    },
  };
  mkdirSync(path.dirname(overlayFile), { recursive: true });
  // Atomic replace: every core resolver prefers this file the moment it
  // exists, so a torn half-write would transiently break ANY wakeflow command.
  const temp = `${overlayFile}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`);
    renameSync(temp, overlayFile);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // temp never created
    }
    throw error;
  }
  return { file: overlayFile, removed: false, streamCount: streams.length };
}
