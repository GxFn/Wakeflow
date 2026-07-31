// Host-neutral complete Pod lifecycle.
//
// These tests intentionally do not preserve the retired implementation where
// Wakeflow created Git worktrees, maintained a derived repository overlay, or
// deleted branches on close. The host test harness creates its own worktree
// only when fabricating a provisioning receipt.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runSync(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const podScript = path.join(repoRoot, "core/scripts/wakeflow-pod.mjs");
const coreStateScript = path.join(repoRoot, "core/scripts/wakeflow-state.mjs");
// Thread registration and dispatchability are Codex host behavior, so these
// integration assertions must cross the Codex plugin entrypoint. The core
// tree deliberately has no host-send adapter and is not a valid substitute.
const deliveryScript = path.join(
  repoRoot,
  "plugins/codex-wakeflow/scripts/wakeflow-delivery.mjs",
);

function git(cwd, args) {
  const result = runSync(
    "git",
    ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-pod-host-managed-"));
  const heads = {};
  for (const name of ["RepoA", "RepoB"]) {
    const repositoryRoot = path.join(root, name);
    mkdirSync(repositoryRoot, { recursive: true });
    runSync("git", ["init", "-q", "-b", "main", repositoryRoot], { encoding: "utf8" });
    writeFileSync(path.join(repositoryRoot, "README.md"), `${name}\n`);
    git(repositoryRoot, ["add", "README.md"]);
    git(repositoryRoot, ["commit", "-q", "-m", "initial"]);
    heads[name] = git(repositoryRoot, ["rev-parse", "HEAD"]);
  }
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "PodFixture",
    controllerWindow: "Controller",
    designWindow: "Design",
    testWindow: "Test",
    activeLedgerRoot: ".wakeflow-active",
    workspaceCurrentDir: ".wakeflow-active/current",
    projectLedgerRoot: "wakeflow-ledger",
    repositories: [
      { windowName: "RepoA", path: "RepoA", role: "Fixture repo" },
      { windowName: "RepoB", path: "RepoB", role: "Second fixture repo" },
    ],
    // Retired capacity values deliberately remain: they must not affect an
    // explicitly authorized Pod.
    maxActiveDemands: 0,
    hosts: { codex: { maxStreamsPerRepo: 0 } },
  });
  return { root, heads };
}

function createDemand(root, demandKey, {
  state = "intake",
  mode = "isolated",
  podId = demandKey,
  selection = "explicit-user-pod",
  authorizationRef = "goal-stage-confirmation.md#pod",
} = {}) {
  const stateRoot = path.join(root, ".wakeflow-active/current", demandKey);
  mkdirSync(stateRoot, { recursive: true });
  const createdAt = "2026-07-31T00:00:00.000Z";
  const controllerState = {
    schemaVersion: 1,
    demandKey,
    title: `Demand ${demandKey}`,
    controllerHost: null,
    controllerWindow: `Controller__${podId}`,
    executionPlacement: { mode, podId: mode === "isolated" ? podId : null, selection, authorizationRef },
    state,
    stateReason: "fixture",
    revision: 1,
    activeStageId: null,
    updatedAt: createdAt,
    allowedActions: [],
    blockers: [],
    decisionsRequired: [],
    stages: [],
    taskPackages: [],
    targetTasks: [],
    windows: [],
    review: {
      status: "none",
      readyResultIds: [],
      blockedResultIds: [],
      missingResultIds: [],
    },
    automation: { enabled: false, activeRunIds: [], lastReviewPack: null },
    projection: {
      status: "stale",
      lastRenderedAt: createdAt,
      progressDoc: "developer-progress.md",
    },
  };
  writeJson(path.join(stateRoot, "wakeflow-state.json"), controllerState);
  writeFileSync(path.join(stateRoot, "controller-events.jsonl"), `${JSON.stringify({
    eventId: `evt-${demandKey}-0001`,
    createdAt,
    actor: "controller",
    type: "state.initialized",
    from: null,
    to: state,
    reason: "fixture",
    evidenceRefs: [],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: [],
    stateRevision: 1,
  })}\n`);
  return stateRoot;
}

function pod(root, command, flag = null, value = null, extra = [], write = true) {
  const args = [podScript, command, "--root", root];
  if (flag) args.push(flag, typeof value === "string" ? value : JSON.stringify(value));
  args.push(...extra);
  if (write && command !== "list") args.push("--write");
  args.push("--json");
  return runSync(process.execPath, args, { encoding: "utf8", cwd: root });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function openRequest(demandKey, heads, repositories = ["RepoA", "RepoB"]) {
  return {
    demandKey,
    host: "codex",
    repositories: repositories.map((windowName) => ({
      windowName,
      expectedBaseHead: heads[windowName],
      basePolicy: "local-head",
    })),
  };
}

function registryDir(root) {
  return path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry");
}

function podAuthoritySnapshot(root, stateRoot, podId) {
  const hostRoot = path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/codex");
  const operationDir = path.join(hostRoot, "pod-operations");
  return {
    state: readFileSync(path.join(stateRoot, "wakeflow-state.json"), "utf8"),
    events: readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8"),
    manifest: readFileSync(path.join(hostRoot, "pod-manifests", `${podId}.json`), "utf8"),
    operations: existsSync(operationDir)
      ? Object.fromEntries(readdirSync(operationDir)
          .filter((name) => name.endsWith(".json"))
          .sort()
          .map((name) => [name, readFileSync(path.join(operationDir, name), "utf8")]))
      : {},
  };
}

function threadIdFor(windowName) {
  const hex = createHash("sha256").update(windowName).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function writeRegistry(root, windowName, bindingId, threadId = threadIdFor(windowName)) {
  writeJson(path.join(registryDir(root), `${windowName}.json`), {
    kind: "CodexWindowThreadRegistration",
    version: 3,
    windowName,
    bindingId,
    threadId,
    registeredAt: "2026-07-31T00:01:00.000Z",
    lastVerifiedAt: "2026-07-31T00:01:00.000Z",
  });
  return threadId;
}

function registerWindow(
  root,
  stateRoot,
  operation,
  bindingId = operation.registrationBindingId,
  threadId = threadIdFor(operation.windowName),
) {
  const result = runSync(process.execPath, [
    deliveryScript,
    "register-thread",
    "--root", root,
    "--window", operation.windowName,
    "--thread-id", threadId,
    "--launch-correlation-id", operation.launchCorrelationId,
    "--binding-id", bindingId,
    "--state-root", stateRoot,
    "--write",
    "--json",
  ], { encoding: "utf8", cwd: root });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return threadId;
}

function controlReceipt({
  root,
  stateRoot,
  operation,
  bindingId = operation.registrationBindingId,
  threadId = undefined,
}) {
  registerWindow(root, stateRoot, operation, bindingId, threadId);
  return {
    launchCorrelationId: operation.launchCorrelationId,
    windowName: operation.windowName,
    host: "codex",
    bindingId,
    handleRegistered: true,
    handleKind: "final",
    stateRootRelative: path.relative(root, stateRoot).split(path.sep).join("/"),
    actualCwd: root,
    createdAt: "2026-07-31T00:02:00.000Z",
  };
}

function createHostWorktree(root, repositoryWindow, podId, head) {
  const repositoryRoot = path.join(root, repositoryWindow);
  const actualCwd = path.join(root, ".host-owned-worktrees", `${repositoryWindow}__${podId}`);
  mkdirSync(path.dirname(actualCwd), { recursive: true });
  git(repositoryRoot, ["worktree", "add", "--detach", actualCwd, head]);
  return {
    actualCwd: realpathSync(actualCwd),
    gitTopLevel: realpathSync(actualCwd),
    gitCommonDir: realpathSync(path.join(repositoryRoot, ".git")),
  };
}

function productReceipt({
  root,
  stateRoot,
  operation,
  bindingId = operation.registrationBindingId,
  identity,
}) {
  registerWindow(root, stateRoot, operation, bindingId);
  return {
    launchCorrelationId: operation.launchCorrelationId,
    windowName: operation.windowName,
    host: "codex",
    bindingId,
    handleRegistered: true,
    handleKind: "final",
    stateRootRelative: path.relative(root, stateRoot).split(path.sep).join("/"),
    actualCwd: identity.actualCwd,
    gitTopLevel: identity.gitTopLevel,
    gitCommonDir: identity.gitCommonDir,
    head: operation.expectedBaseHead,
    branch: null,
    detached: true,
    mainCheckout: false,
    createdAt: "2026-07-31T00:03:00.000Z",
  };
}

function completeDemand(stateRoot) {
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile);
  const nextRevision = state.revision + 1;
  const createdAt = "2026-07-31T01:00:00.000Z";
  writeJson(stateFile, {
    ...state,
    state: "completed",
    stateReason: "fixture completed",
    revision: nextRevision,
    updatedAt: createdAt,
    projection: { ...state.projection, status: "stale" },
  });
  writeFileSync(eventsFile, `${JSON.stringify({
    eventId: `evt-${state.demandKey}-complete-${nextRevision}`,
    createdAt,
    actor: "controller",
    type: "demand.completed",
    from: state.state,
    to: "completed",
    reason: "fixture completed",
    evidenceRefs: [],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: ["completion-is-archive"],
    stateRevision: nextRevision,
  })}\n`, { flag: "a" });
}

function bindAllControls(root, stateRoot, plan) {
  const outputs = [];
  for (const operation of plan.operations
    .filter((item) => ["controller", "design", "test"].includes(item.role))) {
    outputs.push(parseOk(pod(root, "bind", "--receipt-json", controlReceipt({
      root,
      stateRoot,
      operation,
    }))));
  }
  return outputs;
}

function materializeReadyPod(
  root,
  heads,
  demandKey,
  repositoryWindows = ["RepoA"],
) {
  const stateRoot = createDemand(root, demandKey);
  const controls = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest(demandKey, heads, []),
  ));
  bindAllControls(root, stateRoot, controls);
  const designRequest = prepareDesignRequest(root, demandKey);
  parseOk(pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    validHandoff(demandKey, demandKey, repositoryWindows, designRequest),
  ));
  const expanded = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest(demandKey, heads, repositoryWindows),
  ));
  const operations = expanded.operations.filter((item) => item.role === "product");
  const identities = operations.map((operation) => {
    const identity = createHostWorktree(
      root,
      operation.repositoryWindow,
      demandKey,
      operation.expectedBaseHead,
    );
    parseOk(pod(root, "bind", "--receipt-json", productReceipt({
      root,
      stateRoot,
      operation,
      identity,
    })));
    return identity;
  });
  return { stateRoot, operations, identities };
}

function materializeReadySingleRepoPod(root, heads, demandKey) {
  const { stateRoot, operations, identities } = materializeReadyPod(
    root,
    heads,
    demandKey,
  );
  return {
    stateRoot,
    operation: operations[0],
    identity: identities[0],
  };
}

function testAccessPlanFile(root, probeId) {
  return path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-test-access-plans",
    `${probeId}.json`,
  );
}

function testAccessReceiptFile(root, probeId) {
  return path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-test-access-receipts",
    `${probeId}.json`,
  );
}

function validTestAccessReceipt(plan) {
  return {
    probeId: plan.probeId,
    demandKey: plan.demandKey,
    podId: plan.podId,
    host: plan.host,
    testWindowName: plan.testWindowName,
    testBindingId: plan.testBindingId,
    status: "validated",
    capability: "direct-multi-root",
    productAccess: plan.probeTargets.map((target) => ({
      windowName: target.windowName,
      repositoryWindow: target.repositoryWindow,
      bindingId: target.bindingId,
      rootDigest: target.expectedRootDigest,
      gitTopLevelDigest: target.expectedGitTopLevelDigest,
      head: target.expectedHead,
      readable: true,
      gitIdentityVerified: true,
    })),
    observedAt: "2026-07-31T00:10:00.000Z",
  };
}

function runCoreState(root, args) {
  return runSync(process.execPath, [
    coreStateScript,
    ...args,
    "--root", root,
    "--json",
  ], { encoding: "utf8", cwd: root });
}

function runCoreDelivery(root, args) {
  const runtimeRoot = path.join(root, ".wakeflow-test-core-runtime");
  if (!existsSync(runtimeRoot)) {
    cpSync(path.join(repoRoot, "core"), runtimeRoot, { recursive: true });
    for (const file of [
      "wakeflow-host-artifact-checks.mjs",
      "wakeflow-host-send-adapter.mjs",
    ]) {
      copyFileSync(
        path.join(repoRoot, "plugins/codex-wakeflow/scripts/lib", file),
        path.join(runtimeRoot, "scripts/lib", file),
      );
    }
  }
  return runSync(process.execPath, [
    path.join(runtimeRoot, "scripts/wakeflow-delivery.mjs"),
    ...args,
    "--root", root,
    "--json",
  ], { encoding: "utf8", cwd: root });
}

function addCompletedPodTarget(root, stateRoot, operation, evidenceRef) {
  const stateRootRef = path.relative(root, stateRoot);
  const add = runCoreState(root, [
    "add-task-package",
    "--state-root", stateRootRef,
    "--task-package-id", "PKG-EVIDENCE",
    "--summary", "Review evidence from the bound Pod worktree.",
    "--target-window", operation.windowName,
    "--target-task-id", "TASK-EVIDENCE",
    "--write",
  ]);
  assert.equal(add.status, 0, add.stderr || add.stdout);
  const imported = runCoreState(root, [
    "import-target-result",
    "--state-root", stateRootRef,
    "--target-task-id", "TASK-EVIDENCE",
    "--target-window", operation.windowName,
    "--status", "completed",
    "--result-id", "RESULT-EVIDENCE",
    "--evidence-ref", evidenceRef,
    "--write",
  ]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);
}

function validDesignRequest(demandKey, podId, requestType = "initial-design") {
  return {
    demandKey,
    podId,
    requestType,
    originalGoal: `Complete ${demandKey} without changing its confirmed scope.`,
    requirementAnchors: ["goal-stage-confirmation.md#goal", "goal-stage-confirmation.md#completion"],
    codeEvidenceRefs: ["evidence/repository-facts.json"],
    pausedTargetIdentity: requestType === "redesign" ? { targetTaskId: "task-paused" } : null,
    pausedReviewIdentity: requestType === "redesign" ? { candidateId: "review-paused" } : null,
    nonGoals: ["Do not create a second demand."],
    decisionsRequired: [],
  };
}

function prepareDesignRequest(root, demandKey, podId = demandKey, requestType = "initial-design") {
  return parseOk(pod(
    root,
    "prepare-design-request",
    "--request-json",
    validDesignRequest(demandKey, podId, requestType),
  ));
}

function validHandoff(
  demandKey,
  podId,
  repositories = ["RepoA", "RepoB"],
  designRequest,
) {
  assert.ok(designRequest, "validHandoff requires the frozen Pod Design request record");
  return {
    demandKey,
    podId,
    designRequestId: designRequest.requestId,
    designRequestRef: designRequest.requestRef,
    designRequestDigest: designRequest.requestDigest,
    requestType: designRequest.requestType,
    preservesOriginalGoal: true,
    requirementAnchors: ["goal-stage-confirmation.md#goal", "goal-stage-confirmation.md#completion"],
    evidenceRefs: ["evidence/repository-facts.json"],
    userConfirmationRefs: ["controller-events.jsonl#evt-user-pod"],
    landingPlan: repositories.map((repositoryWindow) => ({
      repositoryWindow,
      responsibility: `Implement ${repositoryWindow} portion`,
    })),
    designIntent: "Preserve the confirmed goal and isolate each repository in its host worktree.",
    testDecision: "Run confirmed environment tests only after controller acceptance.",
    environmentSpec: { authority: "requirement-design", scope: "pod-bound-worktrees" },
  };
}

test("open emits a complete host-owned launch plan without touching Git or a derived overlay", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-A");
  const beforeBranches = {
    RepoA: git(path.join(root, "RepoA"), ["branch", "--format=%(refname)"]),
    RepoB: git(path.join(root, "RepoB"), ["branch", "--format=%(refname)"]),
  };

  const preview = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-A", heads),
    [],
    false,
  ));
  assert.equal(preview.wrote, false);
  assert.equal(existsSync(path.join(root, ".wakeflow-local")), false);
  assert.equal("podProvisioning" in readJson(path.join(stateRoot, "wakeflow-state.json")), false);

  const plan = parseOk(pod(root, "open", "--request-json", openRequest("POD-A", heads)));
  assert.equal(plan.kind, "WakeflowPodLaunchPlan");
  assert.equal(plan.phase, "creating-control");
  assert.deepEqual(
    plan.operations.map(({ role, windowName }) => ({ role, windowName })),
    [
      { role: "controller", windowName: "Controller__POD-A" },
      { role: "design", windowName: "Design__POD-A" },
      { role: "test", windowName: "Test__POD-A" },
      { role: "product", windowName: "RepoA__POD-A" },
      { role: "product", windowName: "RepoB__POD-A" },
    ],
  );
  for (const operation of plan.operations) {
    assert.match(operation.launchCorrelationId, /^pod-launch-/);
    assert.match(operation.registrationBindingId, /^pod-binding-/);
    assert.ok(operation.createPrompt);
    if (operation.role !== "product") {
      assert.equal(operation.expectedControlRoot, realpathSync(root));
    }
    assert.equal("actualCwd" in operation, false);
    assert.equal("branch" in operation, false);
  }
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees")), false);
  assert.equal(existsSync(path.join(root, ".wakeflow-local/wakeflow.config.json")), false);
  assert.equal(git(path.join(root, "RepoA"), ["branch", "--format=%(refname)"]), beforeBranches.RepoA);
  assert.equal(git(path.join(root, "RepoB"), ["branch", "--format=%(refname)"]), beforeBranches.RepoB);

  const tracked = readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning;
  assert.equal(tracked.phase, "creating-control");
  assert.equal(JSON.stringify(tracked).includes(root), false, "tracked state must not contain host-local paths");
  assert.equal(JSON.stringify(tracked).includes(heads.RepoA), false, "tracked state must not contain Git facts");

  const revisionBeforeResume = readJson(path.join(stateRoot, "wakeflow-state.json")).revision;
  const resumed = parseOk(pod(root, "open", "--request-json", openRequest("POD-A", heads)));
  assert.deepEqual(
    resumed.operations.map((item) => item.launchCorrelationId),
    plan.operations.map((item) => item.launchCorrelationId),
    "retry must reuse launch correlations",
  );
  assert.deepEqual(
    resumed.operations.map((item) => item.registrationBindingId),
    plan.operations.map((item) => item.registrationBindingId),
    "retry must reuse deterministic registration binding ids",
  );
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).revision,
    revisionBeforeResume,
    "an exact retry must not append another state transition",
  );
});

test("materialization journal prevents blind async host retries and never stores a temporary handle", () => {
  const { root, heads } = makeWorkspace();
  createDemand(root, "POD-ASYNC");
  const plan = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-ASYNC", heads, []),
  ));
  const operation = plan.operations.find((item) => item.role === "controller");
  assert.match(operation.createPrompt, new RegExp(operation.launchCorrelationId));

  const creating = {
    launchCorrelationId: operation.launchCorrelationId,
    host: "codex",
    status: "creating",
    observedAt: "2026-07-31T00:01:00.000Z",
  };
  const started = parseOk(pod(
    root,
    "record-materialization",
    "--attempt-json",
    creating,
  ));
  assert.equal(started.status, "creating");
  assert.equal(started.recoveryCorrelationId, operation.launchCorrelationId);
  assert.equal(started.recoveryMatchPolicy, "exactly-one-final-session");

  const blindRetry = pod(
    root,
    "record-materialization",
    "--attempt-json",
    {
      ...creating,
      observedAt: "2026-07-31T00:01:01.000Z",
    },
  );
  assert.notEqual(blindRetry.status, 0);
  assert.match(blindRetry.stderr, /Discover the existing session/i);

  const pending = parseOk(pod(
    root,
    "record-materialization",
    "--attempt-json",
    {
      launchCorrelationId: operation.launchCorrelationId,
      host: "codex",
      status: "pending",
      observedAt: "2026-07-31T00:02:00.000Z",
      hostRequestId: "client-thread-temporary-secret",
    },
  ));
  assert.equal(pending.status, "pending");
  assert.match(pending.agentNext, /do not call the create tool again/i);

  const operationFile = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations",
    `${operation.launchCorrelationId}.json`,
  );
  const persisted = readFileSync(operationFile, "utf8");
  assert.doesNotMatch(persisted, /client-thread-temporary-secret/);
  assert.match(persisted, /hostRequestIdDigest/);

  const duplicateRequest = pod(
    root,
    "record-materialization",
    "--attempt-json",
    {
      launchCorrelationId: operation.launchCorrelationId,
      host: "codex",
      status: "pending",
      observedAt: "2026-07-31T00:03:00.000Z",
      hostRequestId: "different-client-thread",
    },
  );
  assert.notEqual(duplicateRequest.status, 0);
  assert.match(duplicateRequest.stderr, /cannot be replaced/i);

  const finalized = parseOk(pod(
    root,
    "record-materialization",
    "--attempt-json",
    {
      launchCorrelationId: operation.launchCorrelationId,
      host: "codex",
      status: "finalized",
      observedAt: "2026-07-31T00:04:00.000Z",
    },
  ));
  assert.equal(finalized.status, "finalized");
});

test("standard S0 sequence creates controls first and append-only product intents after Design handoff", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-STAGED");
  const controls = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-STAGED", heads, []),
  ));
  assert.deepEqual(
    controls.operations.map((item) => item.role),
    ["controller", "design", "test"],
  );
  assert.equal(controls.phase, "creating-control");
  const controlIdentity = controls.operations.map((item) => ({
    windowName: item.windowName,
    launchCorrelationId: item.launchCorrelationId,
    registrationBindingId: item.registrationBindingId,
  }));
  const beforeEarlyProducts = podAuthoritySnapshot(root, stateRoot, "POD-STAGED");
  const earlyProducts = pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-STAGED", heads, ["RepoA"]),
  );
  assert.equal(earlyProducts.status, 1);
  assert.match(JSON.parse(earlyProducts.stderr).error, /only after.*Design handoff/i);
  assert.deepEqual(podAuthoritySnapshot(root, stateRoot, "POD-STAGED"), beforeEarlyProducts);

  bindAllControls(root, stateRoot, controls);
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.phase,
    "control-ready",
  );
  const designRequest = prepareDesignRequest(root, "POD-STAGED");
  const handoff = validHandoff(
    "POD-STAGED",
    "POD-STAGED",
    ["RepoA"],
    designRequest,
  );
  const recorded = parseOk(pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    handoff,
  ));
  assert.equal(recorded.phase, "creating-products");

  const beforeWrongCoverage = podAuthoritySnapshot(root, stateRoot, "POD-STAGED");
  const wrongCoverage = pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-STAGED", heads, ["RepoB"]),
  );
  assert.equal(wrongCoverage.status, 1);
  assert.match(JSON.parse(wrongCoverage.stderr).error, /exactly match.*landingPlan/i);
  assert.deepEqual(
    podAuthoritySnapshot(root, stateRoot, "POD-STAGED"),
    beforeWrongCoverage,
    "out-of-handoff repository coverage must be rejected with zero state/operation writes",
  );

  const expanded = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-STAGED", heads, ["RepoA"]),
  ));
  assert.deepEqual(
    expanded.operations
      .filter((item) => item.role !== "product")
      .map((item) => ({
        windowName: item.windowName,
        launchCorrelationId: item.launchCorrelationId,
        registrationBindingId: item.registrationBindingId,
      })),
    controlIdentity,
    "reopen must preserve every existing control correlation and registration binding id",
  );
  assert.deepEqual(
    expanded.operations.filter((item) => item.role === "product")
      .map((item) => item.repositoryWindow),
    ["RepoA"],
  );
  assert.equal(expanded.phase, "creating-products");
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.windows.length,
    4,
  );

  const beforeRemoval = podAuthoritySnapshot(root, stateRoot, "POD-STAGED");
  const removal = pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-STAGED", heads, []),
  );
  assert.equal(removal.status, 1);
  assert.match(JSON.parse(removal.stderr).error, /cannot remove or replace/i);
  assert.deepEqual(podAuthoritySnapshot(root, stateRoot, "POD-STAGED"), beforeRemoval);

  const changedHeads = { ...heads, RepoA: "f".repeat(40) };
  const modified = pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-STAGED", changedHeads, ["RepoA"]),
  );
  assert.equal(modified.status, 1);
  assert.match(
    JSON.parse(modified.stderr).error,
    /cannot remove or replace|Expected base HEAD/i,
  );
  assert.deepEqual(
    podAuthoritySnapshot(root, stateRoot, "POD-STAGED"),
    beforeRemoval,
    "changing an existing product intent must be rejected with zero writes",
  );

  const product = expanded.operations.find((item) => item.role === "product");
  const identity = createHostWorktree(
    root,
    product.repositoryWindow,
    "POD-STAGED",
    product.expectedBaseHead,
  );
  const bound = parseOk(pod(root, "bind", "--receipt-json", productReceipt({
    root,
    stateRoot,
    operation: product,
    identity,
  })));
  assert.equal(bound.phase, "execution-ready");
  const ready = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(ready.state, "planned");
  assert.equal(ready.podProvisioning.phase, "execution-ready");
});

test("open requires explicit Pod authority and rejects a cross-host request before writing operations", () => {
  const missingAuthority = makeWorkspace();
  createDemand(missingAuthority.root, "POD-NO-AUTH", { authorizationRef: null });
  const noAuth = pod(
    missingAuthority.root,
    "open",
    "--request-json",
    openRequest("POD-NO-AUTH", missingAuthority.heads, ["RepoA"]),
  );
  assert.equal(noAuth.status, 1);
  assert.match(JSON.parse(noAuth.stderr).error, /authorizationRef/);

  const main = makeWorkspace();
  createDemand(main.root, "MAIN-A", {
    mode: "main",
    podId: null,
    selection: "mainline-default",
    authorizationRef: null,
  });
  const mainRefused = pod(main.root, "open", "--request-json", openRequest("MAIN-A", main.heads, ["RepoA"]));
  assert.equal(mainRefused.status, 1);
  assert.match(JSON.parse(mainRefused.stderr).error, /main placement/);

  const spoofed = makeWorkspace();
  createDemand(spoofed.root, "POD-HOST");
  const request = { ...openRequest("POD-HOST", spoofed.heads, ["RepoA"]), host: "claude-code" };
  const wrongHost = pod(spoofed.root, "open", "--request-json", request);
  assert.equal(wrongHost.status, 1);
  assert.match(JSON.parse(wrongHost.stderr).error, /current runtime host codex/);
  assert.equal(existsSync(path.join(spoofed.root, ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations")), false);
});

test("multiple explicitly authorized Pods can plan the same repository despite retired numeric caps", () => {
  const { root, heads } = makeWorkspace();
  for (const demandKey of ["POD-1", "POD-2", "POD-3"]) {
    createDemand(root, demandKey);
    const plan = parseOk(pod(
      root,
      "open",
      "--request-json",
      openRequest(demandKey, heads, ["RepoA"]),
    ));
    assert.equal(plan.operations.filter((item) => item.role === "product").length, 1);
  }
  assert.equal(existsSync(path.join(root, ".wakeflow-local/worktrees")), false);
});

test("a Pod-shaped suffix alone cannot register a host window", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-REGISTER");
  const plan = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-REGISTER", heads, ["RepoA"]),
  ));
  const controller = plan.operations.find((item) => item.role === "controller");
  const refused = runSync(process.execPath, [
    deliveryScript,
    "register-thread",
    "--root", root,
    "--window", controller.windowName,
    "--thread-id", threadIdFor(controller.windowName),
    "--write",
    "--json",
  ], { encoding: "utf8", cwd: root });
  assert.equal(refused.status, 1, refused.stderr || refused.stdout);
  assert.match(JSON.parse(refused.stderr || refused.stdout).error, /requires --launch-correlation-id/);

  const inventedBinding = runSync(process.execPath, [
    deliveryScript,
    "register-thread",
    "--root", root,
    "--window", controller.windowName,
    "--thread-id", threadIdFor(controller.windowName),
    "--launch-correlation-id", controller.launchCorrelationId,
    "--binding-id", "host-invented-binding",
    "--state-root", stateRoot,
    "--write",
    "--json",
  ], { encoding: "utf8", cwd: root });
  assert.equal(inventedBinding.status, 1, inventedBinding.stderr || inventedBinding.stdout);
  assert.match(JSON.parse(inventedBinding.stderr || inventedBinding.stdout).error, /registrationBindingId/);
});

test("bind validates exact identity, is idempotent, and cannot bypass the Design gate", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-BIND");
  const plan = parseOk(pod(root, "open", "--request-json", openRequest("POD-BIND", heads)));

  const product = plan.operations.find((item) => item.windowName === "RepoA__POD-BIND");
  const invalid = productReceipt({
    root,
    stateRoot,
    operation: product,
    identity: {
      actualCwd: realpathSync(path.join(root, "RepoA")),
      gitTopLevel: realpathSync(path.join(root, "RepoA")),
      gitCommonDir: realpathSync(path.join(root, "RepoA/.git")),
    },
  });
  invalid.mainCheckout = true;
  const refused = pod(root, "bind", "--receipt-json", invalid);
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stderr).error, /main checkout/);

  const identity = createHostWorktree(root, "RepoA", "POD-BIND", heads.RepoA);
  const valid = productReceipt({
    root,
    stateRoot,
    operation: product,
    identity,
  });
  const revisionBeforePreview = readJson(path.join(stateRoot, "wakeflow-state.json")).revision;
  const preview = parseOk(pod(root, "bind", "--receipt-json", valid, [], false));
  assert.equal(preview.wrote, false);
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).revision,
    revisionBeforePreview,
  );
  assert.equal(
    existsSync(path.join(
      root,
      ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-bindings/POD-BIND/RepoA__POD-BIND.json",
    )),
    false,
    "bind dry-run must not create a host-local binding",
  );
  const first = parseOk(pod(root, "bind", "--receipt-json", valid));
  assert.equal(first.status, "bound");
  assert.equal(first.phase, "creating-control");
  const again = parseOk(pod(root, "bind", "--receipt-json", valid));
  assert.equal(again.idempotent, true);
  assert.equal(again.phase, "creating-control");

  const controlResults = bindAllControls(root, stateRoot, plan);
  assert.equal(controlResults.at(-1).phase, "control-ready");
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.phase,
    "control-ready",
    "product binding must not advance past the Design handoff gate",
  );
});

test("controls-only Pod freezes one Design request before accepting its matching handoff", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-DESIGN-REQUEST");
  const controls = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-DESIGN-REQUEST", heads, []),
  ));
  const request = validDesignRequest(
    "POD-DESIGN-REQUEST",
    "POD-DESIGN-REQUEST",
  );
  const tooEarly = pod(
    root,
    "prepare-design-request",
    "--request-json",
    request,
  );
  assert.equal(tooEarly.status, 1);
  assert.match(JSON.parse(tooEarly.stderr).error, /requires phase control-ready/);
  bindAllControls(root, stateRoot, controls);

  const missingRequestHandoff = validHandoff(
    "POD-DESIGN-REQUEST",
    "POD-DESIGN-REQUEST",
    ["RepoA"],
    {
      requestId: "pod-design-request-missing",
      requestRef: "pod-design-requests/missing.json",
      requestDigest: "missing",
      requestType: "initial-design",
    },
  );
  const missing = pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    missingRequestHandoff,
  );
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stderr).error, /requires a prepared immutable.*Design request/i);

  const preview = parseOk(pod(
    root,
    "prepare-design-request",
    "--request-json",
    request,
    [],
    false,
  ));
  assert.equal(preview.wrote, false);
  assert.equal(preview.phase, "designing");
  assert.equal(existsSync(path.join(stateRoot, preview.requestRef)), false);
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.phase,
    "control-ready",
  );

  const prepared = parseOk(pod(
    root,
    "prepare-design-request",
    "--request-json",
    request,
  ));
  assert.equal(prepared.phase, "designing");
  assert.match(prepared.requestId, /^pod-design-request-[0-9a-f]{32}$/);
  assert.equal(
    prepared.requestRef,
    `pod-design-requests/${prepared.requestDigest}.json`,
  );
  const requestFile = path.join(stateRoot, prepared.requestRef);
  const requestArtifact = readJson(requestFile);
  assert.equal(requestArtifact.originalGoal, request.originalGoal);
  assert.deepEqual(requestArtifact.requirementAnchors, request.requirementAnchors);
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.designRequestId,
    prepared.requestId,
  );
  const stateAfterRequest = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(stateAfterRequest.state, "intake");
  assert.deepEqual(stateAfterRequest.targetTasks, []);
  assert.equal(stateAfterRequest.review.status, "none");

  const same = parseOk(pod(
    root,
    "prepare-design-request",
    "--request-json",
    request,
  ));
  assert.equal(same.idempotent, true);
  const different = pod(
    root,
    "prepare-design-request",
    "--request-json",
    { ...request, originalGoal: "A different goal must not replace the frozen request." },
  );
  assert.equal(different.status, 1);
  assert.match(JSON.parse(different.stderr).error, /immutable Design request/);

  const handoff = validHandoff(
    "POD-DESIGN-REQUEST",
    "POD-DESIGN-REQUEST",
    ["RepoA"],
    prepared,
  );
  const wrongRequest = pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    { ...handoff, designRequestId: "pod-design-request-wrong" },
  );
  assert.equal(wrongRequest.status, 1);
  assert.match(JSON.parse(wrongRequest.stderr).error, /exact frozen Design request id\/ref\/digest/);
  const wrongAnchors = pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    { ...handoff, requirementAnchors: ["goal-stage-confirmation.md#other"] },
  );
  assert.equal(wrongAnchors.status, 1);
  assert.match(JSON.parse(wrongAnchors.stderr).error, /requirementAnchors.*exactly match/);

  const recorded = parseOk(pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    handoff,
  ));
  assert.equal(recorded.phase, "creating-products");
  const repeated = parseOk(pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    handoff,
  ));
  assert.equal(repeated.idempotent, true);

  const revisionBeforeTamperCheck = readJson(
    path.join(stateRoot, "wakeflow-state.json"),
  ).revision;
  writeJson(requestFile, {
    ...requestArtifact,
    originalGoal: "tampered after record",
  });
  const tampered = pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    handoff,
  );
  assert.equal(tampered.status, 1);
  assert.match(JSON.parse(tampered.stderr).error, /no longer matches its frozen identity/);
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).revision,
    revisionBeforeTamperCheck,
  );
});

test("Design handoff is recorded under the state root and execution-ready needs every product binding", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-DESIGN");
  const plan = parseOk(pod(root, "open", "--request-json", openRequest("POD-DESIGN", heads)));
  const productWindow = plan.operations.find((item) => item.role === "product");
  const beforeBinding = parseOk(runSync(process.execPath, [
    deliveryScript,
    "build-window-config",
    "--root", root,
    "--window", productWindow.windowName,
    "--json",
  ], { encoding: "utf8", cwd: root }));
  assert.equal(beforeBinding.config.dispatchable, false);
  bindAllControls(root, stateRoot, plan);

  const designRequest = prepareDesignRequest(root, "POD-DESIGN");
  const handoff = validHandoff(
    "POD-DESIGN",
    "POD-DESIGN",
    ["RepoA", "RepoB"],
    designRequest,
  );
  const handoffPreview = parseOk(pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    handoff,
    [],
    false,
  ));
  assert.equal(handoffPreview.wrote, false);
  assert.equal(handoffPreview.phase, "creating-products");
  assert.equal(
    existsSync(path.join(stateRoot, handoffPreview.handoffRef)),
    false,
    "Design handoff dry-run must not create the anchored artifact",
  );
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.designHandoffRef,
    undefined,
  );
  const recorded = parseOk(pod(root, "record-design-handoff", "--handoff-json", handoff));
  assert.equal(recorded.phase, "creating-products");
  assert.equal(recorded.pendingProductWindowNames.length, 2);
  const handoffFile = path.join(stateRoot, recorded.handoffRef);
  assert.equal(existsSync(handoffFile), true);
  assert.deepEqual(readJson(handoffFile), handoff);

  for (const [index, operation] of plan.operations.filter((item) => item.role === "product").entries()) {
    const identity = createHostWorktree(
      root,
      operation.repositoryWindow,
      "POD-DESIGN",
      operation.expectedBaseHead,
    );
    const result = parseOk(pod(root, "bind", "--receipt-json", productReceipt({
      root,
      stateRoot,
      operation,
      identity,
    })));
    if (index === 0) assert.equal(result.phase, "creating-products");
    if (index === 1) assert.equal(result.phase, "execution-ready");
  }
  const ready = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(ready.podProvisioning.phase, "execution-ready");
  assert.equal(ready.state, "planned");
  const afterReady = parseOk(runSync(process.execPath, [
    deliveryScript,
    "build-window-config",
    "--root", root,
    "--window", productWindow.windowName,
    "--require-thread",
    "--json",
  ], { encoding: "utf8", cwd: root }));
  assert.equal(afterReady.config.dispatchable, true);
  assert.equal(afterReady.config.pod.phase, "execution-ready");
});

test("Pod Test dispatch needs an exact direct-multi-root access receipt without leaking roots", () => {
  const { root, heads } = makeWorkspace();
  const demandKey = "POD-TEST-ACCESS";
  const { stateRoot, operations } = materializeReadyPod(
    root,
    heads,
    demandKey,
    ["RepoA", "RepoB"],
  );
  const [operation] = operations;
  const testWindow = `Test__${demandKey}`;

  const productReady = parseOk(runCoreDelivery(root, [
    "build-window-config",
    "--window", operation.windowName,
    "--require-thread",
  ]));
  assert.equal(productReady.config.dispatchable, true);

  const beforeProbe = parseOk(runCoreDelivery(root, [
    "build-window-config",
    "--window", testWindow,
    "--require-thread",
  ]));
  assert.equal(beforeProbe.config.dispatchable, false);
  assert.equal(beforeProbe.config.pod.phase, "execution-ready");
  assert.deepEqual(beforeProbe.config.pod.testAccess, {
    status: "missing",
    capability: null,
    probeId: null,
  });

  const prepared = parseOk(pod(
    root,
    "prepare-test-access",
    null,
    null,
    ["--demand-key", demandKey],
  ));
  assert.equal(prepared.kind, "WakeflowPodTestAccessProbe");
  assert.equal(prepared.status, "pending");
  assert.equal(prepared.capability, "pending");
  assert.equal(prepared.productBindingCount, 2);
  assert.equal(JSON.stringify(prepared).includes(root), false);

  const planFile = testAccessPlanFile(root, prepared.probeId);
  assert.equal(existsSync(planFile), true);
  const plan = readJson(planFile);
  assert.equal(plan.kind, "WakeflowPodTestAccessProbePlan");
  assert.equal(plan.probeTargets.length, 2);
  assert.equal(plan.probeTargets[0].actualRoot, realpathSync(path.dirname(
    path.join(plan.probeTargets[0].actualRoot, "placeholder"),
  )));

  const trackedPending = readJson(
    path.join(stateRoot, "wakeflow-state.json"),
  ).podProvisioning.testAccess;
  assert.equal(trackedPending.status, "pending");
  assert.equal(trackedPending.capability, "pending");
  assert.equal(JSON.stringify(trackedPending).includes(root), false);

  const pendingConfig = parseOk(runCoreDelivery(root, [
    "build-window-config",
    "--window", testWindow,
    "--require-thread",
  ]));
  assert.equal(pendingConfig.config.dispatchable, false);
  assert.equal(pendingConfig.config.pod.testAccess.status, "pending");

  const validReceipt = validTestAccessReceipt(plan);
  const incomplete = structuredClone(validReceipt);
  incomplete.productAccess.pop();
  const incompleteResult = pod(
    root,
    "record-test-access",
    "--receipt-json",
    incomplete,
  );
  assert.equal(incompleteResult.status, 1);
  assert.match(
    JSON.parse(incompleteResult.stderr).error,
    /cover all 2 product bindings exactly once/,
  );
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json"))
      .podProvisioning.testAccess.status,
    "pending",
  );

  const tampered = structuredClone(validReceipt);
  tampered.productAccess[0].rootDigest = "0".repeat(64);
  const rejected = pod(
    root,
    "record-test-access",
    "--receipt-json",
    tampered,
  );
  assert.equal(rejected.status, 1);
  assert.match(
    JSON.parse(rejected.stderr).error,
    /does not match the exact bound root\/Git identity/,
  );
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json"))
      .podProvisioning.testAccess.status,
    "pending",
  );

  const recorded = parseOk(pod(
    root,
    "record-test-access",
    "--receipt-json",
    validReceipt,
  ));
  assert.equal(recorded.status, "validated");
  assert.equal(recorded.capability, "direct-multi-root");
  assert.equal(JSON.stringify(recorded).includes(root), false);
  const localReceipt = readJson(testAccessReceiptFile(root, prepared.probeId));
  assert.equal(localReceipt.kind, "WakeflowPodTestAccessProbeReceipt");
  assert.equal(localReceipt.productAccess.length, 2);
  assert.equal(JSON.stringify(localReceipt).includes(root), false);
  const revisionAfterRecord = readJson(
    path.join(stateRoot, "wakeflow-state.json"),
  ).revision;
  const repeated = parseOk(pod(
    root,
    "record-test-access",
    "--receipt-json",
    validReceipt,
  ));
  assert.equal(repeated.idempotent, true);
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).revision,
    revisionAfterRecord,
  );

  const trackedValidated = readJson(
    path.join(stateRoot, "wakeflow-state.json"),
  ).podProvisioning.testAccess;
  assert.equal(trackedValidated.status, "validated");
  assert.equal(trackedValidated.capability, "direct-multi-root");
  assert.equal(JSON.stringify(trackedValidated).includes(root), false);
  assert.equal("productAccess" in trackedValidated, false);
  assert.equal(
    readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8")
      .includes(root),
    false,
  );
  assert.equal(
    readdirSync(stateRoot).some((name) => name.startsWith("pod-test-access-")),
    false,
    "exact Test access plans and receipts must remain host-local",
  );

  const afterReceipt = parseOk(runCoreDelivery(root, [
    "build-window-config",
    "--window", testWindow,
    "--require-thread",
  ]));
  assert.equal(afterReceipt.config.dispatchable, true);
  assert.equal(afterReceipt.config.pod.dispatchGate, "open");
  assert.deepEqual(afterReceipt.config.pod.testAccess, {
    status: "validated",
    capability: "direct-multi-root",
    probeId: prepared.probeId,
  });
  const inventory = parseOk(pod(root, "list", null, null, [], false));
  const listed = inventory.pods.find((item) => item.podId === demandKey);
  assert.deepEqual(listed.testAccess, {
    probeId: prepared.probeId,
    status: "validated",
    capability: "direct-multi-root",
    productBindingCount: 2,
  });
  assert.equal(JSON.stringify(listed).includes(root), false);
});

test("unsupported Pod Test access stays blocked without a main-checkout or product-window fallback", () => {
  const { root, heads } = makeWorkspace();
  const demandKey = "POD-TEST-BLOCKED";
  const { stateRoot, operation } = materializeReadySingleRepoPod(
    root,
    heads,
    demandKey,
  );
  const prepared = parseOk(pod(
    root,
    "prepare-test-access",
    null,
    null,
    ["--demand-key", demandKey],
  ));
  const plan = readJson(testAccessPlanFile(root, prepared.probeId));
  const blocked = parseOk(pod(
    root,
    "record-test-access",
    "--receipt-json",
    {
      probeId: plan.probeId,
      demandKey: plan.demandKey,
      podId: plan.podId,
      host: plan.host,
      testWindowName: plan.testWindowName,
      testBindingId: plan.testBindingId,
      status: "blocked",
      capability: "per-repo-executor-unavailable",
      reasonCode: "per-repo-executor-unavailable",
      observedAt: "2026-07-31T00:11:00.000Z",
    },
  ));
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasonCode, "per-repo-executor-unavailable");
  assert.equal(JSON.stringify(blocked).includes(root), false);

  const tracked = readJson(
    path.join(stateRoot, "wakeflow-state.json"),
  ).podProvisioning;
  assert.equal(tracked.phase, "execution-ready");
  assert.equal(tracked.testAccess.status, "blocked");
  assert.equal(JSON.stringify(tracked).includes(root), false);

  const testConfig = parseOk(runCoreDelivery(root, [
    "build-window-config",
    "--window", `Test__${demandKey}`,
    "--require-thread",
  ]));
  assert.equal(testConfig.config.dispatchable, false);
  assert.equal(testConfig.config.pod.dispatchGate, "blocked");
  assert.equal(testConfig.config.cwd, realpathSync(root));

  const productConfig = parseOk(runCoreDelivery(root, [
    "build-window-config",
    "--window", operation.windowName,
    "--require-thread",
  ]));
  assert.equal(productConfig.config.dispatchable, true);
  assert.notEqual(productConfig.config.cwd, realpathSync(root));
});

test("Controller, Design, and Test cannot bind the same final host session", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-SESSIONS");
  const plan = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-SESSIONS", heads, ["RepoA"]),
  ));
  const controller = plan.operations.find((item) => item.role === "controller");
  const design = plan.operations.find((item) => item.role === "design");
  const sharedThreadId = threadIdFor(controller.windowName);
  parseOk(pod(root, "bind", "--receipt-json", {
    ...controlReceipt({
      root,
      stateRoot,
      operation: controller,
      threadId: sharedThreadId,
    }),
  }));
  writeRegistry(root, design.windowName, design.registrationBindingId, sharedThreadId);
  const actual = pod(root, "bind", "--receipt-json", {
    launchCorrelationId: design.launchCorrelationId,
    windowName: design.windowName,
    host: "codex",
    bindingId: design.registrationBindingId,
    handleRegistered: true,
    handleKind: "final",
    stateRootRelative: path.relative(root, stateRoot).split(path.sep).join("/"),
    actualCwd: root,
    createdAt: "2026-07-31T00:02:00.000Z",
  });
  assert.equal(actual.status, 1, actual.stderr || actual.stdout);
  assert.match(JSON.parse(actual.stderr).error, /distinct binding\/final-session identities/);
});

test("control bindings must match their launch intent control root exactly", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-CONTROL-CWD");
  const plan = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-CONTROL-CWD", heads, []),
  ));
  const controller = plan.operations.find((item) => item.role === "controller");
  registerWindow(root, stateRoot, controller);
  const refused = pod(root, "bind", "--receipt-json", {
    launchCorrelationId: controller.launchCorrelationId,
    windowName: controller.windowName,
    host: "codex",
    bindingId: controller.registrationBindingId,
    handleRegistered: true,
    handleKind: "final",
    stateRootRelative: path.relative(root, stateRoot).split(path.sep).join("/"),
    actualCwd: realpathSync(path.join(root, "RepoA")),
    createdAt: "2026-07-31T00:02:00.000Z",
  });
  assert.equal(refused.status, 1, refused.stderr || refused.stdout);
  assert.match(JSON.parse(refused.stderr).error, /expectedControlRoot/);
});

test("final handles are unique across Pods and concurrent product binds cannot share an actual worktree cwd", async () => {
  const { root, heads } = makeWorkspace();
  const firstRoot = createDemand(root, "POD-GLOBAL-1");
  const secondRoot = createDemand(root, "POD-GLOBAL-2");
  const firstPlan = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-GLOBAL-1", heads, ["RepoA"]),
  ));
  const secondPlan = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest("POD-GLOBAL-2", heads, ["RepoA"]),
  ));

  const firstController = firstPlan.operations.find((item) => item.role === "controller");
  const secondController = secondPlan.operations.find((item) => item.role === "controller");
  const sharedThread = threadIdFor("cross-pod-shared-controller");
  parseOk(pod(root, "bind", "--receipt-json", controlReceipt({
    root,
    stateRoot: firstRoot,
    operation: firstController,
    threadId: sharedThread,
  })));
  writeRegistry(
    root,
    secondController.windowName,
    secondController.registrationBindingId,
    sharedThread,
  );
  const reusedHandle = pod(root, "bind", "--receipt-json", {
    launchCorrelationId: secondController.launchCorrelationId,
    windowName: secondController.windowName,
    host: "codex",
    bindingId: secondController.registrationBindingId,
    handleRegistered: true,
    handleKind: "final",
    stateRootRelative: path.relative(root, secondRoot).split(path.sep).join("/"),
    actualCwd: root,
    createdAt: "2026-07-31T00:02:00.000Z",
  });
  assert.equal(reusedHandle.status, 1, reusedHandle.stderr || reusedHandle.stdout);
  assert.match(JSON.parse(reusedHandle.stderr).error, /distinct binding\/final-session identities/);

  const firstProduct = firstPlan.operations.find((item) => item.role === "product");
  const secondProduct = secondPlan.operations.find((item) => item.role === "product");
  const sharedWorktree = createHostWorktree(
    root,
    "RepoA",
    "POD-GLOBAL-SHARED",
    heads.RepoA,
  );
  const firstProductReceipt = productReceipt({
    root,
    stateRoot: firstRoot,
    operation: firstProduct,
    identity: sharedWorktree,
  });
  const secondProductReceipt = productReceipt({
    root,
    stateRoot: secondRoot,
    operation: secondProduct,
    identity: sharedWorktree,
  });
  const concurrent = await Promise.all([
    runAsync(process.execPath, [
      podScript,
      "bind",
      "--root", root,
      "--receipt-json", JSON.stringify(firstProductReceipt),
      "--write",
      "--json",
    ], { cwd: root }),
    runAsync(process.execPath, [
      podScript,
      "bind",
      "--root", root,
      "--receipt-json", JSON.stringify(secondProductReceipt),
      "--write",
      "--json",
    ], { cwd: root }),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.status).sort(),
    [0, 1],
    concurrent.map((result) => result.stderr || result.stdout).join("\n"),
  );
  const refusedProduct = concurrent.find((result) => result.status !== 0);
  assert.match(
    JSON.parse(refusedProduct.stderr).error,
    /cannot share the same host worktree cwd/,
  );
});

test("logical close waits for host receipts and never deletes a host-owned worktree", () => {
  const { root, heads } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-CLOSE");
  const plan = parseOk(pod(root, "open", "--request-json", openRequest("POD-CLOSE", heads, ["RepoA"])));
  bindAllControls(root, stateRoot, plan);
  const designRequest = prepareDesignRequest(root, "POD-CLOSE");
  parseOk(pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    validHandoff("POD-CLOSE", "POD-CLOSE", ["RepoA"], designRequest),
  ));
  const product = plan.operations.find((item) => item.role === "product");
  const identity = createHostWorktree(root, "RepoA", "POD-CLOSE", product.expectedBaseHead);
  parseOk(pod(root, "bind", "--receipt-json", productReceipt({
    root,
    stateRoot,
    operation: product,
    identity,
  })));
  completeDemand(stateRoot);

  const closePreview = parseOk(pod(
    root,
    "close",
    null,
    null,
    ["--demand-key", "POD-CLOSE"],
    false,
  ));
  assert.equal(closePreview.wrote, false);
  assert.equal(closePreview.phase, "closing");
  assert.equal(
    readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.phase,
    "execution-ready",
    "close dry-run must not advance canonical provisioning",
  );
  for (const operation of closePreview.operations) {
    assert.equal(
      existsSync(path.join(
        root,
        ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-operations",
        `${operation.closeCorrelationId}.json`,
      )),
      false,
      "close dry-run must not persist host operations",
    );
  }
  const closePlan = parseOk(pod(root, "close", null, null, ["--demand-key", "POD-CLOSE"]));
  assert.equal(closePlan.phase, "closing");
  assert.equal(closePlan.operations.length, 4);
  assert.equal(existsSync(identity.actualCwd), true);

  for (const [index, operation] of closePlan.operations.entries()) {
    const receipt = {
      closeCorrelationId: operation.closeCorrelationId,
      bindingId: operation.bindingId,
      windowName: operation.windowName,
      host: "codex",
      sessionStatus: "archived",
      worktreeStatus: operation.role === "product" ? "retained" : "not-applicable",
      confirmedAt: "2026-07-31T02:00:00.000Z",
    };
    if (index === 0) {
      const receiptPreview = parseOk(pod(
        root,
        "record-close-receipt",
        "--receipt-json",
        receipt,
        [],
        false,
      ));
      assert.equal(receiptPreview.wrote, false);
      assert.equal(
        readJson(path.join(stateRoot, "wakeflow-state.json")).podProvisioning.windows
          .find((item) => item.windowName === operation.windowName).status,
        "bound",
        "close receipt dry-run must not release the logical binding",
      );
    }
    const result = parseOk(pod(root, "record-close-receipt", "--receipt-json", receipt));
    assert.equal(result.status, "logically-closed");
  }
  const closed = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(closed.podProvisioning.phase, "closed");
  assert.equal(existsSync(identity.actualCwd), true, "Wakeflow must not physically remove a host worktree");

  const listed = parseOk(pod(root, "list"));
  const item = listed.pods.find((podItem) => podItem.demandKey === "POD-CLOSE");
  assert.equal(item.phase, "closed");
  assert.equal(JSON.stringify(item).includes(identity.actualCwd), false);
});

test("cancelled Pod archives only after its exact close plan has every host receipt", () => {
  const { root, heads } = makeWorkspace();
  const demandKey = `POD-CANCEL-ARCHIVE-${path.basename(root).slice(-6)}`;
  const stateRoot = createDemand(root, demandKey);
  const stateRootRef = path.relative(root, stateRoot);
  const plan = parseOk(pod(
    root,
    "open",
    "--request-json",
    openRequest(demandKey, heads, ["RepoA"]),
  ));
  bindAllControls(root, stateRoot, plan);
  const designRequest = prepareDesignRequest(root, demandKey);
  parseOk(pod(
    root,
    "record-design-handoff",
    "--handoff-json",
    validHandoff(
      demandKey,
      demandKey,
      ["RepoA"],
      designRequest,
    ),
  ));
  const product = plan.operations.find((item) => item.role === "product");
  const identity = createHostWorktree(
    root,
    "RepoA",
    demandKey,
    product.expectedBaseHead,
  );
  parseOk(pod(root, "bind", "--receipt-json", productReceipt({
    root,
    stateRoot,
    operation: product,
    identity,
  })));

  const cancelled = runCoreState(root, [
    "cancel-demand",
    "--state-root", stateRootRef,
    "--reason", "real close-order regression",
    "--write",
  ]);
  assert.equal(cancelled.status, 0, cancelled.stderr || cancelled.stdout);
  assert.equal(readJson(path.join(stateRoot, "wakeflow-state.json")).state, "cancelled");

  const closePlan = parseOk(pod(
    root,
    "close",
    null,
    null,
    ["--demand-key", demandKey],
  ));
  assert.equal(closePlan.operations.length, 4);

  for (const operation of closePlan.operations.slice(0, -1)) {
    parseOk(pod(root, "record-close-receipt", "--receipt-json", {
      closeCorrelationId: operation.closeCorrelationId,
      bindingId: operation.bindingId,
      windowName: operation.windowName,
      host: "codex",
      sessionStatus: "archived",
      worktreeStatus: operation.role === "product" ? "retained" : "not-applicable",
      confirmedAt: "2026-07-31T02:10:00.000Z",
    }));
  }
  const missingReceiptArchive = runCoreState(root, [
    "archive-demand",
    "--state-root", stateRootRef,
    "--reason", "must still refuse",
    "--write",
  ]);
  assert.equal(
    missingReceiptArchive.status,
    1,
    missingReceiptArchive.stderr || missingReceiptArchive.stdout,
  );
  assert.match(
    JSON.parse(missingReceiptArchive.stdout).error,
    /close lifecycle.*pod\.closed|not closed/i,
  );

  const finalOperation = closePlan.operations.at(-1);
  parseOk(pod(root, "record-close-receipt", "--receipt-json", {
    closeCorrelationId: finalOperation.closeCorrelationId,
    bindingId: finalOperation.bindingId,
    windowName: finalOperation.windowName,
    host: "codex",
    sessionStatus: "archived",
    worktreeStatus: finalOperation.role === "product" ? "retained" : "not-applicable",
    confirmedAt: "2026-07-31T02:11:00.000Z",
  }));

  const archived = runCoreState(root, [
    "archive-demand",
    "--state-root", stateRootRef,
    "--reason", "cancelled Pod fully closed",
    "--write",
  ]);
  assert.equal(archived.status, 0, archived.stderr || archived.stdout);
  assert.equal(existsSync(stateRoot), false);
  assert.equal(existsSync(identity.actualCwd), true, "archive must not remove the host worktree");
});

test("archive rejects a post-cancel Pod close event after the canonical pod.closed event", () => {
  const { root } = makeWorkspace();
  const stateRoot = createDemand(root, "POD-CLOSE-EVENT-ORDER");
  const stateRootRef = path.relative(root, stateRoot);
  const cancelled = runCoreState(root, [
    "cancel-demand",
    "--state-root", stateRootRef,
    "--reason", "zero-resource close-order fixture",
    "--write",
  ]);
  assert.equal(cancelled.status, 0, cancelled.stderr || cancelled.stdout);
  parseOk(pod(
    root,
    "close",
    null,
    null,
    ["--demand-key", "POD-CLOSE-EVENT-ORDER"],
  ));

  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile);
  const nextRevision = state.revision + 1;
  const createdAt = "2026-07-31T02:20:00.000Z";
  writeJson(stateFile, {
    ...state,
    revision: nextRevision,
    updatedAt: createdAt,
  });
  writeFileSync(eventsFile, `${JSON.stringify({
    eventId: `evt-pod-invalid-after-close-${nextRevision}`,
    createdAt,
    actor: "controller",
    type: "pod.window-logically-closed",
    from: "closed",
    to: "closed",
    reason: "invalid extra receipt event",
    evidenceRefs: [],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: [
      "pod-resource-state-is-demand-acceptance",
      "host-receipt-is-product-result",
      "logical-close-proves-physical-worktree-removal",
    ],
    stateRevision: nextRevision,
  })}\n`, { flag: "a" });

  const refused = runCoreState(root, [
    "archive-demand",
    "--state-root", stateRootRef,
    "--reason", "must reject wrong close order",
    "--write",
  ]);
  assert.equal(refused.status, 1, refused.stderr || refused.stdout);
  assert.match(
    JSON.parse(refused.stdout).error,
    /close lifecycle.*pod\.closed|zero-resource close.*pod\.closed|invalid Pod close event/i,
  );
  assert.equal(existsSync(stateRoot), true);
});

test("request, receipt, and handoff inputs accept JSON files but reject dual sources", () => {
  const { root, heads } = makeWorkspace();
  createDemand(root, "POD-FILE");
  const requestFile = path.join(root, "request.json");
  writeJson(requestFile, openRequest("POD-FILE", heads, ["RepoA"]));
  const planned = parseOk(pod(root, "open", "--request-file", requestFile));
  assert.equal(planned.operations.length, 4);

  const dual = runSync(process.execPath, [
    podScript,
    "open",
    "--root", root,
    "--request-file", requestFile,
    "--request-json", JSON.stringify(openRequest("POD-FILE", heads, ["RepoA"])),
    "--json",
  ], { encoding: "utf8", cwd: root });
  assert.equal(dual.status, 1);
  assert.match(JSON.parse(dual.stderr).error, /exactly one/);
});

test("Pod review and reducer resolve relative evidence only from the verified binding actualCwd", () => {
  const { root, heads } = makeWorkspace();
  const {
    stateRoot,
    operation,
    identity,
  } = materializeReadySingleRepoPod(root, heads, "POD-EVIDENCE");
  const evidenceRef = "reports/pod-evidence.json";
  writeJson(path.join(identity.actualCwd, evidenceRef), { source: "pod-worktree" });
  addCompletedPodTarget(root, stateRoot, operation, evidenceRef);

  const reviewed = runCoreDelivery(root, [
    "review-pack",
    "--state-root", path.relative(root, stateRoot),
  ]);
  assert.equal(reviewed.status, 0, reviewed.stderr || reviewed.stdout);
  const reviewPack = JSON.parse(reviewed.stdout).reviewPack;
  assert.equal(reviewPack.missingEvidenceRefs.length, 0);
  assert.equal(
    reviewPack.targetResults[0].evidenceRefSummaries[0].resolvedAgainst,
    "pod-binding-actual-cwd",
  );

  const reduced = runCoreState(root, [
    "reduce-results",
    "--state-root", path.relative(root, stateRoot),
    "--write",
  ]);
  assert.equal(reduced.status, 0, reduced.stderr || reduced.stdout);
  assert.equal(JSON.parse(reduced.stdout).nextState, "review-ready");
});

test("Pod review and reducer never fall back to a base repo and fail closed without the active binding", () => {
  const baseFallback = makeWorkspace();
  const first = materializeReadySingleRepoPod(
    baseFallback.root,
    baseFallback.heads,
    "POD-NO-BASE-FALLBACK",
  );
  const evidenceRef = "reports/base-only.json";
  writeJson(path.join(baseFallback.root, "RepoA", evidenceRef), { source: "main-checkout" });
  addCompletedPodTarget(
    baseFallback.root,
    first.stateRoot,
    first.operation,
    evidenceRef,
  );

  const reviewed = runCoreDelivery(baseFallback.root, [
    "review-pack",
    "--state-root", path.relative(baseFallback.root, first.stateRoot),
  ]);
  assert.equal(reviewed.status, 0, reviewed.stderr || reviewed.stdout);
  const reviewPack = JSON.parse(reviewed.stdout).reviewPack;
  assert.deepEqual(
    reviewPack.missingEvidenceRefs.map((item) => item.ref),
    [evidenceRef],
    "a same-named file in the main checkout is not Pod evidence",
  );
  const reduced = runCoreState(baseFallback.root, [
    "reduce-results",
    "--state-root", path.relative(baseFallback.root, first.stateRoot),
    "--write",
  ]);
  assert.equal(reduced.status, 1, reduced.stderr || reduced.stdout);
  assert.equal(JSON.parse(reduced.stdout).reviewGate, "evidence-repair-required");

  const missingBinding = makeWorkspace();
  const second = materializeReadySingleRepoPod(
    missingBinding.root,
    missingBinding.heads,
    "POD-MISSING-BINDING",
  );
  writeJson(path.join(second.identity.actualCwd, evidenceRef), { source: "pod-worktree" });
  addCompletedPodTarget(
    missingBinding.root,
    second.stateRoot,
    second.operation,
    evidenceRef,
  );
  unlinkSync(path.join(
    missingBinding.root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/pod-bindings",
    "POD-MISSING-BINDING",
    `${second.operation.windowName}.json`,
  ));

  for (const result of [
    runCoreDelivery(missingBinding.root, [
      "review-pack",
      "--state-root", path.relative(missingBinding.root, second.stateRoot),
    ]),
    runCoreState(missingBinding.root, [
      "reduce-results",
      "--state-root", path.relative(missingBinding.root, second.stateRoot),
      "--write",
    ]),
  ]) {
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(
      JSON.parse(result.stdout).error,
      /must have exactly one active host binding/,
    );
  }
});

test("state schema keeps provisioning phases nested and excludes them from the top-level state enum", () => {
  const schema = readJson(path.join(
    repoRoot,
    "core/schemas/wakeflow-state-machine/wakeflow-state.schema.json",
  ));
  const topLevelStates = schema.properties.state.enum;
  assert.equal(topLevelStates.includes("creating-control"), false);
  assert.equal(topLevelStates.includes("designing"), false);
  assert.deepEqual(schema.properties.podProvisioning.properties.phase.enum, [
    "reserved",
    "creating-control",
    "control-ready",
    "designing",
    "creating-products",
    "execution-ready",
    "retryable",
    "blocked",
    "cancelling",
    "closing",
    "closed",
  ]);
  assert.equal(
    schema.properties.podProvisioning.properties.designRequestId.type,
    "string",
  );
  assert.equal(
    schema.properties.podProvisioning.properties.designRequestRef.type,
    "string",
  );
  assert.deepEqual(
    schema.properties.podProvisioning.properties.testAccess.properties.status.enum,
    ["pending", "validated", "blocked"],
  );
  assert.deepEqual(
    schema.properties.podProvisioning.properties.testAccess.properties.capability.enum,
    [
      "pending",
      "direct-multi-root",
      "unsupported",
      "per-repo-executor-unavailable",
    ],
  );
});

// Stable forward invariant retained from the previous suite.
test("every MCP handler script is on the runtime allow-list", async () => {
  const { listWakeflowRuntimeScripts } = await import("../core/lib/wakeflow-runtime.mjs");
  const allowed = new Set(listWakeflowRuntimeScripts());
  const source = readFileSync(path.join(repoRoot, "core/lib/wakeflow-mcp-tools.mjs"), "utf8");
  const referenced = [...new Set([...source.matchAll(/script:\s*"([a-z-]+)"/g)].map((match) => match[1]))];
  assert.ok(referenced.includes("wakeflow-pod"), "the pod tools reference the wakeflow-pod script");
  assert.deepEqual(
    referenced.filter((name) => !allowed.has(name)),
    [],
    "MCP handlers must not reference scripts missing from the runtime allow-list",
  );
});

test("the retired Claude stream suite is gone instead of silently skipped", () => {
  assert.equal(existsSync(path.join(repoRoot, "test/wakeflow-claude-stream.test.mjs")), false);
  assert.equal(
    readdirSync(path.join(repoRoot, "test")).some((name) => name === "wakeflow-claude-stream.test.mjs"),
    false,
  );
});
