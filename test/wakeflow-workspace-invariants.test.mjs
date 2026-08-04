#!/usr/bin/env node

// Workspace/state regressions execute a temporary, self-contained Codex
// runtime: copy the installable bundle, then overlay core/ while restoring
// the Codex host profile. This pins the tests to core source without syncing
// or modifying either checked-in plugin bundle.

import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const coreRoot = path.join(repoRoot, "core");
const codexBundleRoot = path.join(repoRoot, "plugins", "codex-wakeflow");

function makeRuntime() {
  const runtime = mkdtempSync(path.join(os.tmpdir(), "wakeflow-workspace-runtime-"));
  const hostProfile = readFileSync(path.join(codexBundleRoot, "scripts/lib/wakeflow-host-profile.mjs"));
  cpSync(codexBundleRoot, runtime, { recursive: true });
  cpSync(coreRoot, runtime, { recursive: true, force: true });
  writeFileSync(path.join(runtime, "scripts/lib/wakeflow-host-profile.mjs"), hostProfile);
  return runtime;
}

function makeWorkspace(config = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-workspace-invariant-"));
  const workspaceConfig = {
    workspaceName: "Workspace invariant fixture",
    controllerWindow: "Controller",
    designWindow: "Design",
    testWindow: "Test",
    repositories: [
      { windowName: "Controller", path: ".", role: "controller" },
      { windowName: "RepoA", path: ".", role: "implementation" },
      { windowName: "RepoB", path: ".", role: "implementation" },
      { windowName: "Design", path: ".", role: "design" },
      { windowName: "Test", path: ".", role: "test" },
    ],
    ...config,
  };
  writeJson(path.join(root, "wakeflow.config.json"), workspaceConfig);
  writeFileSync(path.join(root, "requirements.md"), "# Goal\n\nFixture requirement.\n");

  const registeredWindows = new Set([
    workspaceConfig.controllerWindow,
    workspaceConfig.designWindow,
    workspaceConfig.testWindow,
    ...(workspaceConfig.repositories ?? []).map((item) => item.windowName),
  ]);
  const registryDir = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry",
  );
  const windowConfigDir = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config",
  );
  let index = 0;
  for (const windowName of registeredWindows) {
    if (!windowName) continue;
    index += 1;
    const repository = (workspaceConfig.repositories ?? [])
      .find((item) => item.windowName === windowName);
    const cwd = windowName === workspaceConfig.controllerWindow
      ? root
      : path.resolve(root, repository?.path ?? ".");
    mkdirSync(cwd, { recursive: true });
    const role = windowName === workspaceConfig.controllerWindow
      ? "controller"
      : windowName === workspaceConfig.designWindow
        ? "design"
        : windowName === workspaceConfig.testWindow
          ? "test-target"
          : "target";
    const timestamp = "2026-07-31T00:00:00.000Z";
    writeJson(path.join(registryDir, `${windowName}.json`), {
      kind: "CodexWindowThreadRegistration",
      version: 3,
      windowName,
      bindingId: `binding-${windowName}`,
      threadId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      registeredAt: timestamp,
      lastVerifiedAt: timestamp,
    });
    writeJson(path.join(windowConfigDir, `${windowName}.json`), {
      kind: "CodexSubwindowDispatchConfig",
      version: 1,
      windowName,
      threadRegistered: true,
      dispatchable: role !== "design",
      cwd,
      responsibilityRoot: cwd,
      deliveryRole: role,
      generatedAt: timestamp,
    });
  }
  return root;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeProjection(stateRoot, {
  demandKey,
  sourceRevision,
  sourceEventId,
  progressDoc = "developer-progress.md",
} = {}) {
  writeJson(path.join(stateRoot, "projection.json"), {
    schemaVersion: 1,
    demandKey,
    sourceRevision,
    sourceEventId,
    progressDoc,
  });
}

function run(runtime, script, args) {
  const effectiveArgs = script === "wakeflow-demand-sequence.mjs"
    && args[0] === "create-demand"
    && !args.includes("--todo-id")
    && !args.includes("--demand-type")
      ? [args[0], "--demand-type", "bug", ...args.slice(1)]
      : args;
  return spawnSync(process.execPath, [path.join(runtime, "scripts", script), ...effectiveArgs], {
    cwd: runtime,
    encoding: "utf8",
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runState(runtime, args) {
  return run(runtime, "wakeflow-state.mjs", args);
}

function initDemand(runtime, root, demandKey, extra = []) {
  return runState(runtime, [
    "init", "--root", root, "--demand-key", demandKey, "--title", demandKey,
    ...extra, "--write", "--json",
  ]);
}

function initGitRepository(root, name = "RepoA") {
  const repo = path.join(root, name);
  mkdirSync(repo, { recursive: true });
  let result = spawnSync("git", ["init", "-q", "-b", "main", repo], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  result = spawnSync("git", [
    "-C", repo,
    "-c", "user.email=wakeflow@test",
    "-c", "user.name=Wakeflow Test",
    "add", "README.md",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync("git", [
    "-C", repo,
    "-c", "user.email=wakeflow@test",
    "-c", "user.name=Wakeflow Test",
    "commit", "-q", "-m", "fixture",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return repo;
}

function richPackage({ packageId, taskId, targetWindow, dependsOnTaskIds = [] }) {
  return {
    taskPackageId: packageId,
    summary: `Implement ${taskId}`,
    targetWindow,
    targetTaskId: taskId,
    workType: "implementation",
    objective: `Complete ${taskId} against the original requirement.`,
    contextSummary: ["The controller has bounded this package to its stated objective."],
    requirementRefs: [{ ref: "requirements.md#goal", role: "goal" }],
    boundaries: {
      inScope: [`The behavior owned by ${taskId}.`],
      outOfScope: ["Unrelated product behavior."],
      forbidden: ["Do not broaden the requirement."],
    },
    completionExpectations: [`${taskId} passes its focused verification.`],
    dependsOnTaskIds,
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      id: `AC-${taskId}`,
      claim: `${taskId} satisfies the controller-defined behavior.`,
      probe: `Run the focused ${taskId} regression.`,
      expected: `${taskId} produces the required public result.`,
    }],
  };
}

function bugDemandAuthority(demandKey) {
  return {
    demandKey,
    demandType: "bug",
    entryMode: "controller-inline",
    authorityRefs: ["reproduction", "scope", "non-goals"].map((role) => ({
      role,
      ref: "requirements.md#goal",
    })),
    testDecision: {
      mode: "controller-only",
      summary: "The controller reruns the bounded regression probe.",
    },
  };
}

test("workspace entries distinguish pending, frozen, and legacy-terminal demand authority", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace();
  const demandKey = "AUTHORITY-PROJECTION";
  const initialized = parseOk(initDemand(runtime, root, demandKey, ["--demand-type", "bug"]));
  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  const statusFile = path.join(root, ".wakeflow-active/current/workspace-current-status.md");
  const indexFile = path.join(root, ".wakeflow-active/index.md");

  let status = readFileSync(statusFile, "utf8");
  let index = readFileSync(indexFile, "utf8");
  assert.match(status, /\| RepoA \| standby \|/);
  assert.match(status, /\| RepoB \| standby \|/);
  assert.match(index, /\| RepoA \| standby \|/);
  assert.match(index, /\| RepoB \| standby \|/);
  assert.match(status, /demand authority `draft-unfrozen` \(confirmation pending\)/);
  assert.match(status, /Pending confirmation: `AUTHORITY-PROJECTION`/);
  assert.match(index, /demand authority `draft-unfrozen` \(confirmation pending\)/);

  const authority = bugDemandAuthority(demandKey);
  const added = runState(runtime, [
    "add-task-package", "--root", root, "--state-root", initialized.stateRoot,
    "--task-package-id", "PKG-AUTHORITY", "--summary", "Implement the confirmed defect.",
    "--target-window", "RepoA", "--target-task-id", "TASK-AUTHORITY",
    "--work-type", "implementation",
    "--objective", "Implement only the confirmed defect.",
    "--context-summary", JSON.stringify(["The reproduction and boundary are confirmed."]),
    "--requirement-refs", JSON.stringify([{ role: "goal", ref: "requirements.md#goal" }]),
    "--boundaries", JSON.stringify({
      inScope: ["The confirmed defect."],
      outOfScope: ["Unrelated behavior."],
      forbidden: ["Do not widen the demand."],
    }),
    "--completion-expectations", JSON.stringify(["The bounded regression probe passes."]),
    "--depends-on-task-ids", "[]",
    "--commit-expectation", "leave-uncommitted",
    "--acceptance-anchors", JSON.stringify([{
      id: "AC-AUTHORITY",
      claim: "The confirmed defect is corrected.",
      probe: "Run the controller-authored regression probe.",
      expected: "The probe passes without widening scope.",
    }]),
    "--demand-authority", JSON.stringify(authority),
    "--write", "--json",
  ]);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  const frozen = JSON.parse(added.stdout);

  status = readFileSync(statusFile, "utf8");
  index = readFileSync(indexFile, "utf8");
  assert.ok(status.includes(
    `demand authority \`frozen\` (${frozen.demandAuthorityDigest.slice(0, 12)})`,
  ));
  assert.doesNotMatch(status, /Pending confirmation: `AUTHORITY-PROJECTION`/);
  assert.match(index, /demand authority `frozen`/);

  const authorityFile = path.join(root, initialized.stateRoot, "demand-authority.json");
  writeJson(authorityFile, {
    ...readJson(authorityFile),
    testDecision: {
      ...readJson(authorityFile).testDecision,
      summary: "Tampered after freeze.",
    },
  });
  const tamperedProjection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(tamperedProjection.status, "degraded");
  assert.match(readFileSync(statusFile, "utf8"), /does not match frozen state digest/i);

  const legacyRoot = makeWorkspace();
  const legacyStateRoot = path.join(legacyRoot, ".wakeflow-active/current/LEGACY-COMPLETE");
  writeJson(path.join(legacyStateRoot, "wakeflow-state.json"), {
    demandKey: "LEGACY-COMPLETE",
    state: "completed",
    revision: 1,
    controllerHost: "codex",
    projection: { status: "synced", progressDoc: "developer-progress.md" },
    targetTasks: [],
  });
  writeFileSync(
    path.join(legacyStateRoot, "controller-events.jsonl"),
    `${JSON.stringify({ eventId: "evt-legacy-complete", stateRevision: 1 })}\n`,
  );
  writeFileSync(
    path.join(legacyStateRoot, "developer-progress.md"),
    "# Progress\n\n<!-- unified-status:start -->\ncomplete\n<!-- unified-status:end -->\n",
  );
  writeJson(path.join(legacyStateRoot, "projection.json"), {
    schemaVersion: 1,
    demandKey: "LEGACY-COMPLETE",
    sourceRevision: 1,
    sourceEventId: "evt-legacy-complete",
    progressDoc: "developer-progress.md",
    demandAuthority: {
      status: "legacy-terminal-unfrozen",
      ref: null,
      digest: null,
      pendingConfirmation: false,
    },
  });
  const legacyProjection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: legacyRoot });
  assert.equal(legacyProjection.status, "active");
  const legacyStatus = readFileSync(
    path.join(legacyRoot, ".wakeflow-active/current/workspace-current-status.md"),
    "utf8",
  );
  assert.match(legacyStatus, /legacy-terminal-unfrozen/);
  assert.match(legacyStatus, /Pending confirmation: none\./);
  assert.doesNotMatch(legacyStatus, /Pending confirmation: `LEGACY-COMPLETE`/);
});

test("create-demand rejects duplicate dependency ids before creating any state-root artifact", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace();
  const demandKey = "DUPLICATE-DEPS";
  const packages = [
    richPackage({ packageId: "PKG-1", taskId: "TASK-1", targetWindow: "RepoA" }),
    richPackage({
      packageId: "PKG-2",
      taskId: "TASK-2",
      targetWindow: "RepoB",
      dependsOnTaskIds: ["TASK-1", "TASK-1"],
    }),
  ];

  const result = run(runtime, "wakeflow-demand-sequence.mjs", [
    "create-demand", "--root", root, "--demand-key", demandKey, "--title", "Duplicate dependency ids",
    "--task-packages", JSON.stringify(packages), "--write", "--json",
  ]);

  assert.notEqual(result.status, 0, "duplicate dependency ids must fail preflight");
  assert.match(result.stdout + result.stderr, /dependsOnTaskIds.*duplicates|duplicate dependenc/i);
  assert.equal(
    existsSync(path.join(root, `.wakeflow-active/current/${demandKey}/wakeflow-state.json`)),
    false,
    "a complete-list preflight failure must not leave a partially initialized demand",
  );
});

test("configured workspaceCurrentDir participates in the same mainline placement scan", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
  });

  const first = initDemand(runtime, root, "CUSTOM-CAPACITY-1");
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.stateRoot, "custom/current/CUSTOM-CAPACITY-1");

  const second = initDemand(runtime, root, "CUSTOM-CAPACITY-2");
  assert.notEqual(second.status, 0, "the first configured-current demand must occupy the mainline lane");
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.errorCode, "mainline-busy");
  assert.equal(secondPayload.status, "waiting");
  assert.equal(
    existsSync(path.join(root, "custom/current/CUSTOM-CAPACITY-2/wakeflow-state.json")),
    false,
    "a rejected second demand must not be initialized",
  );
});

test("create-demand writes into configured workspaceCurrentDir and cannot bypass its mainline lane", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });

  const first = parseOk(run(runtime, "wakeflow-demand-sequence.mjs", [
    "create-demand", "--root", root, "--demand-key", "CUSTOM-CREATE-1", "--title", "First",
    "--write", "--json",
  ]));
  assert.equal(first.created.stateRoot, "custom/current/CUSTOM-CREATE-1");
  assert.equal(existsSync(path.join(root, "custom/current/CUSTOM-CREATE-1/wakeflow-state.json")), true);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/CUSTOM-CREATE-1/wakeflow-state.json")), false);

  const second = run(runtime, "wakeflow-demand-sequence.mjs", [
    "create-demand", "--root", root, "--demand-key", "CUSTOM-CREATE-2", "--title", "Second",
    "--write", "--json",
  ]);
  assert.notEqual(second.status, 0, "create-demand must see the first demand in the configured current directory");
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.errorCode, "mainline-busy");
  assert.equal(secondPayload.status, "waiting");
  assert.equal(existsSync(path.join(root, "custom/current/CUSTOM-CREATE-2/wakeflow-state.json")), false);
});

test("next-work guards a TODO whose demand is active under configured workspaceCurrentDir", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    globalTodoPath: "custom/current/global-todo-board.md",
  });
  parseOk(initDemand(runtime, root, "ACTIVE-SAME"));
  writeFileSync(path.join(root, "custom/current/global-todo-board.md"), [
    "# Global TODO",
    "",
    "## Global TODO",
    "",
    "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Testing Decision | Documents |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| ACTIVE-SAME | pending-claim | requirement | P1 | Design | Same demand | no | none | Controller | none | yes | unit | |",
    "",
  ].join("\n"));

  const result = run(runtime, "wakeflow-next-work.mjs", [
    "--root", root, "--source", "todo", "--id", "ACTIVE-SAME", "--json",
  ]);
  assert.notEqual(result.status, 0);
  const next = JSON.parse(result.stdout);
  assert.equal(next.candidateCount, 0);
  assert.equal(next.autoClaimable, false);
  assert.ok(next.workspaceDemandConflicts.some((item) => item.demandKey === "ACTIVE-SAME"));
  assert.match(next.issues.join("\n"), /already has an unarchived state root/i);
});

test("pod planning resolves configured workspaceCurrentDir without materializing worktrees", () => {
  const runtime = makeRuntime();

  const mainRoot = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Fixture repo" }],
  });
  const mainRepo = initGitRepository(mainRoot);
  const mainHeadResult = spawnSync("git", ["-C", mainRepo, "rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(mainHeadResult.status, 0, mainHeadResult.stderr || mainHeadResult.stdout);
  const mainHead = mainHeadResult.stdout.trim();
  parseOk(initDemand(runtime, mainRoot, "MAIN-DEMAND"));
  const refused = run(runtime, "wakeflow-pod.mjs", [
    "open", "--root", mainRoot,
    "--request-json", JSON.stringify({
      demandKey: "MAIN-DEMAND",
      host: "codex",
      repositories: [{
        windowName: "RepoA",
        expectedBaseHead: mainHead,
        basePolicy: "local-head",
      }],
    }),
    "--json",
  ]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout + refused.stderr, /assigned to main placement.*explicit isolated placement/is);
  assert.equal(existsSync(path.join(mainRoot, ".wakeflow-local/worktrees/RepoA__MAIN-DEMAND")), false);

  const occupancyRoot = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Fixture repo" }],
  });
  const podRepo = initGitRepository(occupancyRoot);
  const podHeadResult = spawnSync("git", ["-C", podRepo, "rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(podHeadResult.status, 0, podHeadResult.stderr || podHeadResult.stdout);
  const podHead = podHeadResult.stdout.trim();
  parseOk(initDemand(runtime, occupancyRoot, "ACTIVE-MAIN"));
  parseOk(initDemand(runtime, occupancyRoot, "ISOLATED-NEXT", [
    "--placement", "pod",
    "--authorization-ref", "user://workspace-invariant/ISOLATED-NEXT",
  ]));
  const opened = parseOk(run(runtime, "wakeflow-pod.mjs", [
    "open", "--root", occupancyRoot,
    "--request-json", JSON.stringify({
      demandKey: "ISOLATED-NEXT",
      host: "codex",
      repositories: [{
        windowName: "RepoA",
        expectedBaseHead: podHead,
        basePolicy: "local-head",
      }],
    }),
    "--json",
  ]));
  assert.equal(opened.kind, "WakeflowPodLaunchPlan");
  assert.ok(opened.operations.some((item) => (
    item.role === "product" && item.repositoryWindow === "RepoA"
  )));
  assert.equal(existsSync(path.join(occupancyRoot, ".wakeflow-local/worktrees")), false);
});

test("unreadable active state makes workspace projection degraded and runtime health blocked", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  writeJson(path.join(root, "custom/current/GOOD/wakeflow-state.json"), {
    demandKey: "GOOD",
    state: "planned",
    revision: 1,
    controllerHost: "codex",
    projection: { progressDoc: "developer-progress.md" },
    updatedAt: "2026-07-30T00:00:00.000Z",
  });
  writeFileSync(
    path.join(root, "custom/current/GOOD/developer-progress.md"),
    "# GOOD\n\n<!-- unified-status:start -->\nstatus\n<!-- unified-status:end -->\n",
  );
  writeFileSync(
    path.join(root, "custom/current/GOOD/controller-events.jsonl"),
    `${JSON.stringify({ eventId: "evt-good-init", stateRevision: 1 })}\n`,
  );
  writeProjection(path.join(root, "custom/current/GOOD"), {
    demandKey: "GOOD",
    sourceRevision: 1,
    sourceEventId: "evt-good-init",
  });
  const badStateFile = path.join(root, "custom/current/BAD/wakeflow-state.json");
  mkdirSync(path.dirname(badStateFile), { recursive: true });
  writeFileSync(badStateFile, "{ broken json\n");

  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const projection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(projection.status, "degraded");
  assert.equal(projection.activeDemandCount, 2);
  assert.equal(projection.unreadableDemandCount, 1);
  const statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /^Status: degraded$/m);
  assert.match(statusDoc, /Unreadable state root/);
  assert.doesNotMatch(statusDoc, /Active demand: none/);

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.health.status, "blocked");
  assert.ok(
    deliveryStatus.runtimeSummary.diagnostics.errors.some(
      (item) => item.file === "custom/current/BAD/wakeflow-state.json"
        && /unreadable active demand state/i.test(item.error),
    ),
  );
  assert.equal(deliveryStatus.dualHost.demandOwnership.activeCount, 1);
  assert.equal(deliveryStatus.dualHost.demandOwnership.unreadableCount, 1);
  assert.equal(deliveryStatus.dualHost.demandOwnership.demands[0].demandKey, "GOOD");
});

test("a symlink demand root is a blocking occupancy and is never followed", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  const external = mkdtempSync(path.join(os.tmpdir(), "wakeflow-symlink-demand-target-"));
  writeJson(path.join(external, "wakeflow-state.json"), {
    demandKey: "FOLLOWED-EXTERNAL-CONTENT",
    state: "planned",
    revision: 1,
  });
  mkdirSync(path.join(root, "custom/current"), { recursive: true });
  writeJson(path.join(root, "custom/current/.wakeflow-init-directory/wakeflow-state.json"), {
    demandKey: "INTERNAL-STAGING-DIRECTORY",
    state: "planned",
    revision: 1,
  });
  symlinkSync(external, path.join(root, "custom/current/.wakeflow-init-symlink"), "dir");
  symlinkSync(external, path.join(root, "custom/current/SYMLINK-DEMAND"), "dir");

  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const projection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(projection.status, "degraded");
  assert.equal(projection.activeDemandCount, 1);
  const statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /SYMLINK-DEMAND/);
  assert.match(statusDoc, /symbolic link/i);
  assert.doesNotMatch(statusDoc, /FOLLOWED-EXTERNAL-CONTENT/);
  assert.doesNotMatch(statusDoc, /INTERNAL-STAGING-DIRECTORY/);
  assert.doesNotMatch(statusDoc, /\.wakeflow-init-/);
  assert.doesNotMatch(statusDoc, /Active demand: none/);

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.status, "blocked");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "blocked");
  assert.ok(deliveryStatus.runtimeSummary.diagnostics.errors.some((item) => (
    item.file === "custom/current/SYMLINK-DEMAND"
      && /symbolic link/i.test(item.error)
  )));
  assert.equal(deliveryStatus.dualHost.demandOwnership.total, 1);
  assert.equal(deliveryStatus.dualHost.demandOwnership.unreadableCount, 1);

  const rejected = run(runtime, "wakeflow-demand-sequence.mjs", [
    "create-demand", "--root", root, "--demand-key", "NEW-DEMAND", "--title", "Must not fit",
    "--write", "--json",
  ]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout + rejected.stderr, /active demand authority is unreadable/i);
  assert.equal(existsSync(path.join(root, "custom/current/NEW-DEMAND")), false);
});

test("reserved init staging entries are ignored by placement, projection, and delivery status", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  const external = mkdtempSync(path.join(os.tmpdir(), "wakeflow-init-staging-target-"));
  writeJson(path.join(external, "wakeflow-state.json"), {
    demandKey: "STAGING-SYMLINK-CONTENT",
    state: "planned",
    revision: 1,
  });
  mkdirSync(path.join(root, "custom/current"), { recursive: true });
  writeJson(path.join(root, "custom/current/.wakeflow-init-directory/wakeflow-state.json"), {
    demandKey: "STAGING-DIRECTORY-CONTENT",
    state: "planned",
    revision: 1,
  });
  symlinkSync(external, path.join(root, "custom/current/.wakeflow-init-symlink"), "dir");

  const activeModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-active-demands.mjs"),
  ).href);
  const active = activeModule.scanUnarchivedDemandStateRoots({
    workspaceRoot: root,
    currentDir: "custom/current",
  });
  const placement = activeModule.activeDemandPlacementSummary(active);
  assert.equal(placement.active.length, 0);
  assert.equal(placement.mainlineBusy, false);
  assert.equal(placement.authoritySafe, true);

  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const projection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(projection.status, "idle");
  assert.equal(projection.activeDemandCount, 0);

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.status, "idle");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "healthy");
  assert.equal(deliveryStatus.dualHost.demandOwnership.total, 0);
});

test("legacy pod reservations stay migration-only and never drive canonical status or health", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  const reservationModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-pod-reservations.mjs"),
  ).href);
  const written = reservationModule.writePodReservation(root, {
    demandKey: "PREPARING-POD",
    podId: "PREPARING-POD",
    repositories: ["RepoA"],
    status: "prepared",
    reservedAt: "2026-07-30T00:00:00.000Z",
    preparedAt: "2026-07-30T00:00:01.000Z",
    updatedAt: "2026-07-30T00:00:01.000Z",
  });
  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const legacyProjection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(legacyProjection.status, "idle");
  assert.equal(legacyProjection.activeDemandCount, 0);
  assert.equal(legacyProjection.podDemandCount, 0);
  assert.equal(legacyProjection.legacyMigration.status, "legacy-artifacts-present");
  assert.equal(legacyProjection.legacyMigration.reservationCount, 1);
  let statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /^Status: idle$/m);
  assert.match(statusDoc, /^## Legacy Pod Reservation Migration$/m);
  assert.match(statusDoc, /migration evidence only.*do not define active placement/is);
  assert.match(statusDoc, /PREPARING-POD/);

  let deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.status, "idle");
  assert.equal(deliveryStatus.runtimeSummary.nextAction, "idle");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "healthy");
  assert.equal(deliveryStatus.dualHost.demandOwnership.podCount, 0);
  assert.equal(deliveryStatus.dualHost.demandOwnership.total, 0);
  assert.equal(deliveryStatus.legacyMigration.podReservations.authority, "migration-only");
  assert.equal(deliveryStatus.legacyMigration.podReservations.reservationCount, 1);

  writeFileSync(written.file, "{ broken reservation\n");
  const unreadableLegacyProjection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(unreadableLegacyProjection.status, "idle");
  assert.equal(unreadableLegacyProjection.legacyMigration.status, "legacy-artifacts-unreadable");
  assert.equal(unreadableLegacyProjection.legacyMigration.issueCount, 1);
  statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /^Status: idle$/m);
  assert.match(statusDoc, /Unreadable legacy artifacts: 1/);

  deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.status, "idle");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "healthy");
  assert.equal(deliveryStatus.legacyMigration.podReservations.issueCount, 1);
  assert.equal(
    deliveryStatus.runtimeSummary.diagnostics.errors.some((item) => /pod-reservations/.test(item.file)),
    false,
    "legacy migration residue is not canonical runtime authority",
  );
});

test("canonical Pod state projects placement, phase, logical windows, and redacted host-runtime health", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  parseOk(initDemand(runtime, root, "CANONICAL-POD", [
    "--placement", "pod",
    "--pod-id", "POD-CANONICAL",
    "--authorization-ref", "user://workspace-invariant/canonical-pod",
  ]));
  const opened = parseOk(run(runtime, "wakeflow-pod.mjs", [
    "open", "--root", root,
    "--request-json", JSON.stringify({
      demandKey: "CANONICAL-POD",
      host: "codex",
      repositories: [],
    }),
    "--write", "--json",
  ]));
  assert.equal(opened.phase, "creating-control");

  const secretCwd = "/private/host-only/secret-worktree";
  const secretHandle = "private-thread-handle";
  writeJson(
    path.join(
      root,
      ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-bindings/POD-CANONICAL/Controller__POD-CANONICAL.json",
    ),
    {
      kind: "WakeflowHostPodBinding",
      version: 1,
      status: "active",
      actualCwd: secretCwd,
      threadId: secretHandle,
    },
  );

  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const projection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(projection.status, "active");
  assert.equal(projection.podDemandCount, 1);
  assert.equal(projection.podPhaseCounts["creating-control"], 1);
  assert.deepEqual(projection.pods[0], {
    demandKey: "CANONICAL-POD",
    stateRoot: "custom/current/CANONICAL-POD",
    state: "intake",
    placement: "pod",
    podId: "POD-CANONICAL",
    host: "codex",
    phase: "creating-control",
    logicalWindows: {
      total: 3,
      byStatus: { planned: 3, bound: 0, closed: 0 },
      byRole: { controller: 1, design: 1, test: 1, product: 0 },
    },
  });
  const statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /placement `pod`, pod `POD-CANONICAL`, host `codex`, phase `creating-control`/);
  assert.match(statusDoc, /3 logical window\(s\): 3 planned, 0 bound, 0 closed/);

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  const ownership = deliveryStatus.dualHost.demandOwnership;
  assert.deepEqual(ownership.placementCounts, { main: 0, pod: 1 });
  assert.equal(ownership.podCount, 1);
  assert.equal(ownership.podPhaseCounts["creating-control"], 1);
  assert.equal(ownership.demands[0].placement, "pod");
  assert.equal(ownership.demands[0].logicalWindows.total, 3);
  assert.equal(deliveryStatus.runtimeSummary.pods.items[0].phase, "creating-control");
  assert.deepEqual(deliveryStatus.dualHost.podRuntime, {
    status: "observed",
    health: "healthy",
    hostCount: 1,
    operationCount: 3,
    bindingCount: 1,
    issueCount: 0,
    hosts: [{
      host: "codex",
      health: "healthy",
      operationCount: 3,
      operationStatusCounts: { planned: 3 },
      bindingCount: 1,
      bindingStatusCounts: { active: 1 },
      issueCount: 0,
    }],
  });
  const serializedStatus = JSON.stringify(deliveryStatus);
  assert.doesNotMatch(serializedStatus, new RegExp(secretCwd));
  assert.doesNotMatch(serializedStatus, new RegExp(secretHandle));

  writeFileSync(
    path.join(
      root,
      ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations/unreadable.json",
    ),
    `{ broken host-only operation containing ${secretHandle}\n`,
  );
  const degradedHostRuntime = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(degradedHostRuntime.runtimeSummary.health.status, "healthy");
  assert.equal(degradedHostRuntime.dualHost.podRuntime.health, "degraded");
  assert.equal(degradedHostRuntime.dualHost.podRuntime.issueCount, 1);
  assert.equal(
    degradedHostRuntime.runtimeSummary.diagnostics.errors.length,
    0,
    "host-local receipt health is visible but does not replace canonical demand authority",
  );
  assert.doesNotMatch(JSON.stringify(degradedHostRuntime), new RegExp(secretHandle));
});

test("delivery status rejects packet state roots that are symlinks or outside sanctioned roots", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({ projectLedgerRoot: "wakeflow-ledger" });
  const external = mkdtempSync(path.join(os.tmpdir(), "wakeflow-packet-state-target-"));
  writeJson(path.join(external, "wakeflow-state.json"), {
    demandKey: "EXTERNAL-PACKET-STATE",
    state: "planned",
    revision: 1,
    targetTasks: [],
  });
  symlinkSync(external, path.join(root, "non-current-state-link"), "dir");
  const archivedRoot = path.join(root, "wakeflow-ledger/workspace/archive/2026-07/ARCHIVED-LINK");
  writeJson(path.join(archivedRoot, "archive-manifest.json"), {
    sourceStateRoot: "gone-archived-source",
  });
  symlinkSync(
    path.join(external, "wakeflow-state.json"),
    path.join(archivedRoot, "wakeflow-state.json"),
  );
  const packetsDir = path.join(root, ".wakeflow-local/wakeflow-delivery/dispatch-packets");
  for (const [id, stateRoot] of [
    ["packet-symlink-root", "non-current-state-link"],
    ["packet-outside-root", external],
    ["packet-archived-state-link", "gone-archived-source"],
  ]) {
    writeJson(path.join(packetsDir, `${id}.json`), {
      kind: "ControllerDispatchPacket",
      version: 1,
      id,
      taskId: id,
      targetWindow: "RepoA",
      dispatchGroup: "GROUP-INVALID-ROOTS",
      stateRef: { stateRoot, stateRevision: 1 },
    });
  }

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.packetCount, 3);
  assert.equal(deliveryStatus.runtimeSummary.status, "blocked");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "blocked");
  const errors = deliveryStatus.runtimeSummary.diagnostics.errors;
  assert.ok(errors.some((item) => (
    item.file === "non-current-state-link"
      && /symbolic link/i.test(item.error)
  )));
  assert.ok(errors.some((item) => (
    item.file === external
      && /sanctioned state root/i.test(item.error)
  )));
  assert.ok(errors.some((item) => (
    item.file === "gone-archived-source"
      && /symbolic link/i.test(item.error)
  )));
});

test("an invalid progressDoc blocks both workspace projection and delivery status with an accurate diagnostic", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  writeJson(path.join(root, "custom/current/BAD-PROGRESS/wakeflow-state.json"), {
    demandKey: "BAD-PROGRESS",
    state: "planned",
    revision: 1,
    controllerHost: "codex",
    projection: { progressDoc: "../outside.md" },
    targetTasks: [],
  });
  writeFileSync(
    path.join(root, "custom/current/BAD-PROGRESS/controller-events.jsonl"),
    `${JSON.stringify({ eventId: "evt-bad-progress-init", stateRevision: 1 })}\n`,
  );
  writeProjection(path.join(root, "custom/current/BAD-PROGRESS"), {
    demandKey: "BAD-PROGRESS",
    sourceRevision: 1,
    sourceEventId: "evt-bad-progress-init",
    progressDoc: "../outside.md",
  });
  writeFileSync(path.join(root, "custom/current/outside.md"), "# outside\n");

  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const projection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(projection.status, "degraded");
  assert.equal(projection.activeDemandCount, 1);
  const statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /BAD-PROGRESS/);
  assert.match(statusDoc, /progress document must resolve to a file below the state root/i);
  assert.doesNotMatch(statusDoc, /unreadable wakeflow-state\.json/i);

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.status, "blocked");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "blocked");
  assert.ok(deliveryStatus.runtimeSummary.diagnostics.errors.some((item) => (
    item.file === "custom/current/BAD-PROGRESS/wakeflow-state.json"
      && /progress document.*below the state root/i.test(item.error)
  )));
});

test("marker and synced projection drift block both workspace projection and delivery status", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  const eventIdFor = (demandKey) => `evt-${demandKey.toLowerCase()}-init`;
  for (const demandKey of ["BAD-MARKER-COUNT", "BAD-MARKER-ORDER", "PROJECTION-LINK", "STALE-PROJECTION"]) {
    const stateRoot = path.join(root, "custom/current", demandKey);
    writeJson(path.join(stateRoot, "wakeflow-state.json"), {
      demandKey,
      state: "planned",
      revision: 1,
      controllerHost: "codex",
      projection: { status: "synced", progressDoc: "developer-progress.md" },
      targetTasks: [],
    });
    writeFileSync(
      path.join(stateRoot, "controller-events.jsonl"),
      `${JSON.stringify({ eventId: eventIdFor(demandKey), stateRevision: 1 })}\n`,
    );
    writeFileSync(
      path.join(stateRoot, "developer-progress.md"),
      "# Progress\n\n<!-- unified-status:start -->\nstatus\n<!-- unified-status:end -->\n",
    );
    writeProjection(stateRoot, {
      demandKey,
      sourceRevision: 1,
      sourceEventId: eventIdFor(demandKey),
    });
  }

  writeFileSync(
    path.join(root, "custom/current/BAD-MARKER-COUNT/developer-progress.md"),
    [
      "# Duplicate marker",
      "<!-- unified-status:start -->",
      "first",
      "<!-- unified-status:start -->",
      "second",
      "<!-- unified-status:end -->",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "custom/current/BAD-MARKER-ORDER/developer-progress.md"),
    [
      "# Reversed marker",
      "<!-- unified-status:end -->",
      "reversed",
      "<!-- unified-status:start -->",
      "",
    ].join("\n"),
  );
  const externalProjection = path.join(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-external-projection-")),
    "projection.json",
  );
  writeJson(externalProjection, {
    sourceRevision: 1,
    sourceEventId: eventIdFor("PROJECTION-LINK"),
  });
  const linkedProjection = path.join(root, "custom/current/PROJECTION-LINK/projection.json");
  unlinkSync(linkedProjection);
  symlinkSync(externalProjection, linkedProjection);
  writeProjection(path.join(root, "custom/current/STALE-PROJECTION"), {
    demandKey: "STALE-PROJECTION",
    sourceRevision: 0,
    sourceEventId: "evt-wrong",
  });

  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const projection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(projection.status, "degraded");
  assert.equal(projection.activeDemandCount, 4);
  const statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /BAD-MARKER-COUNT.*found start=2, end=1/is);
  assert.match(statusDoc, /BAD-MARKER-ORDER.*start marker followed by exactly one end marker/is);
  assert.match(statusDoc, /PROJECTION-LINK.*symbolic link and was not followed/is);
  assert.match(statusDoc, /STALE-PROJECTION.*sourceRevision 0.*state revision 1/is);
  assert.match(statusDoc, /STALE-PROJECTION.*sourceEventId evt-wrong.*latest controller eventId/is);

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.status, "blocked");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "blocked");
  assert.equal(deliveryStatus.dualHost.demandOwnership.authorityErrorCount, 5);
});

test("state-ahead and event gaps block both workspace projection and delivery status", async () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({
    workspaceCurrentDir: "custom/current",
    workspaceCurrentStatusPath: "custom/current/workspace-current-status.md",
    workspaceCurrentIndexPath: "custom/current/index.md",
  });
  for (const [demandKey, revision, events] of [
    ["STATE-AHEAD", 2, [{ eventId: "evt-state-ahead-init", stateRevision: 1 }]],
    ["EVENT-GAP", 3, [
      { eventId: "evt-event-gap-init", stateRevision: 1 },
      { eventId: "evt-event-gap-third", stateRevision: 3 },
    ]],
  ]) {
    writeJson(path.join(root, `custom/current/${demandKey}/wakeflow-state.json`), {
      demandKey,
      state: "planned",
      revision,
      controllerHost: "codex",
      projection: { progressDoc: "developer-progress.md" },
      targetTasks: [],
    });
    writeFileSync(
      path.join(root, `custom/current/${demandKey}/controller-events.jsonl`),
      `${events.map((item) => JSON.stringify(item)).join("\n")}\n`,
    );
    writeFileSync(
      path.join(root, `custom/current/${demandKey}/developer-progress.md`),
      `# ${demandKey}\n\n<!-- unified-status:start -->\nstatus\n<!-- unified-status:end -->\n`,
    );
    writeProjection(path.join(root, `custom/current/${demandKey}`), {
      demandKey,
      sourceRevision: revision,
      sourceEventId: events.at(-1).eventId,
    });
  }

  const projectionModule = await import(pathToFileURL(
    path.join(runtime, "scripts/lib/wakeflow-workspace-projection.mjs"),
  ).href);
  const projection = projectionModule.refreshWorkspaceProjection({ workspaceRoot: root });
  assert.equal(projection.status, "degraded");
  assert.equal(projection.activeDemandCount, 2);
  const statusDoc = readFileSync(path.join(root, "custom/current/workspace-current-status.md"), "utf8");
  assert.match(statusDoc, /STATE-AHEAD.*active state revision 2 is ahead of controller event revision 1/is);
  assert.match(statusDoc, /EVENT-GAP.*revisions must be contiguous/is);

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.runtimeSummary.status, "blocked");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "blocked");
  assert.equal(deliveryStatus.dualHost.demandOwnership.authorityErrorCount, 2);
});

test("delivery status blocks on orphan events, malformed event logs, and inconsistent pending transitions", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace({ workspaceCurrentDir: "custom/current" });
  const state = (demandKey) => ({
    demandKey,
    state: "planned",
    revision: 1,
    controllerHost: "codex",
    projection: { progressDoc: "developer-progress.md" },
    targetTasks: [],
  });

  writeJson(path.join(root, "custom/current/FUTURE/wakeflow-state.json"), state("FUTURE"));
  writeFileSync(
    path.join(root, "custom/current/FUTURE/developer-progress.md"),
    "# FUTURE\n\n<!-- unified-status:start -->\nstatus\n<!-- unified-status:end -->\n",
  );
  writeFileSync(
    path.join(root, "custom/current/FUTURE/controller-events.jsonl"),
    [
      JSON.stringify({ eventId: "evt-future-init", stateRevision: 1, type: "demand.initialized" }),
      JSON.stringify({ eventId: "evt-future", stateRevision: 2, type: "fixture.future" }),
      "",
    ].join("\n"),
  );
  writeProjection(path.join(root, "custom/current/FUTURE"), {
    demandKey: "FUTURE",
    sourceRevision: 1,
    sourceEventId: "evt-future",
  });

  writeJson(path.join(root, "custom/current/MALFORMED/wakeflow-state.json"), state("MALFORMED"));
  writeFileSync(
    path.join(root, "custom/current/MALFORMED/developer-progress.md"),
    "# MALFORMED\n\n<!-- unified-status:start -->\nstatus\n<!-- unified-status:end -->\n",
  );
  writeProjection(path.join(root, "custom/current/MALFORMED"), {
    demandKey: "MALFORMED",
    sourceRevision: 1,
    sourceEventId: "none",
  });
  writeFileSync(path.join(root, "custom/current/MALFORMED/controller-events.jsonl"), "{ broken\n");

  writeJson(path.join(root, "custom/current/PENDING/wakeflow-state.json"), state("PENDING"));
  writeFileSync(
    path.join(root, "custom/current/PENDING/developer-progress.md"),
    "# PENDING\n\n<!-- unified-status:start -->\nstatus\n<!-- unified-status:end -->\n",
  );
  writeFileSync(
    path.join(root, "custom/current/PENDING/controller-events.jsonl"),
    `${JSON.stringify({ eventId: "evt-pending-init", stateRevision: 1, type: "demand.initialized" })}\n`,
  );
  writeProjection(path.join(root, "custom/current/PENDING"), {
    demandKey: "PENDING",
    sourceRevision: 1,
    sourceEventId: "evt-pending-init",
  });
  writeJson(path.join(root, "custom/current/PENDING/wakeflow-state.pending-transition.json"), {
    kind: "WakeflowPendingStateTransition",
    version: 1,
    command: "fixture",
    createdAt: "2026-07-30T00:00:00.000Z",
    event: {
      eventId: "evt-pending",
      stateRevision: 2,
      type: "fixture.pending",
    },
    nextState: {
      ...state("PENDING"),
      revision: 3,
    },
    artifacts: [],
  });

  const deliveryStatus = parseOk(run(runtime, "wakeflow-delivery.mjs", [
    "status", "--root", root, "--verbose", "--json",
  ]));
  assert.equal(deliveryStatus.packetCount, 0);
  assert.equal(deliveryStatus.runtimeSummary.status, "blocked");
  assert.equal(deliveryStatus.runtimeSummary.health.status, "blocked");
  assert.equal(deliveryStatus.runtimeSummary.nextAction, "inspect-artifact-errors");
  const errors = deliveryStatus.runtimeSummary.diagnostics.errors;
  assert.ok(errors.some((item) => (
    item.file === "custom/current/FUTURE/controller-events.jsonl"
      && /ahead of active state revision/i.test(item.error)
  )));
  assert.ok(errors.some((item) => (
    item.file === "custom/current/MALFORMED/controller-events.jsonl"
      && /malformed/i.test(item.error)
  )));
  assert.ok(errors.some((item) => (
    item.file === "custom/current/PENDING/wakeflow-state.pending-transition.json"
      && /inconsistent/i.test(item.error)
  )));
  assert.equal(deliveryStatus.dualHost.demandOwnership.authorityErrorCount, 3);
});

test("create-demand preflight rejects targetTaskId without targetWindow before init", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace();
  const result = run(runtime, "wakeflow-demand-sequence.mjs", [
    "create-demand", "--root", root, "--demand-key", "ORPHAN-TARGET", "--title", "Orphan",
    "--task-packages", JSON.stringify([{
      taskPackageId: "PKG",
      summary: "Malformed target",
      targetTaskId: "TASK",
    }]),
    "--write", "--json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /targetTaskId requires targetWindow/);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/ORPHAN-TARGET")), false);
});

test("create-demand reports any init authority residue as partial with recovery", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace();
  const stateRoot = ".wakeflow-active/current/RESIDUE";
  writeJson(path.join(root, stateRoot, "demand.json"), { demandKey: "RESIDUE" });

  const result = run(runtime, "wakeflow-demand-sequence.mjs", [
    "create-demand", "--root", root, "--demand-key", "RESIDUE", "--title", "Retry",
    "--write", "--json",
  ]);
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.partial, true);
  assert.equal(payload.stateRoot, stateRoot);
  assert.deepEqual(payload.partialArtifacts, ["demand.json"]);
  assert.match(payload.recovery, /Inspect .*RESIDUE.*reconcile it before retrying/i);
});

test("one demand identity cannot be initialized into two explicit roots", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace();
  const firstRoot = ".wakeflow-active/current/same-identity-one";
  const secondRoot = ".wakeflow-active/current/same-identity-two";

  const first = initDemand(runtime, root, "SAME-IDENTITY", ["--state-root", firstRoot]);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const second = initDemand(runtime, root, "SAME-IDENTITY", ["--state-root", secondRoot]);
  assert.notEqual(second.status, 0, "demandKey is a workspace identity, not only a root-local field");
  assert.match(second.stdout + second.stderr, /already|identity|same demand|demand key/i);
  assert.equal(
    existsSync(path.join(root, secondRoot, "wakeflow-state.json")),
    false,
    "the duplicate identity must not create a second authoritative state",
  );
});

test("redesign keeps Design stateless and parked product tasks unreviewable", () => {
  const runtime = makeRuntime();
  const root = makeWorkspace();
  const initialized = parseOk(initDemand(runtime, root, "REDESIGN-SCOPE"));

  for (const [packageId, taskId, targetWindow] of [
    ["PRODUCT-PKG-A", "PRODUCT-TASK-A", "RepoA"],
    ["PRODUCT-PKG-B", "PRODUCT-TASK-B", "RepoB"],
  ]) {
    parseOk(runState(runtime, [
      "add-task-package", "--root", root, "--state-root", initialized.stateRoot,
      "--task-package-id", packageId, "--summary", packageId,
      "--target-window", targetWindow, "--target-task-id", taskId, "--write", "--json",
    ]));
    const evidenceRef = `reports/${taskId}.json`;
    writeJson(path.join(root, initialized.stateRoot, evidenceRef), { taskId, verified: true });
    parseOk(runState(runtime, [
      "import-target-result", "--root", root, "--state-root", initialized.stateRoot,
      "--target-task-id", taskId, "--target-window", targetWindow, "--status", "completed",
      "--summary", `${taskId} completed under the original requirement.`,
      "--evidence-ref", evidenceRef, "--write", "--json",
    ]));
  }

  const originalReduction = parseOk(runState(runtime, [
    "reduce-results", "--root", root, "--state-root", initialized.stateRoot, "--write", "--json",
  ]));
  assert.ok(originalReduction.candidateId);
  parseOk(runState(runtime, [
    "decide-review", "--root", root, "--state-root", initialized.stateRoot,
    "--candidate-id", originalReduction.candidateId, "--decision", "redesign",
    "--reason", "The original requirement must be corrected before product implementation resumes.",
    "--write", "--json",
  ]));

  const designStateTask = runState(runtime, [
    "add-task-package", "--root", root, "--state-root", initialized.stateRoot,
    "--task-package-id", "DESIGN-PKG", "--summary", "Deliver the corrected requirement.",
    "--target-window", "Design", "--target-task-id", "DESIGN-TASK", "--write", "--json",
  ]);
  assert.notEqual(designStateTask.status, 0, "Design must use stateless wakeflow_deliver instead of becoming a target task");
  assert.match(designStateTask.stdout + designStateTask.stderr, /explicit replacesTargetTaskId/);

  const afterDesignOnly = parseOk(runState(runtime, [
    "reduce-results", "--root", root, "--state-root", initialized.stateRoot, "--write", "--json",
  ]));
  assert.equal(
    afterDesignOnly.candidateId,
    null,
    "Design output supplies requirement context; it does not replace corrected RepoA/RepoB implementation results",
  );

  const state = readJson(path.join(root, initialized.stateRoot, "wakeflow-state.json"));
  assert.deepEqual(
    state.targetTasks
      .filter((task) => task.targetTaskId.startsWith("PRODUCT-"))
      .map((task) => [task.targetTaskId, task.status]),
    [
      ["PRODUCT-TASK-A", "needs-rework"],
      ["PRODUCT-TASK-B", "needs-rework"],
    ],
    "parked product tasks remain explicitly unaccepted until corrected product work returns",
  );
});
