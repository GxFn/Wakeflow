#!/usr/bin/env node

// Demand pods, host-neutral runner. One demand = one pod: its OWN controller
// (`Controller__<pod>`), per-repo isolation worktree windows, and its OWN
// `Test__<pod>`. The WHOLE pod shares the demand's ONE worktree set — every
// window, Test included, works and verifies inside those worktrees. Within a
// demand each repo runs exactly ONE window with ONE combined task package;
// parallelism exists ONLY at the demand level.
//
// This script owns the host-NEUTRAL half of the pod lifecycle: worktrees,
// overlay entries, ledger rows, and registry hygiene, plus a window plan the
// host realizes with its own transport. hostProfile.fleet.transport decides
// the split: "agent-tools" (Codex) — the agent creates one thread per plan
// entry (cwd = the entry's worktree) and registers it; "host-helper" (Claude
// Code) — open PREPARES and defers launch/teardown to wakeflow-claude-host
// pod-open/pod-close, which resume prepared worktrees instead of re-creating.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/wakeflow-process.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import { withFileLock, WakeflowStateLockTimeoutError } from "./lib/wakeflow-state-lock.mjs";
import {
  addStreamWorktree,
  appendPendingMergeRow,
  assertOverlayManageable,
  branchNameFor,
  overlayConfigFile,
  readOverlay,
  regenerateOverlay,
  removeStreamWorktree,
  streamEntries,
  streamOpenRefusal,
  streamWindowName,
  trackedConfigFile,
  worktreeDirFor,
} from "./lib/wakeflow-stream-overlay.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const wakeflowRoot = path.dirname(path.dirname(scriptPath));
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "list";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", wakeflowRoot));
const stateDir = path.resolve(workspaceRoot, getValue("--state-dir", ".wakeflow-local/wakeflow-delivery"));
const hostDir = path.join(stateDir, "hosts", hostProfile.runtime.hostDirName);
const json = hasFlag("--json");

const helpText = `
Demand pod runner (host-neutral)

Usage:
  node scripts/wakeflow-pod.mjs open --demand-key <key> --repos <a,b> [--base <branch>] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs close --demand-key <key> [--force] [--delete-branch] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs list [--root <workspace>] [--json]

Design:
  One demand = one pod (own controller + per-repo isolation worktrees + own
  Test), and the whole pod shares the demand's one worktree set. open creates
  the worktrees and overlay entries and emits a window plan; the host's
  transport (threads or tmux helper) realizes it. close tears the demand's
  worktrees down evidence-first (dirty trees refuse; surviving branches land
  on the pending-merges ledger) after the demand completed. Parallelism
  exists only at the demand level; within a demand each repo runs exactly one
  window with one combined task package.
`.trim();

class CliExit extends Error {}

function hasFlag(name) {
  return options.includes(name);
}

function getValue(name, fallback = null) {
  const eq = options.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = options.indexOf(name);
  if (index >= 0 && options[index + 1] && !options[index + 1].startsWith("--")) {
    return options[index + 1];
  }
  return fallback;
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function fail(message) {
  if (json) {
    console.error(JSON.stringify({ ok: false, scriptComplete: true, command, error: message }, null, 2));
  } else {
    console.error(`wakeflow-pod: ${message}`);
  }
  process.exitCode = 1;
  throw new CliExit(message);
}

function output(payload, textLines = []) {
  const complete = { ok: true, scriptComplete: true, command, ...payload };
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  if (complete.agentNext) console.log(`Agent next: ${complete.agentNext}`);
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "pod";
}

function readJson(file, label = "JSON file") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${file}: ${error.message}`);
  }
  return null;
}

function exec(commandName, argv) {
  return runSync(commandName, argv, { encoding: "utf8" });
}

function withStreamOverlayLock(fn) {
  mkdirSync(hostDir, { recursive: true });
  try {
    return withFileLock(path.join(hostDir, "stream-overlay.lock"), fn);
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function readConfigOrFail() {
  const trackedFile = trackedConfigFile(workspaceRoot);
  if (!existsSync(trackedFile)) fail("wakeflow.config.json not found; run initialization first.");
  return readJson(trackedFile, "workspace config");
}

function demandStateFor(demandKey) {
  const stateFile = path.join(workspaceRoot, ".wakeflow-active", "current", slug(demandKey), "wakeflow-state.json");
  if (!existsSync(stateFile)) return { exists: false, state: null };
  try {
    return { exists: true, state: JSON.parse(readFileSync(stateFile, "utf8")).state ?? "unknown" };
  } catch {
    return { exists: true, state: "unreadable" };
  }
}

function registryFileFor(windowName) {
  return path.join(hostDir, "thread-registry", `${slug(windowName)}.json`);
}

function windowRegistered(windowName) {
  return existsSync(registryFileFor(windowName));
}

function freshDeliveryLockFor(windowName) {
  const lockFile = path.join(stateDir, "locks", `${slug(windowName)}.json`);
  if (!existsSync(lockFile)) return null;
  try {
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    return lock?.expiresAt && Date.parse(lock.expiresAt) > Date.now() ? lock : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pod entry prompts. The invariant sentences (one worktree set shared by the
// whole pod, one combined task package per repo, human-reviewed merge-back)
// are the unified cross-demand contract; only the transport vocabulary is
// host-specific.

function buildWorkWindowPrompt({ windowName, repoWindow, worktreeRel, branch, demandKey }) {
  return [
    `You are the **${windowName}** window — an ISOLATION worktree window of the ${repoWindow} repository in this Wakeflow workspace (worktree: ${worktreeRel}; branch: ${branch}; demand: ${demandKey}). You are demand ${demandKey}'s ONE window for this repository.`,
    ``,
    `1. Read the parent workspace \`${hostProfile.memoryFile}\` and the wakeflow-target skill.`,
    `2. State your window name and worktree identity in one line.`,
    `3. Wait for your dispatch: you receive ONE combined task package for this repository and self-sequence its items.`,
    `4. ISOLATION BOUNDARY: work ONLY inside this worktree on branch ${branch}. Never touch the repository's main checkout, another demand's worktree, or other branches; merging back to the main line is a controller-owned step, never yours.`,
  ].join("\n");
}

function buildPodControllerPrompt({ demandKey, podSlug, repos }) {
  const podWindows = repos.map((repo) => streamWindowName(repo, podSlug)).join(", ");
  return [
    `You are **Controller__${podSlug}** — the DEDICATED controller of demand ${demandKey}, running in your own pod. You know nothing about other demands or pods; never read or touch their state roots, windows, worktrees, or branches.`,
    ``,
    `Pod start — do this now:`,
    `1. Read the parent workspace \`${hostProfile.memoryFile}\` and the wakeflow-controller skill (the S0→S6 route applies unchanged inside the pod).`,
    `2. Claim YOUR demand: wakeflow_create_demand with todoId "${demandKey}" and controllerWindow "Controller__${podSlug}" — todoId consumes the TODO row (demandKey defaults to it) and the stamped controllerWindow routes every controller-return back to YOU. If the state root ALREADY exists (pod resume after a restart), do NOT re-create: read it, run wakeflow_adopt_demand_host if needed, and continue the loop from its current state.`,
    `3. Your fleet: dispatch ONLY to ${podWindows || "your pod windows"} (isolation worktrees) and Test__${podSlug}. One combined task package per repo; author objectives; evidence-based review.`,
    `4. The WHOLE pod shares this demand's ONE worktree set: every window — Test included — works and verifies inside those worktrees, and nothing in this pod touches a repository's main checkout or another demand's worktrees.`,
    `5. Merge-back of pod branches is HUMAN-reviewed after archive — never merge yourself. Close order at the end: complete-demand -> wakeflow_pod_close -> archive -> report.`,
  ].join("\n");
}

function buildPodTestPrompt({ demandKey, podSlug, repos }) {
  const worktrees = repos.map((repo) => {
    const rel = path.relative(workspaceRoot, worktreeDirFor(workspaceRoot, repo, podSlug)).split(path.sep).join("/");
    return `${repo} -> ${rel} (branch ${branchNameFor(demandKey, podSlug)})`;
  });
  return [
    `You are **Test__${podSlug}** — the DEDICATED Test window of demand ${demandKey}, running in its pod. You know nothing about other demands or pods; never read or touch their state roots, windows, worktrees, or branches.`,
    ``,
    `Pod Test ground rules:`,
    `1. Read the parent workspace \`${hostProfile.memoryFile}\` and the wakeflow-target skill, then state your window identity in one line.`,
    `2. This demand's code lives ONLY in its isolation worktrees${worktrees.length ? `: ${worktrees.join("; ")}` : ""}. Run every verification against those worktrees — never against a repository's main checkout.`,
    `3. Execute only test cards delivered by Controller__${podSlug} and report a TargetResultEnvelope with evidence refs. You never fix product code, choose environments the card does not name, or dispatch other windows.`,
  ].join("\n");
}

function registrationTemplate(windowName) {
  return {
    tool: "wakeflow_register_window",
    args: { window: windowName, windowHandle: hostProfile.launch?.launchResultPlaceholder ?? "<host window handle>", apply: true },
  };
}

// ---------------------------------------------------------------------------

function commandOpen() {
  const demandKey = requireValue("--demand-key");
  const podSlug = slug(demandKey);
  const repos = (requireValue("--repos") || "").split(",").map((name) => name.trim()).filter(Boolean);
  if (repos.length === 0) fail("--repos needs at least one configured repository window name.");
  const baseBranch = getValue("--base", "");
  const baseConfig = readConfigOrFail();
  const baseRepos = Array.isArray(baseConfig.repositories) ? baseConfig.repositories : [];
  for (const repo of repos) {
    if (!baseRepos.some((entry) => entry.windowName === repo)) fail(`--repos names ${repo}, which is not a configured repository window.`);
  }
  try {
    assertOverlayManageable(workspaceRoot);
  } catch (error) {
    fail(error.message);
  }

  // A pod attaches to a claimable or open demand; a provably closed one would
  // orphan fresh worktrees behind the archive gate.
  const demandState = demandStateFor(demandKey);
  if (demandState.exists && (demandState.state === "completed" || demandState.state === "archived")) {
    fail(`demand ${demandKey} is ${demandState.state}; a pod attaches to a claimable or open demand.`);
  }
  if (demandState.exists) {
    process.stderr.write(`wakeflow-pod: demand ${demandKey} already has a state root (${demandState.state}); the pod controller should RESUME it, not re-create it.\n`);
  }

  // Cross-pod repo intersection: independent demands sharing a repo are the
  // top source of merge conflicts — say it now, not at merge time.
  const overlayNow = readOverlay(workspaceRoot);
  const intersections = (overlayNow ? streamEntries(overlayNow) : [])
    .filter((entry) => entry.stream?.demandKey !== demandKey && repos.includes(entry.stream?.repo))
    .map((entry) => ({ repo: entry.stream.repo, occupiedBy: entry.stream.demandKey, window: entry.windowName }));

  const workWindows = [];
  let poolExhausted = null;
  withStreamOverlayLock(() => {
    for (const repo of repos) {
      const windowName = streamWindowName(repo, podSlug);
      const branch = branchNameFor(demandKey, podSlug);
      const overlay = readOverlay(workspaceRoot);
      const existing = overlay ? streamEntries(overlay) : [];
      const own = existing.find((entry) => entry.windowName === windowName && entry.stream?.demandKey === demandKey);
      if (own) {
        workWindows.push({
          windowName,
          repo,
          branch: own.stream.branch,
          worktree: own.path,
          status: "already-registered",
        });
        continue;
      }
      const repoEntry = baseRepos.find((entry) => entry.windowName === repo);
      const refusal = streamOpenRefusal({ baseConfig, streams: existing, repoWindow: repo, repoEntry, windowName, demandKey });
      if (refusal?.code === "pool-exhausted") {
        // Opened windows are kept (idempotent resume); the pool block is the
        // cross-demand capacity signal, never widened to unblock a pod.
        poolExhausted = { repo, ...refusal };
        return;
      }
      if (refusal) fail(refusal.message);
      let opened;
      try {
        opened = addStreamWorktree({
          workspaceRoot, repoEntry, repoWindow: repo, streamId: podSlug, demandKey, branch, baseBranch,
          streams: existing, exec,
        });
      } catch (error) {
        if (error instanceof CliExit) throw error;
        fail(`pod open stopped at ${windowName} (already-opened pod windows are kept; fix the cause and re-run open to resume): ${error.message}`);
      }
      workWindows.push({ windowName, repo, branch, worktree: opened.worktreeRel, status: "opened" });
    }
  });
  if (poolExhausted) {
    const payload = {
      ok: false,
      scriptComplete: true,
      command,
      code: "pool-exhausted",
      repo: poolExhausted.repo,
      activeStreams: poolExhausted.activeStreams,
      maxStreams: poolExhausted.maxStreams,
      openedBeforeBlock: workWindows,
      note: "Stream pool for this repository is exhausted; close another demand's stream after acceptance, then re-run open to resume this pod. Never widen maxStreams just to unblock unattended work.",
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
    return;
  }

  const transport = hostProfile.fleet?.transport ?? "agent-tools";
  const controllerWindow = `Controller__${podSlug}`;
  const testWindow = `Test__${podSlug}`;
  const windowPlan = [
    ...workWindows.map((win) => ({
      ...win,
      role: "work",
      cwd: win.worktree,
      registered: windowRegistered(win.windowName),
      createWindowTool: hostProfile.hostTools?.createWindow,
      createThreadPrompt: buildWorkWindowPrompt({
        windowName: win.windowName, repoWindow: win.repo, worktreeRel: win.worktree, branch: win.branch, demandKey,
      }),
      localRegistration: registrationTemplate(win.windowName),
    })),
    {
      windowName: controllerWindow,
      role: "controller",
      cwd: ".",
      registered: windowRegistered(controllerWindow),
      createWindowTool: hostProfile.hostTools?.createWindow,
      createThreadPrompt: buildPodControllerPrompt({ demandKey, podSlug, repos }),
      localRegistration: registrationTemplate(controllerWindow),
    },
    {
      windowName: testWindow,
      role: "test",
      cwd: baseConfig.internalTestPath ?? ".",
      registered: windowRegistered(testWindow),
      createWindowTool: hostProfile.hostTools?.createWindow,
      createThreadPrompt: buildPodTestPrompt({ demandKey, podSlug, repos }),
      localRegistration: registrationTemplate(testWindow),
    },
  ];

  output({
    demandKey,
    pod: podSlug,
    transport,
    workWindows,
    intersections,
    windowPlan,
    overlay: path.relative(workspaceRoot, overlayConfigFile(workspaceRoot)),
    costNote: `each pod window is a full live ${hostProfile.hostName} session (${windowPlan.length} for this pod); maxActiveDemands bounds pods, maxStreamsPerRepo bounds pods per repo`,
    agentNext: transport === "host-helper"
      ? `Worktrees and overlay entries are prepared. Launch or resume the pod fleet with the host helper: wakeflow-claude-host.mjs pod-open --demand-key ${demandKey} --repos ${repos.join(",")} (prepared worktrees are resumed, never re-created).`
      : `Create each unregistered windowPlan entry with ${hostProfile.hostTools?.createWindow ?? "the host window tool"} (cwd = the entry's cwd, prompt = createThreadPrompt), then call wakeflow_register_window per returned handle using the entry's localRegistration template. The pod controller claims the demand itself.`,
  }, [
    `Pod ${podSlug} prepared: ${workWindows.map((win) => `${win.windowName} (${win.status})`).join(", ") || "no work windows"}.`,
    ...(intersections.length ? [`Cross-pod repo intersections: ${intersections.map((item) => `${item.repo} occupied by ${item.occupiedBy}`).join("; ")}.`] : []),
  ]);
}

function commandClose() {
  const demandKey = requireValue("--demand-key");
  const podSlug = slug(demandKey);
  const force = hasFlag("--force");
  const deleteBranch = hasFlag("--delete-branch");
  const transport = hostProfile.fleet?.transport ?? "agent-tools";
  if (transport === "host-helper" && !hasFlag("--neutral-only")) {
    fail(`this edition's pod fleet lives in host sessions; close it with the host helper (wakeflow-claude-host.mjs pod-close --demand-key ${demandKey}), which also tears down the windows. Pass --neutral-only to run only the worktree/ledger half from here.`);
  }
  const baseConfig = readConfigOrFail();

  // Close order: complete-demand -> pod close (worktrees + ledger) -> archive.
  // The archive reducer refuses while isolation windows are open, so the pod's
  // streams must come down after completion and before archive.
  const demandState = demandStateFor(demandKey);
  if (!force && demandState.state !== "completed" && demandState.state !== "archived") {
    fail(`demand ${demandKey} is ${demandState.state ?? "missing"}, not completed. Close order: complete-demand -> pod close -> archive (pass --force to tear the pod's worktrees down anyway).`);
  }

  const closed = [];
  let pendingMergeLedger;
  withStreamOverlayLock(() => {
    const overlay = readOverlay(workspaceRoot);
    const entries = (overlay ? streamEntries(overlay) : []).filter((entry) => entry.stream?.demandKey === demandKey);
    if (entries.length === 0 && !windowRegistered(`Controller__${podSlug}`) && !windowRegistered(`Test__${podSlug}`)) {
      fail(`demand ${demandKey} has no registered pod windows or isolation streams to close.`);
    }
    for (const entry of entries) {
      const lock = freshDeliveryLockFor(entry.windowName);
      if (lock && !force) {
        fail(`stream ${entry.windowName} has a fresh in-flight delivery lock (${lock.deliveryId || "unknown delivery"}, expires ${lock.expiresAt}); wait for its result or pass --force to tear it down anyway.`);
      }
    }
    for (const entry of entries) {
      let steps = [];
      try {
        steps = removeStreamWorktree({ workspaceRoot, entry, force, deleteBranch, exec }).steps;
      } catch (error) {
        if (error instanceof CliExit) throw error;
        fail(error.message);
      }
      if (!deleteBranch) {
        pendingMergeLedger = appendPendingMergeRow({
          workspaceRoot,
          ledgerRoot: baseConfig.projectLedgerRoot ?? "../wakeflow-ledger",
          demandKey,
          repo: entry.stream.repo,
          branch: entry.stream.branch,
          windowName: entry.windowName,
        });
      }
      closed.push({ windowName: entry.windowName, branch: entry.stream.branch, steps });
    }
    const remaining = (readOverlay(workspaceRoot) ? streamEntries(readOverlay(workspaceRoot)) : [])
      .filter((entry) => entry.stream?.demandKey !== demandKey);
    try {
      regenerateOverlay(workspaceRoot, remaining);
    } catch (error) {
      fail(`pod worktrees torn down, but the overlay could not be regenerated (${error.message}); re-run close after fixing it.`);
    }
  });

  // Registry hygiene for every pod window: the entries point at threads that
  // no longer serve this demand. Removing them does not kill host threads —
  // the host side is abandoned (agent-tools) or already handled (host-helper).
  const sweptRegistrations = [];
  for (const windowName of [...closed.map((item) => item.windowName), `Controller__${podSlug}`, `Test__${podSlug}`]) {
    for (const runtimeFile of [
      registryFileFor(windowName),
      path.join(hostDir, "window-config", `${slug(windowName)}.json`),
      path.join(stateDir, "locks", `${slug(windowName)}.json`),
    ]) {
      if (existsSync(runtimeFile)) {
        rmSync(runtimeFile, { force: true });
        if (!sweptRegistrations.includes(windowName)) sweptRegistrations.push(windowName);
      }
    }
  }

  output({
    demandKey,
    pod: podSlug,
    transport,
    closedIsolationWindows: closed,
    sweptRegistrations,
    pendingMergeLedger,
    agentNext: demandState.state === "archived"
      ? "Pod is closed. Review the pending-merges ledger and merge or drop the listed branches (human-reviewed, outside Wakeflow)."
      : "Pod worktrees are closed and branches are on the pending-merges ledger; archive the demand now (wakeflow_archive). Merge-back stays human-reviewed and decentralized.",
  }, [
    `Closed ${closed.length} isolation window(s) for ${demandKey}.`,
  ]);
}

function commandList() {
  const overlay = readOverlay(workspaceRoot);
  const byDemand = new Map();
  for (const entry of overlay ? streamEntries(overlay) : []) {
    const demandKey = entry.stream?.demandKey ?? "unknown";
    if (!byDemand.has(demandKey)) byDemand.set(demandKey, []);
    byDemand.get(demandKey).push(entry);
  }
  const pods = [...byDemand.entries()].map(([demandKey, entries]) => {
    const podSlug = slug(demandKey);
    return {
      demandKey,
      pod: podSlug,
      demandState: demandStateFor(demandKey).state,
      controllerRegistered: windowRegistered(`Controller__${podSlug}`),
      testRegistered: windowRegistered(`Test__${podSlug}`),
      isolationWindows: entries.map((entry) => ({
        windowName: entry.windowName,
        repo: entry.stream?.repo,
        branch: entry.stream?.branch,
        worktree: entry.path,
        registered: windowRegistered(entry.windowName),
      })),
    };
  });
  output({
    pods,
    agentNext: pods.length
      ? "Read-only pod inventory; drive each pod from its own controller window."
      : "No pods are open. Open one with the pod open command when a second demand needs to run beside the active one.",
  }, [
    pods.length ? `${pods.length} pod(s) open.` : "No pods are open.",
  ]);
}

function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(helpText);
    return;
  }
  if (command === "open") return commandOpen();
  if (command === "close") return commandClose();
  if (command === "list") return commandList();
  fail(`Unknown wakeflow-pod command: ${command}\n\n${helpText}`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
