import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const helperScript = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs",
);
const claudePodScript = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/claude-code-wakeflow/scripts/wakeflow-pod.mjs",
);
const tmuxPresent = spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0;

function git(cwd, gitArgs) {
  const result = spawnSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeWorkspace() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "claude-pod-host-")));
  const repo = path.join(root, "RepoA");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "wakeflow-test@example.invalid"]);
  git(repo, ["config", "user.name", "Wakeflow Test"]);
  writeFileSync(path.join(repo, "README.md"), "host worktree fixture\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "fixture"]);
  mkdirSync(path.join(root, "Design"), { recursive: true });
  mkdirSync(path.join(root, "Test"), { recursive: true });
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify({
    workspaceName: "ClaudePodFlow",
    controllerWindow: "ClaudePodFlow",
    designWindow: "Design",
    testWindow: "Test",
    internalDesignPath: "Design",
    internalTestPath: "Test",
    maxActiveDemands: 0,
    maxStreamsPerRepo: 0,
    repositories: [{ windowName: "RepoA", path: "RepoA", role: "Repository window" }],
  }));
  return { root, repo };
}

function runHelper(root, helperArgs, env = {}) {
  return runSync(process.execPath, [helperScript, ...helperArgs, "--root", root], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, ...env },
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function createCanonicalPodPlan(root, demandKey, expectedBaseHead) {
  const stateRoot = path.join(root, ".wakeflow-active/current", demandKey);
  mkdirSync(stateRoot, { recursive: true });
  const createdAt = "2026-07-31T00:00:00.000Z";
  writeFileSync(path.join(stateRoot, "wakeflow-state.json"), `${JSON.stringify({
    schemaVersion: 1,
    demandKey,
    title: `Demand ${demandKey}`,
    controllerHost: null,
    controllerWindow: `Controller__${demandKey}`,
    executionPlacement: {
      mode: "isolated",
      podId: demandKey,
      selection: "explicit-user-pod",
      authorizationRef: "goal-stage-confirmation.md#pod",
    },
    state: "intake",
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
  }, null, 2)}\n`);
  writeFileSync(path.join(stateRoot, "controller-events.jsonl"), `${JSON.stringify({
    eventId: `evt-${demandKey}-init`,
    createdAt,
    actor: "controller",
    type: "demand.initialized",
    from: null,
    to: "intake",
    reason: "fixture",
    evidenceRefs: [],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: [],
    stateRevision: 1,
  })}\n`);
  const result = runSync(process.execPath, [
    claudePodScript,
    "open",
    "--root", root,
    "--request-json", JSON.stringify({
      demandKey,
      host: "claude-code",
      repositories: [{
        windowName: "RepoA",
        expectedBaseHead,
        basePolicy: "local-head",
      }],
    }),
    "--write",
    "--json",
  ], { encoding: "utf8", cwd: root });
  return parseOk(result);
}

function recoveryPlanFromLaunch(root, launchPlan) {
  const stateRoot = path.join(root, ".wakeflow-active/current", launchPlan.demandKey);
  const state = JSON.parse(readFileSync(path.join(stateRoot, "wakeflow-state.json"), "utf8"));
  return {
    kind: "WakeflowPodResumePlan",
    mode: "resume",
    demandKey: launchPlan.demandKey,
    podId: launchPlan.podId,
    host: "claude-code",
    phase: state.podProvisioning.phase,
    stateRevision: state.revision,
    operations: launchPlan.operations.map((operation) => ({
      demandKey: operation.demandKey,
      podId: operation.podId,
      windowName: operation.windowName,
      role: operation.role,
      ...(operation.repositoryWindow
        ? {
            repositoryWindow: operation.repositoryWindow,
            repositoryRoot: operation.repositoryRoot,
          }
        : {}),
      host: "claude-code",
      environmentIntent: operation.environmentIntent,
      displayTitle: operation.displayTitle,
      launchCorrelationId: operation.launchCorrelationId,
      registrationBindingId: operation.registrationBindingId,
      stateRootRelative: operation.stateRootRelative,
      hostAction: "verify-live-or-resume-same-session",
      requiresCoreBind: false,
      recovery: {
        mode: "resume",
        bindingId: operation.registrationBindingId,
        actualCwd: operation.role === "product"
          ? operation.repositoryRoot
          : root,
      },
    })),
    readOnly: true,
  };
}

test("Claude Pod dry-run plans complete host-owned sessions and performs zero Git/host mutation", () => {
  const { root, repo } = makeWorkspace();
  const head = git(repo, ["rev-parse", "HEAD"]);
  const canonicalPlan = createCanonicalPodPlan(root, "native-host-pod", head);
  const planFile = path.join(root, "canonical-pod-plan.json");
  writeFileSync(planFile, `${JSON.stringify(canonicalPlan, null, 2)}\n`);
  const before = git(repo, ["worktree", "list", "--porcelain"]);
  const payload = parseOk(runHelper(root, [
    "pod-open",
    "--plan-file", planFile,
    "--no-launch",
  ]));
  const after = git(repo, ["worktree", "list", "--porcelain"]);

  assert.equal(payload.status, "planned");
  assert.equal(payload.hostOperationsPerformed, 0);
  assert.equal(payload.quantityLimit, null, "legacy numeric caps are not admission gates");
  assert.deepEqual(
    payload.launchPlan.map((entry) => entry.role),
    ["controller", "design", "test", "product"],
  );
  assert.ok(payload.launchPlan.some((entry) => entry.windowName === "Design__native-host-pod"));

  const product = payload.launchPlan.find((entry) => entry.role === "product");
  assert.equal(product.environmentIntent, "host-worktree");
  assert.equal(product.repositoryRoot, repo);
  assert.equal(product.basePolicy, "local-head");
  assert.equal(product.nativeBasePolicy, "head");
  assert.equal(product.expectedBaseHead, head);
  assert.equal(product.nativeArgvIntent.filter((arg) => arg === "--worktree").length, 1);
  assert.ok(product.nativeArgvIntent.includes(product.hostWorktreeName));
  assert.ok(product.nativeArgvIntent.includes("--settings"));
  assert.deepEqual(
    product.addDirectories,
    [path.join(root, ".wakeflow-active/current/native-host-pod")],
    "product access is limited to its exact Pod state root, never the whole workspace",
  );
  assert.ok(!product.nativeArgvIntent.includes("--tmux"));
  assert.ok(!product.nativeArgvIntent.includes("--add-dir"));

  assert.equal(before, after, "dry-run must not create a worktree");
  assert.equal(
    existsSync(path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host")),
    false,
    "helper dry-run must not create host sessions or window bindings",
  );
  rmSync(root, { recursive: true, force: true });
});

test("Claude rejects stale Pod recovery authority before any tmux or worktree mutation", () => {
  for (const scenario of [
    {
      name: "revision",
      mutate(state) {
        state.revision += 1;
      },
    },
    {
      name: "placement",
      mutate(state) {
        state.executionPlacement.podId = `${state.executionPlacement.podId}-other`;
      },
    },
    {
      name: "provisioning",
      mutate(state) {
        state.podProvisioning.podId = `${state.podProvisioning.podId}-other`;
      },
    },
  ]) {
    const { root, repo } = makeWorkspace();
    const demandKey = `stale-recovery-${scenario.name}`;
    const head = git(repo, ["rev-parse", "HEAD"]);
    const launchPlan = createCanonicalPodPlan(root, demandKey, head);
    const recoveryPlan = recoveryPlanFromLaunch(root, launchPlan);
    const stateFile = path.join(
      root,
      ".wakeflow-active/current",
      demandKey,
      "wakeflow-state.json",
    );
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    scenario.mutate(state);
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const planFile = path.join(root, `recovery-${scenario.name}.json`);
    writeFileSync(planFile, `${JSON.stringify(recoveryPlan, null, 2)}\n`);
    const worktreesBefore = git(repo, ["worktree", "list", "--porcelain"]);

    const result = runHelper(root, [
      "pod-open",
      "--plan-file", planFile,
      "--no-launch",
    ]);
    assert.notEqual(result.status, 0, result.stdout || result.stderr);
    assert.match(
      JSON.parse(result.stderr || result.stdout).error,
      /recovery plan is stale|terminal\/closing phase/i,
    );
    assert.equal(
      existsSync(path.join(
        root,
        ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host",
      )),
      false,
      `${scenario.name}: stale authority must fail before host binding creation`,
    );
    assert.equal(
      git(repo, ["worktree", "list", "--porcelain"]),
      worktreesBefore,
      `${scenario.name}: stale authority must fail before native worktree creation`,
    );
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude product launch uses native --worktree once, verifies Git receipt, and resume omits --worktree", { skip: !tmuxPresent }, (t) => {
  const { root, repo } = makeWorkspace();
  const socket = `wf-native-${process.pid}-${Date.now()}`;
  const session = `wf-native-session-${process.pid}`;
  const worktreeRoot = mkdtempSync(path.join(os.tmpdir(), "claude-native-worktree-"));
  const argvLog = path.join(root, "claude-argv.log");
  const stub = path.join(root, "stub-claude");
  const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  writeFileSync(stub, `#!/bin/sh
{
  printf '%s\\n' BEGIN
  printf '%s\\n' "$@"
  printf '%s\\n' END
} >> ${shellQuote(argvLog)}
worktree_name=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--worktree" ]; then
    shift
    worktree_name="$1"
  fi
  shift
done
if [ -n "$worktree_name" ]; then
  target=${shellQuote(worktreeRoot)}/"$worktree_name"
  git worktree add --detach "$target" HEAD >/dev/null 2>&1 || exit 42
  cd "$target" || exit 43
fi
exec cat
`, { mode: 0o755 });

  let actualCwd = null;
  t.after(() => {
    spawnSync("tmux", ["-L", socket, "kill-server"], { encoding: "utf8" });
    if (actualCwd && existsSync(actualCwd)) {
      spawnSync("git", ["-C", repo, "worktree", "remove", "--force", actualCwd], { encoding: "utf8" });
    }
    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  const head = git(repo, ["rev-parse", "HEAD"]);
  const canonicalPlan = createCanonicalPodPlan(root, "native-host-pod", head);
  const productOperation = canonicalPlan.operations.find((entry) => entry.role === "product");
  const commonEnv = {
    WAKEFLOW_CLAUDE_BIN: stub,
    WAKEFLOW_DISABLE_MONITOR: "1",
  };
  const first = parseOk(runHelper(root, [
    "launch-window",
    "--socket", socket,
    "--server", session,
    "--window", productOperation.windowName,
    "--title", "RepoA Pod",
    "--cwd", repo,
    "--environment-intent", "host-worktree",
    "--repository-root", repo,
    "--host-worktree", "wakeflow-native-host-pod-repoa",
    "--expected-base-head", head,
    "--launch-correlation-id", productOperation.launchCorrelationId,
    "--binding-id", productOperation.registrationBindingId,
    "--pod-id", "native-host-pod",
    "--state-root-relative", ".wakeflow-active/current/native-host-pod",
    "--boot-wait-ms", "200",
    "--no-auto-trust",
  ], commonEnv));

  assert.equal(first.hostReceipt.environmentIntent, "host-worktree");
  assert.equal(first.hostReceipt.gitTopLevel, first.hostReceipt.actualCwd);
  assert.equal(first.hostReceipt.head, head);
  assert.equal(first.hostReceipt.mainCheckout, false);
  assert.equal(first.hostReceipt.launchCorrelationId, productOperation.launchCorrelationId);
  assert.equal(first.hostReceipt.stateRootRelative, ".wakeflow-active/current/native-host-pod");
  assert.equal(first.hostReceipt.handleResolved, true);
  assert.equal(first.hostReceipt.handleKind, "final");
  assert.equal(first.hostReceipt.handleRegistered, true);
  assert.equal(first.sessionId, undefined, "Pod output must not reveal the final session id");
  assert.equal(first.windowId, undefined, "Pod output must not reveal the tmux handle");
  actualCwd = first.hostReceipt.actualCwd;
  assert.notEqual(actualCwd, repo);
  const firstBinding = JSON.parse(readFileSync(path.join(root, first.bindingFile), "utf8"));
  assert.equal(firstBinding.bindingId, first.hostReceipt.bindingId);
  assert.ok(firstBinding.threadId, "the final handle remains in host-local binding storage");
  assert.doesNotMatch(JSON.stringify(first), new RegExp(firstBinding.threadId), "tool output redacts the final handle");
  const creationReceipt = structuredClone(firstBinding.hostReceipt);

  const firstArgs = readFileSync(argvLog, "utf8").split("\n");
  assert.equal(firstArgs.filter((arg) => arg === "--worktree").length, 1);
  assert.ok(firstArgs.includes("--settings"));
  assert.ok(!firstArgs.includes("--tmux"));
  assert.ok(!firstArgs.includes("--add-dir"), "Pod product launch gets no default workspace add-dir");
  assert.ok(!firstArgs.includes(root));

  const productRecoveryPlan = recoveryPlanFromLaunch(root, canonicalPlan);
  const productRecovery = productRecoveryPlan.operations.find(
    (operation) => operation.windowName === productOperation.windowName,
  );
  productRecovery.recovery.actualCwd = actualCwd;
  productRecoveryPlan.operations = [productRecovery];
  const recoveryPlanFile = path.join(root, "product-recovery-plan.json");
  writeFileSync(recoveryPlanFile, `${JSON.stringify(productRecoveryPlan, null, 2)}\n`);
  const registryDir = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry",
  );
  const canonicalRegistryFile = path.join(registryDir, `${productOperation.windowName}.json`);
  const transitionalRegistryFile = path.join(
    registryDir,
    `${createHash("sha256").update(JSON.stringify(productOperation.windowName)).digest("hex").slice(0, 12)}.json`,
  );
  writeFileSync(transitionalRegistryFile, readFileSync(canonicalRegistryFile));
  const ambiguousRegistry = runHelper(root, [
    "pod-open",
    "--plan-file", recoveryPlanFile,
    "--boot-wait-ms", "200",
  ], commonEnv);
  assert.notEqual(ambiguousRegistry.status, 0, ambiguousRegistry.stdout || ambiguousRegistry.stderr);
  assert.match(
    JSON.parse(ambiguousRegistry.stderr || ambiguousRegistry.stdout).error,
    /registry identity.*ambiguous across 2 files/i,
  );
  assert.equal(
    spawnSync("tmux", [
      "-L", socket,
      "display-message", "-p",
      "-t", firstBinding.tmux.windowId,
      "#{window_id}",
    ], { encoding: "utf8" }).stdout.trim(),
    firstBinding.tmux.windowId,
    "ambiguous recovery registry must fail before touching the live host window",
  );
  rmSync(transitionalRegistryFile, { force: true });

  const wrongIdentity = runHelper(root, [
    "launch-window",
    "--socket", socket,
    "--server", session,
    "--window", productOperation.windowName,
    "--title", "RepoA Pod",
    "--cwd", actualCwd,
    "--environment-intent", "host-worktree",
    "--repository-root", repo,
    "--expected-base-head", head,
    "--launch-correlation-id", productOperation.launchCorrelationId,
    "--binding-id", productOperation.registrationBindingId,
    "--pod-id", "native-host-pod",
    "--state-root-relative", ".wakeflow-active/current/native-host-pod",
    "--resume",
    "--session-id", "wrong-final-session",
    "--replace",
    "--boot-wait-ms", "200",
    "--no-auto-trust",
  ], commonEnv);
  assert.notEqual(wrongIdentity.status, 0, wrongIdentity.stdout || wrongIdentity.stderr);
  assert.match(
    JSON.parse(wrongIdentity.stderr || wrongIdentity.stdout).error,
    /Resume identity.*conflicts/i,
  );
  const stillLive = spawnSync("tmux", [
    "-L", socket,
    "display-message", "-p",
    "-t", firstBinding.tmux.windowId,
    "#{window_id}",
  ], { encoding: "utf8" });
  assert.equal(stillLive.status, 0, stillLive.stderr || stillLive.stdout);
  assert.equal(
    stillLive.stdout.trim(),
    firstBinding.tmux.windowId,
    "wrong immutable resume identity must fail before --replace kills the live window",
  );
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, first.bindingFile), "utf8")).hostReceipt,
    creationReceipt,
    "pre-mutation identity failure must leave creation evidence untouched",
  );

  writeFileSync(path.join(actualCwd, "POD-COMMIT.txt"), "advance the isolated worktree\n");
  git(actualCwd, ["add", "POD-COMMIT.txt"]);
  git(actualCwd, ["commit", "-m", "advance pod worktree"]);
  const podHead = git(actualCwd, ["rev-parse", "HEAD"]);
  assert.notEqual(podHead, head, "the resumed Pod must be allowed to move beyond its creation baseline");

  writeFileSync(path.join(repo, "MAIN-COMMIT.txt"), "advance the main checkout independently\n");
  git(repo, ["add", "MAIN-COMMIT.txt"]);
  git(repo, ["commit", "-m", "advance main checkout"]);
  const mainHead = git(repo, ["rev-parse", "HEAD"]);
  assert.notEqual(mainHead, head);
  assert.notEqual(mainHead, podHead, "main and Pod are now independent histories");

  spawnSync("tmux", ["-L", socket, "kill-window", "-t", firstBinding.tmux.windowId], { encoding: "utf8" });
  const failedVerification = runHelper(root, [
    "launch-window",
    "--socket", socket,
    "--server", session,
    "--window", productOperation.windowName,
    "--title", "RepoA Pod",
    "--cwd", repo,
    "--environment-intent", "host-worktree",
    "--repository-root", repo,
    "--expected-base-head", head,
    "--launch-correlation-id", productOperation.launchCorrelationId,
    "--binding-id", productOperation.registrationBindingId,
    "--pod-id", "native-host-pod",
    "--state-root-relative", ".wakeflow-active/current/native-host-pod",
    "--resume",
    "--session-id", firstBinding.threadId,
    "--replace",
    "--boot-wait-ms", "200",
    "--no-auto-trust",
  ], commonEnv);
  assert.notEqual(failedVerification.status, 0, failedVerification.stdout || failedVerification.stderr);
  assert.match(
    JSON.parse(failedVerification.stderr || failedVerification.stdout).error,
    /main checkout/i,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, first.bindingFile), "utf8")).hostReceipt,
    creationReceipt,
    "failed post-launch verification must preserve immutable creation evidence",
  );

  const resumed = parseOk(runHelper(root, [
    "launch-window",
    "--socket", socket,
    "--server", session,
    "--window", productOperation.windowName,
    "--title", "RepoA Pod",
    "--cwd", actualCwd,
    "--environment-intent", "host-worktree",
    "--repository-root", repo,
    "--expected-base-head", head,
    "--launch-correlation-id", productOperation.launchCorrelationId,
    "--binding-id", productOperation.registrationBindingId,
    "--pod-id", "native-host-pod",
    "--state-root-relative", ".wakeflow-active/current/native-host-pod",
    "--resume",
    "--session-id", firstBinding.threadId,
    "--replace",
    "--boot-wait-ms", "200",
    "--no-auto-trust",
  ], commonEnv));
  assert.equal(resumed.hostReceipt.actualCwd, actualCwd);
  assert.equal(resumed.hostReceipt.mainCheckout, false);
  assert.equal(resumed.hostReceipt.verificationMode, "resume");
  assert.equal(resumed.hostReceipt.head, podHead, "resume observes the current Pod HEAD instead of requiring the creation HEAD");
  assert.equal(resumed.hostReceipt.expectedBaseHead, head, "the creation baseline remains audit context");
  assert.equal(resumed.sessionId, undefined);

  const resumedBinding = JSON.parse(readFileSync(path.join(root, resumed.bindingFile), "utf8"));
  assert.equal(resumedBinding.threadId, firstBinding.threadId, "resume restores the same final Claude session");
  assert.deepEqual(resumedBinding.hostReceipt, creationReceipt, "the creation receipt remains immutable bind evidence");
  assert.equal(resumedBinding.lastResumeObservation.actualCwd, actualCwd);
  assert.equal(resumedBinding.lastResumeObservation.head, podHead);
  assert.equal(resumedBinding.lastResumeObservation.verificationMode, "resume");

  const invocations = readFileSync(argvLog, "utf8")
    .split("BEGIN\n")
    .slice(1)
    .map((block) => block.split("\nEND")[0].split("\n").filter(Boolean));
  assert.equal(invocations.length, 3);
  assert.ok(invocations[1].includes("--resume"));
  assert.ok(!invocations[1].includes("--worktree"), "resume must not ask Claude to create another worktree");
  assert.ok(invocations[2].includes("--resume"));
  assert.ok(!invocations[2].includes("--worktree"), "recovery retry must still not create another worktree");
  assert.ok(!invocations[1].includes("--tmux"));
  assert.ok(!invocations[1].includes("--add-dir"));
  assert.equal(git(repo, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)?.length, 2);
});
