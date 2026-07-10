/**
 * Isolation-window registration model (host-neutral core).
 *
 * An isolation window is an ordinary Wakeflow window named `<repo>__<id>`
 * whose cwd is a dedicated git worktree on its own branch `<demandKey>/<id>`.
 * It exists for CROSS-DEMAND isolation: when more than one demand is active
 * and both touch a repository, the later demand works in its own worktree so
 * the main checkout stays coherent. Within one demand a repo runs exactly one
 * window (a combined task package it self-sequences) — never two. The ONLY
 * new state is the derived local config overlay: a full regenerated copy of
 * the tracked wakeflow.config.json plus one repositories[] entry per active
 * isolation window, written to .wakeflow-local/wakeflow.config.json — the
 * path every core resolver (evidence repo mapping, window dispatch config,
 * setup) already prefers when present. Locks, thread registry, launch, and
 * group fan-out all key on windowName, so these windows inherit them without
 * core changes.
 *
 * Each edition drives this model with its own window transport (tmux windows
 * for Claude Code, threads for Codex); the overlay, branch, worktree, and cap
 * semantics here are identical across hosts.
 *
 * A hand-maintained local config override (no derived marker)
 * is a user override surface per the workspace memory file; stream
 * registration must FAIL CLOSED rather than overwrite it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hostProfile } from "./wakeflow-host-profile.mjs";

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
  const preferred = path.join(workspaceRoot, "wakeflow.config.json");
  if (existsSync(preferred)) return preferred;
  const legacy = path.join(workspaceRoot, "workspace.config.json");
  if (existsSync(legacy)) return legacy;
  return preferred;
}

// The overlay mutation lock lives BESIDE the shared overlay it guards, not
// under a per-host transport dir: in a dual-host workspace both editions
// mutate ONE derived overlay, so a host-scoped lock file would let a Codex
// stream op race a Claude Code one. Same principle as the state-root lock.
export function streamOverlayLockFile(workspaceRoot) {
  return path.join(workspaceRoot, ".wakeflow-local", "stream-overlay.lock");
}

export function overlayConfigFile(workspaceRoot) {
  // Regenerate an existing legacy-named overlay in place (never two overlays);
  // fresh overlays get the canonical name.
  const legacy = path.join(workspaceRoot, ".wakeflow-local", "workspace.config.json");
  if (existsSync(legacy)) return legacy;
  return path.join(workspaceRoot, ".wakeflow-local", "wakeflow.config.json");
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
      "the local config override under .wakeflow-local/ is hand-maintained (no derived marker); "
      + "stream registration manages that file as a regenerated derived view and will not overwrite user overrides. "
      + "Fold the override into wakeflow.config.json (or remove the local file), then retry.",
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

// Per-repo maxStreams wins, then the CURRENT edition's host cap
// (hosts.<hostDirName>.maxStreamsPerRepo — the file is host-local, so each
// edition resolves its own key), then the default. The cap bounds how many
// DEMANDS may hold isolation worktrees on one repo — never same-demand fan-out.
export function maxStreamsFor(baseConfig, repoEntry, fallback = 2) {
  const perRepo = repoEntry?.maxStreams;
  if (Number.isInteger(perRepo) && perRepo > 0) return perRepo;
  const hostCap = baseConfig?.hosts?.[hostProfile.runtime.hostDirName]?.maxStreamsPerRepo;
  if (Number.isInteger(hostCap) && hostCap > 0) return hostCap;
  return fallback;
}

export function buildStreamEntry({ repoEntry, windowName, worktreeRel, repoWindow, streamId, demandKey, branch }) {
  return {
    windowName,
    path: worktreeRel,
    role: `Isolation worktree of ${repoWindow}`,
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

// The RULES for opening an isolation stream, shared by every edition so they
// can never drift between hosts. Pure over (baseConfig, current stream
// entries); callers evaluate it INSIDE their own overlay mutation critical
// section. Returns null when the stream may open, else a refusal descriptor.
export function streamOpenRefusal({ baseConfig, streams, repoWindow, repoEntry, windowName, demandKey, fallbackCap = 2 }) {
  if (streams.some((entry) => entry.windowName === windowName)) {
    return {
      code: "already-registered",
      message: `stream window ${windowName} is already registered; close it first or pick another --stream id.`,
    };
  }
  if ((Array.isArray(baseConfig.repositories) ? baseConfig.repositories : []).some((repo) => repo.windowName === windowName)) {
    return {
      code: "window-collision",
      message: `stream window name ${windowName} collides with a configured repository window; pick another --stream id.`,
    };
  }
  const repoStreams = streams.filter((entry) => entry.stream?.repo === repoWindow);
  // WITHIN one demand a repository runs exactly ONE window: multiple work
  // items go to that window as a combined task package it self-sequences.
  // An isolation worktree exists per (repo, demand) — its purpose is
  // cross-DEMAND isolation, never same-demand parallel dispatch.
  const sameDemand = repoStreams.find((entry) => entry.stream?.demandKey === demandKey);
  if (sameDemand) {
    return {
      code: "same-demand-second-window",
      message: `demand ${demandKey} already has an isolation window for ${repoWindow} (${sameDemand.windowName}); within a demand each repo runs one window — send additional items as a combined task package instead.`,
    };
  }
  const cap = maxStreamsFor(baseConfig, repoEntry, fallbackCap);
  if (repoStreams.length >= cap) {
    return {
      code: "pool-exhausted",
      activeStreams: repoStreams.map((entry) => entry.windowName),
      maxStreams: cap,
      message: `stream pool for ${repoWindow} is exhausted (${repoStreams.length}/${cap}); wait for an active stream to close after acceptance, then retry.`,
    };
  }
  return null;
}

// Create the worktree + overlay entry for one isolation stream. Assumes the
// caller holds the overlay mutation lock and already passed streamOpenRefusal.
// `exec(cmd, argv)` must return { status, stdout, stderr } (each edition
// injects its own child-process runner). Throws with a rolled-back worktree
// when overlay registration fails, so nothing is ever half-open.
export function addStreamWorktree({ workspaceRoot, repoEntry, repoWindow, streamId, demandKey, branch, baseBranch = "", streams, exec }) {
  const repoPath = path.resolve(workspaceRoot, repoEntry.path);
  const worktreeDir = worktreeDirFor(workspaceRoot, repoWindow, streamId);
  const worktreeRel = path.relative(workspaceRoot, worktreeDir).split(path.sep).join("/");
  const windowName = streamWindowName(repoWindow, streamId);
  if (existsSync(worktreeDir)) {
    throw new Error(`worktree directory already exists: ${worktreeDir}; close/remove it or choose another stream id.`);
  }
  mkdirSync(path.dirname(worktreeDir), { recursive: true });
  const added = exec("git", ["-C", repoPath, "worktree", "add", worktreeDir, "-b", branch, ...(baseBranch ? [baseBranch] : [])]);
  if (added.status !== 0) throw new Error(`git worktree add failed: ${(added.stderr || added.stdout).trim()}`);
  const entry = buildStreamEntry({ repoEntry, windowName, worktreeRel, repoWindow, streamId, demandKey, branch });
  try {
    regenerateOverlay(workspaceRoot, [...streams, entry]);
  } catch (error) {
    // Registration failed: roll the worktree + branch back so nothing is
    // half-open, then rethrow with the real reason.
    exec("git", ["-C", repoPath, "worktree", "remove", "--force", worktreeDir]);
    exec("git", ["-C", repoPath, "branch", "-D", branch]);
    throw new Error(`stream registration failed (worktree rolled back): ${error.message}`);
  }
  return { entry, worktreeDir, worktreeRel, windowName };
}

// Remove one isolation stream's worktree (and optionally its branch), with the
// evidence-respecting gates every edition must share: a dirty or unreadable
// worktree refuses without force, and -d (not -D) guards unmerged branches.
// Host-side teardown (windows, registries, delivery locks) stays with the
// caller. Returns the executed steps for the caller's report.
export function removeStreamWorktree({ workspaceRoot, entry, force = false, deleteBranch = false, exec }) {
  const worktreeDir = path.resolve(workspaceRoot, entry.path);
  const repoPath = path.resolve(workspaceRoot, entry.stream.repoPath);
  const branch = entry.stream.branch;
  const repoPresent = existsSync(repoPath);
  const steps = [];
  if (!repoPresent && !force) {
    throw new Error(`repository path ${entry.stream.repoPath} no longer exists; pass --force to drop the worktree directory and deregister the stream anyway.`);
  }
  if (existsSync(worktreeDir)) {
    if (repoPresent) {
      const status = exec("git", ["-C", worktreeDir, "status", "--porcelain"]);
      if (!force && status.status !== 0) {
        // Fail CLOSED: an unreadable worktree must not silently pass the
        // dirty check into removal.
        throw new Error(`cannot verify worktree cleanliness (git status failed: ${(status.stderr || status.stdout).trim()}); pass --force to discard anyway.`);
      }
      if (!force && status.stdout.trim()) {
        throw new Error(`worktree ${entry.path} has uncommitted changes; commit them (the stream's evidence) or pass --force to discard.`);
      }
      const removed = exec("git", ["-C", repoPath, "worktree", "remove", ...(force ? ["--force"] : []), worktreeDir]);
      if (removed.status !== 0) throw new Error(`git worktree remove failed: ${(removed.stderr || removed.stdout).trim()}`);
      steps.push("worktree-removed");
    } else {
      rmSync(worktreeDir, { recursive: true, force: true });
      steps.push("worktree-directory-dropped-repo-missing");
    }
  } else if (repoPresent) {
    exec("git", ["-C", repoPath, "worktree", "prune"]);
    steps.push("worktree-already-missing-pruned");
  }

  if (deleteBranch && !repoPresent) {
    steps.push("branch-deletion-skipped-repo-missing");
  } else if (deleteBranch) {
    // -d refuses an unmerged branch: accepted work must be merged (or the
    // deletion forced deliberately) before its branch disappears.
    const deleted = exec("git", ["-C", repoPath, "branch", force ? "-D" : "-d", branch]);
    if (deleted.status !== 0) {
      throw new Error(`git branch ${force ? "-D" : "-d"} ${branch} failed (worktree already removed; re-run stream-close without --delete-branch to finish deregistration, or merge the branch first): ${(deleted.stderr || deleted.stdout).trim()}`);
    }
    steps.push("branch-deleted");
  }
  return { steps, repoPresent, branch };
}

// Decentralized merging: nothing in Wakeflow merges isolation branches, so the
// only defense against forgotten branches is a durable ledger row appended the
// moment a branch outlives its window. Idempotent per (demand, repo, branch,
// window) so a re-run of a failed close never duplicates a row.
export function appendPendingMergeRow({ workspaceRoot, ledgerRoot, demandKey, repo, branch, windowName, now = () => new Date().toISOString() }) {
  const file = path.resolve(workspaceRoot, ledgerRoot ?? "../wakeflow-ledger", "workspace", "pending-merges.md");
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, [
      "# Pending Merges",
      "",
      "> Branches whose isolation window closed without --delete-branch. Merge-back is",
      "> human-reviewed and decentralized; delete a row once its branch is merged or dropped.",
      "",
      "| Closed At | Demand | Repo | Branch | Window |",
      "| --- | --- | --- | --- | --- |",
      "",
    ].join("\n"));
  }
  const marker = `| ${demandKey ?? "?"} | ${repo ?? "?"} | ${branch} | ${windowName} |`;
  if (readFileSync(file, "utf8").includes(marker)) {
    return path.relative(workspaceRoot, file); // re-run of a failed close: no duplicate row
  }
  writeFileSync(file, `| ${now()} ${marker}\n`, { flag: "a" });
  return path.relative(workspaceRoot, file);
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
      from: path.basename(tracked),
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
