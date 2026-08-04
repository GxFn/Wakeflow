import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const script = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/codex-wakeflow/scripts/wakeflow-demand-sequence.mjs",
);
const sourceScript = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../core/scripts/wakeflow-demand-sequence.mjs",
);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const coreRoot = path.join(repoRoot, "core");
const codexBundleRoot = path.join(repoRoot, "plugins", "codex-wakeflow");

const HEADER =
  "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Testing Decision | Documents |";
const DIVIDER = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
const REQUIREMENT_REFS = [
  "original-plan",
  "requirement-design",
  "code-facts",
  "landing-plan",
  "non-goals",
  "user-confirmation",
].map((role) => `[${role}](../../authority.md#${role})`).join(" ");
const BUG_REFS = ["reproduction", "scope", "non-goals"]
  .map((role) => `[${role}](../../authority.md#${role})`).join(" ");
// A delivered, controller-recommended, auto-claimable requirement row.
const DELIVERED_ROW =
  `| feat-2026-06-21 | pending-claim | requirement | P1 | Design | Build the feature | no | none | Wakeflow | none | yes | controller-only: unit tests in target; no Test window | ${REQUIREMENT_REFS} |`;
// Eligible but NOT auto-claimable (Auto Claim = no): claimable only with an explicit key.
const MANUAL_ROW =
  `| manual-2026-06-21 | pending-claim | bug | P2 | Design | Fix the bug | no | none | Wakeflow | none | no | controller-only: smoke | ${BUG_REFS} |`;

function makeWorkspace(rows = "") {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-create-"));
  const repositories = ["Design", "Test", "WinA", "WinB"].map((windowName) => ({
    windowName,
    path: windowName,
    role: windowName === "Design"
      ? "requirement design"
      : windowName === "Test"
        ? "real environment test"
        : "product implementation",
  }));
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({
    controllerWindow: "Wakeflow",
    designWindow: "Design",
    testWindow: "Test",
    repositories,
  }, null, 2)}\n`);
  for (const repository of repositories) {
    mkdirSync(path.join(root, repository.path), { recursive: true });
  }
  writeFileSync(path.join(root, "authority.md"), [
    "# Demand authority",
    "",
    "## Original plan",
    "## Requirement design",
    "## Code facts",
    "## Landing plan",
    "## Non goals",
    "## User confirmation",
    "## Reproduction",
    "## Scope",
    "## Requirement delta",
    "## Research question",
    "## Boundaries",
    "## Test environment",
    "",
  ].join("\n"));
  const registryDir = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry",
  );
  const windowConfigDir = path.join(
    root,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/window-config",
  );
  mkdirSync(registryDir, { recursive: true });
  mkdirSync(windowConfigDir, { recursive: true });
  ["Wakeflow", ...repositories.map((item) => item.windowName)]
    .forEach((windowName, index) => {
      const role = windowName === "Wakeflow"
        ? "controller"
        : windowName === "Design"
          ? "design"
          : windowName === "Test"
            ? "test-target"
            : "target";
      const cwd = windowName === "Wakeflow" ? root : path.join(root, windowName);
      const now = new Date().toISOString();
      writeFileSync(path.join(registryDir, `${windowName}.json`), `${JSON.stringify({
        kind: "CodexWindowThreadRegistration",
        version: 3,
        windowName,
        bindingId: `binding-${windowName}`,
        threadId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        registeredAt: now,
        lastVerifiedAt: now,
      }, null, 2)}\n`);
      writeFileSync(path.join(windowConfigDir, `${windowName}.json`), `${JSON.stringify({
        kind: "CodexSubwindowDispatchConfig",
        version: 1,
        windowName,
        threadRegistered: true,
        dispatchable: role !== "design",
        cwd,
        responsibilityRoot: cwd,
        deliveryRole: role,
        generatedAt: now,
      }, null, 2)}\n`);
    });
  const boardPath = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  mkdirSync(path.dirname(boardPath), { recursive: true });
  writeFileSync(boardPath, `${`# Global TODO\n\n## Global TODO\n\n${HEADER}\n${DIVIDER}\n${rows}`.trimEnd()}\n`);
  return { root, boardPath };
}

function withFixtureDemandType(args) {
  if (
    args[0] === "create-demand"
    && args.includes("--demand-key")
    && !args.includes("--todo-id")
    && !args.includes("--demand-type")
    && !args.includes("--demand-authority")
  ) {
    return [args[0], "--demand-type", "bug", ...args.slice(1)];
  }
  return args;
}

function run(root, args) {
  return runSync(process.execPath, [script, ...withFixtureDemandType(args), "--root", root, "--json"], { cwd: root, encoding: "utf8" });
}
function runSource(root, args) {
  return runSync(process.execPath, [sourceScript, ...withFixtureDemandType(args), "--root", root, "--json"], { cwd: root, encoding: "utf8" });
}
function makeFaultRuntime() {
  const container = mkdtempSync(path.join(os.tmpdir(), "wakeflow-create-runtime-"));
  const runtime = path.join(container, "runtime");
  cpSync(codexBundleRoot, runtime, { recursive: true });
  const hostProfile = readFileSync(path.join(runtime, "scripts/lib/wakeflow-host-profile.mjs"));
  cpSync(coreRoot, runtime, { recursive: true, force: true });
  writeFileSync(path.join(runtime, "scripts/lib/wakeflow-host-profile.mjs"), hostProfile);
  const stateScript = path.join(runtime, "scripts/wakeflow-state.mjs");
  const realStateScript = path.join(runtime, "scripts/wakeflow-state-real.mjs");
  renameSync(stateScript, realStateScript);
  writeFileSync(stateScript, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const counterFile = process.env.WAKEFLOW_TEST_CREATE_COUNTER || "";
if (args[0] === "add-task-package" && counterFile) {
  const count = existsSync(counterFile) ? Number(readFileSync(counterFile, "utf8")) + 1 : 1;
  writeFileSync(counterFile, String(count));
  if (count === Number(process.env.WAKEFLOW_TEST_FAIL_ADD_NUMBER || 0)) {
    if (process.env.WAKEFLOW_TEST_EXTERNAL_PROGRESS === "1") {
      const valueAfter = (name) => args[args.indexOf(name) + 1];
      const root = valueAfter("--root");
      const stateRoot = valueAfter("--state-root");
      const stateFile = path.resolve(root, stateRoot, "wakeflow-state.json");
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      if (state.targetTasks?.[0]) {
        if (state.taskPackages?.[0]) state.taskPackages[0].status = "sent";
        state.targetTasks[0].status = "sent";
        state.targetTasks[0].delivery = { deliveryRunId: "external-progress" };
      }
      writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\\n");
    }
    console.error("injected second package failure");
    process.exit(42);
  }
}
await import("./wakeflow-state-real.mjs");
if (args[0] === "init" && args.includes("--write") && process.env.WAKEFLOW_TEST_FAIL_AFTER_INIT_PUBLISH === "1") {
  console.error("injected failure after init published its state root");
  process.exit(43);
}
`);
  const demandScript = path.join(runtime, "scripts/wakeflow-demand-sequence.mjs");
  const demandSource = readFileSync(demandScript, "utf8")
    .replace(
      "writeJsonAtomic(sidecarFile, manifest);",
      `writeJsonAtomic(sidecarFile, manifest);
    if (Number(process.env.WAKEFLOW_TEST_CREATE_HOLD_MS || 0) > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.WAKEFLOW_TEST_CREATE_HOLD_MS));
    }`,
    )
    .replace(
      "activeCreateRecovery.createdRoot = true;",
      `activeCreateRecovery.createdRoot = true;
      if (process.env.WAKEFLOW_TEST_CRASH_AFTER_INIT === "1") process.exit(86);`,
    )
    .replace(
      "consumedTodoId = todoId;",
      `consumedTodoId = todoId;
      if (process.env.WAKEFLOW_TEST_CRASH_AFTER_TODO === "1") process.exit(87);`,
    )
    .replace(
      "writeJsonAtomic(manifestFile, completedManifest);",
      `writeJsonAtomic(manifestFile, completedManifest);
    if (process.env.WAKEFLOW_TEST_CRASH_AFTER_COMPLETE_MANIFEST === "1") process.exit(88);`,
    );
  writeFileSync(demandScript, demandSource);
  return runtime;
}
function runFaultRuntime(runtime, root, args, env = {}) {
  return spawnSync(process.execPath, [
    path.join(runtime, "scripts/wakeflow-demand-sequence.mjs"),
    ...withFixtureDemandType(args),
    "--root", root,
    "--json",
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}
function runFaultRuntimeAsync(runtime, root, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(runtime, "scripts/wakeflow-demand-sequence.mjs"),
      ...withFixtureDemandType(args),
      "--root", root,
      "--json",
    ], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
const parse = (result) => JSON.parse(result.stdout);
const statePath = (root, key) => path.join(root, `.wakeflow-active/current/${key}/wakeflow-state.json`);

test("create-demand from a delivered TODO row: inits, adopts host, renders, consumes the row", () => {
  const { root, boardPath } = makeWorkspace(DELIVERED_ROW);
  const payload = parse(run(root, ["create-demand", "--todo-id", "feat-2026-06-21", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, true);
  assert.equal(payload.created.demandKey, "feat-2026-06-21");
  assert.equal(payload.created.consumedTodoId, "feat-2026-06-21");

  // The state root exists with the demand identity and an adopted controller host.
  const file = statePath(root, "feat-2026-06-21");
  assert.equal(existsSync(file), true);
  const state = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(state.demandKey, "feat-2026-06-21");
  assert.ok(state.controllerHost, "controllerHost is adopted by create-demand");
  assert.equal(state.testDecision, "controller-only: unit tests in target; no Test window", "Design testing decision survives TODO claim");
  const demand = JSON.parse(readFileSync(path.join(root, ".wakeflow-active/current/feat-2026-06-21/demand.json"), "utf8"));
  assert.equal(demand.source.documents.length, 6, "the complete proportional authority refs survive TODO claim");
  assert.ok(demand.source.documents.includes("authority.md#original-plan"));
  const workspaceStatus = readFileSync(path.join(root, ".wakeflow-active/current/workspace-current-status.md"), "utf8");
  assert.match(workspaceStatus, /Status: active/);
  assert.match(workspaceStatus, /feat-2026-06-21/, "entry projection links the newly active demand");

  // The TODO row is consumed: claimed and linked to the state root.
  const board = readFileSync(boardPath, "utf8");
  assert.match(board, /feat-2026-06-21 \| completed \/ claimed \|/);
  assert.match(board, /\.wakeflow-active\/current\/feat-2026-06-21 \| yes \|/);
});

test("create-demand with initial task packages adds them and plans the demand", () => {
  const { root } = makeWorkspace(DELIVERED_ROW);
  const taskPackages = JSON.stringify([
    {
      taskPackageId: "TP-1",
      summary: "First package",
      targetWindow: "Design",
      targetTaskId: "T-1",
      acceptanceAnchors: [{
        id: "AC-1",
        claim: "The confirmed behavior is implemented.",
        probe: "Run the public-entry behavior check.",
        expected: "The observed output matches the requirement.",
      }],
    },
  ]);
  const payload = parse(run(root, ["create-demand", "--todo-id", "feat-2026-06-21", "--task-packages", taskPackages, "--write"]));
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.created.taskPackages, ["TP-1"]);
  const state = JSON.parse(readFileSync(statePath(root, "feat-2026-06-21"), "utf8"));
  // add-task-package moves the demand out of intake into planned.
  assert.equal(state.state, "planned");
  assert.equal(state.taskPackages[0].acceptanceAnchors[0].id, "AC-1");
});

test("create-demand inline (demandKey + title) inits without a TODO row", () => {
  const { root } = makeWorkspace();
  const payload = parse(run(root, [
    "create-demand", "--demand-key", "inline-2026-06-21", "--title", "Inline demand",
    "--goal", "Do the thing", "--completion-definition", "Thing is done", "--write",
  ]));
  assert.equal(payload.ok, true);
  assert.equal(payload.created.consumedTodoId, null);
  assert.equal(existsSync(statePath(root, "inline-2026-06-21")), true);
});

test("a controller inline draft records a legacy display testDecision and reminds when absent", () => {
  // recorded -> persists on the demand state, no reminder
  const yes = makeWorkspace();
  const withDecision = parse(run(yes.root, [
    "create-demand", "--demand-key", "td-yes-2026-07-09", "--title", "TD Yes",
    "--test-decision", "unit tests in AppWindow; no real Test needed", "--write",
  ]));
  assert.equal(withDecision.ok, true);
  assert.equal(withDecision.testDecisionReminder, undefined, "no reminder when the testing decision is recorded");
  const stateYes = JSON.parse(readFileSync(statePath(yes.root, "td-yes-2026-07-09"), "utf8"));
  assert.equal(stateYes.testDecision, "unit tests in AppWindow; no real Test needed", "testDecision persists on the demand state");

  // A draft may stay incomplete. The first implementation package, not draft
  // creation, is the authority freeze gate.
  const no = makeWorkspace();
  const result = run(no.root, ["create-demand", "--demand-key", "td-no-2026-07-09", "--title", "TD No", "--write"]);
  assert.equal(result.status, 0, "controller draft creation succeeds before authority is complete");
  const withoutDecision = parse(result);
  assert.match(withoutDecision.testDecisionReminder, /testing decision/i, "a reminder surfaces when the testing decision is absent");
  const stateNo = JSON.parse(readFileSync(statePath(no.root, "td-no-2026-07-09"), "utf8"));
  assert.equal("testDecision" in stateNo, false, "absent testDecision leaves no field (zero trace)");
});

test("W-craft-2: create-demand reminds when no initial package carries an evidence contract", () => {
  const bare = makeWorkspace();
  const packages = JSON.stringify([{ taskPackageId: "p1", summary: "impl", targetWindow: "WinA", targetTaskId: "p1-t1" }]);
  const payload = parse(run(bare.root, [
    "create-demand", "--demand-key", "ecr-2026-07-10", "--title", "ECR",
    "--task-packages", packages, "--write",
  ]));
  assert.equal(payload.ok, true, "reminder never blocks");
  assert.match(payload.evidenceContractReminder, /dormant/i, "no contract on any package -> aggregate reminder");

  const withC = makeWorkspace();
  const contracted = JSON.stringify([{ taskPackageId: "p1", summary: "impl", targetWindow: "WinA", targetTaskId: "p1-t1", evidenceContract: { required: [{ kind: "tests" }] } }]);
  const ok = parse(run(withC.root, [
    "create-demand", "--demand-key", "ecr2-2026-07-10", "--title", "ECR2",
    "--task-packages", contracted, "--write",
  ]));
  assert.equal("evidenceContractReminder" in ok, false, "contract present -> zero trace");
});

test("create-demand dry-run does not create a state root", () => {
  const { root } = makeWorkspace(DELIVERED_ROW);
  const payload = parse(run(root, ["create-demand", "--todo-id", "feat-2026-06-21"]));
  assert.equal(payload.wrote, false);
  assert.equal(existsSync(statePath(root, "feat-2026-06-21")), false);
});

test("a delivered TODO id is the canonical demand identity", () => {
  const { root } = makeWorkspace(DELIVERED_ROW);
  const result = runSource(root, [
    "create-demand",
    "--todo-id", "feat-2026-06-21",
    "--demand-key", "different-alias-2026-06-21",
    "--write",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error, /must equal --todo-id|canonical demand identity/);
  assert.equal(existsSync(statePath(root, "feat-2026-06-21")), false);
  assert.equal(existsSync(statePath(root, "different-alias-2026-06-21")), false);
});

test("create-demand preflights the complete package list before creating a state root", () => {
  const cases = [
    {
      name: "non-array package list",
      value: { taskPackageId: "TP-1" },
      pattern: /must be a JSON array/,
    },
    {
      name: "duplicate package id",
      value: [{ taskPackageId: "TP-1" }, { taskPackageId: "TP-1" }],
      pattern: /package ids must be unique/,
    },
    {
      name: "case-folded package file collision",
      value: [{ taskPackageId: "PKG" }, { taskPackageId: "pkg" }],
      pattern: /package ids must be unique/,
    },
    {
      name: "malformed acceptance anchors",
      value: [{ taskPackageId: "TP-1" }, { taskPackageId: "TP-2", acceptanceAnchors: [{ id: "AC-1" }] }],
      pattern: /acceptanceAnchors/,
    },
    {
      name: "malformed evidence contract",
      value: [{ taskPackageId: "TP-1" }, { taskPackageId: "TP-2", evidenceContract: { required: "tests" } }],
      pattern: /evidenceContract\.required/,
    },
    {
      name: "initial Test package",
      value: [{ taskPackageId: "TP-1", targetWindow: "Test", targetTaskId: "T-1" }],
      pattern: /initial Test work/,
    },
    {
      name: "initial test work type",
      value: [{ taskPackageId: "TP-1", workType: "test" }],
      pattern: /create the demand.*Test card/i,
    },
    {
      name: "forward dependency",
      value: [{
        taskPackageId: "TP-1", targetWindow: "Design", targetTaskId: "T-1",
        workType: "research", objective: "Research", contextSummary: ["Known fact"],
        requirementRefs: [{ ref: ".wakeflow-active/current/global-todo-board.md#global-todo", role: "goal" }],
        boundaries: { inScope: ["scope"], outOfScope: [], forbidden: [] },
        completionExpectations: ["report"], dependsOnTaskIds: ["T-2"], commitExpectation: "leave-uncommitted",
      }, { taskPackageId: "TP-2", targetWindow: "Design", targetTaskId: "T-2" }],
      pattern: /not an earlier target task/,
    },
    {
      name: "missing requirement anchor",
      value: [{
        taskPackageId: "TP-1", targetWindow: "Design", targetTaskId: "T-1",
        workType: "research", objective: "Research", contextSummary: ["Known fact"],
        requirementRefs: [{ ref: "missing.md#goal", role: "goal" }],
        boundaries: { inScope: ["scope"], outOfScope: [], forbidden: [] },
        completionExpectations: ["report"], dependsOnTaskIds: [], commitExpectation: "leave-uncommitted",
      }],
      pattern: /requirement reference does not exist/,
    },
  ];
  for (const entry of cases) {
    const { root } = makeWorkspace();
    const key = `preflight-${cases.indexOf(entry)}-2026-07-30`;
    const result = runSource(root, [
      "create-demand", "--demand-key", key, "--title", entry.name,
      "--task-packages", JSON.stringify(entry.value), "--write",
    ]);
    assert.notEqual(result.status, 0, entry.name);
    assert.match(parse(result).error, entry.pattern, entry.name);
    assert.equal(existsSync(statePath(root, key)), false, `${entry.name} must fail before init`);
  }
});

test("create-demand compensates a package failure when no external progress exists", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-rollback-2026-07-30";
  const counter = path.join(root, "create-counter.txt");
  const packages = JSON.stringify([
    { taskPackageId: "P1", summary: "first", targetWindow: "WinA", targetTaskId: "T1" },
    { taskPackageId: "P2", summary: "second", targetWindow: "WinB", targetTaskId: "T2" },
  ]);
  const failed = runFaultRuntime(runtime, root, [
    "create-demand", "--demand-key", key, "--title", "Rollback",
    "--task-packages", packages, "--write",
  ], {
    WAKEFLOW_TEST_CREATE_COUNTER: counter,
    WAKEFLOW_TEST_FAIL_ADD_NUMBER: "2",
  });
  assert.notEqual(failed.status, 0);
  const payload = parse(failed);
  assert.equal(payload.partialCreated, undefined, "a private failed attempt is compensated, not exposed as a partial demand");
  assert.match(payload.error, /removed the state root created by this failed attempt/);
  assert.equal(existsSync(statePath(root, key)), false);
});

test("create-demand preserves external progress and resumes only the same intent", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-resume-2026-07-30";
  const counter = path.join(root, "create-counter.txt");
  const taskPackages = [
    { taskPackageId: "P1", summary: "first", targetWindow: "WinA", targetTaskId: "T1" },
    { taskPackageId: "P2", summary: "second", targetWindow: "WinB", targetTaskId: "T2" },
  ];
  const common = [
    "create-demand", "--demand-key", key, "--title", "Resume",
    "--task-packages", JSON.stringify(taskPackages), "--write",
  ];
  const failed = runFaultRuntime(runtime, root, common, {
    WAKEFLOW_TEST_CREATE_COUNTER: counter,
    WAKEFLOW_TEST_FAIL_ADD_NUMBER: "2",
    WAKEFLOW_TEST_EXTERNAL_PROGRESS: "1",
  });
  assert.notEqual(failed.status, 0);
  const partial = parse(failed);
  assert.equal(partial.partialCreated, true);
  assert.match(partial.recovery, /same input/);
  assert.equal(existsSync(statePath(root, key)), true);
  const manifestFile = path.join(root, ".wakeflow-active/current", key, ".wakeflow-create-demand.json");
  assert.equal(JSON.parse(readFileSync(manifestFile, "utf8")).status, "partial");

  const changedIntent = runFaultRuntime(runtime, root, [
    "create-demand", "--demand-key", key, "--title", "Different title",
    "--task-packages", JSON.stringify(taskPackages), "--write",
  ]);
  assert.notEqual(changedIntent.status, 0);
  assert.match(parse(changedIntent).error, /intent differs/);

  const resumed = runFaultRuntime(runtime, root, common);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const resumedPayload = parse(resumed);
  assert.equal(resumedPayload.resumedPartial, true);
  assert.deepEqual(resumedPayload.created.taskPackages, ["P1", "P2"]);
  const state = JSON.parse(readFileSync(statePath(root, key), "utf8"));
  assert.deepEqual(state.taskPackages.map((pkg) => pkg.taskPackageId), ["P1", "P2"]);
  assert.equal(JSON.parse(readFileSync(manifestFile, "utf8")).status, "complete");
});

test("create-demand serializes concurrent same-intent creators", async () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-concurrent-2026-07-30";
  const args = ["create-demand", "--demand-key", key, "--title", "Concurrent", "--write"];
  const firstPromise = runFaultRuntimeAsync(runtime, root, args, {
    WAKEFLOW_TEST_CREATE_HOLD_MS: "500",
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  const second = runFaultRuntime(runtime, root, args);
  const first = await firstPromise;
  const successes = [first, second].filter((result) => result.status === 0);
  const failures = [first, second].filter((result) => result.status !== 0);
  assert.equal(successes.length, 1, `exactly one creator must succeed: ${first.stderr}${second.stderr}`);
  assert.equal(failures.length, 1);
  assert.match(parse(failures[0]).error, /already exists|refuse to re-create/);
  const state = JSON.parse(readFileSync(statePath(root, key), "utf8"));
  assert.equal(state.demandKey, key);
  assert.equal(
    existsSync(path.join(root, ".wakeflow-active/current", `${key}.create-intent.json`)),
    false,
    "the successful creator removes its pre-intent sidecar",
  );
});

test("create-demand resumes a crash after init from the sibling pre-intent", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-init-crash-2026-07-30";
  const taskPackages = JSON.stringify([
    { taskPackageId: "P1", summary: "first", targetWindow: "WinA", targetTaskId: "T1" },
  ]);
  const args = [
    "create-demand", "--demand-key", key, "--title", "Init crash",
    "--task-packages", taskPackages, "--write",
  ];
  const crashed = runFaultRuntime(runtime, root, args, {
    WAKEFLOW_TEST_CRASH_AFTER_INIT: "1",
  });
  assert.equal(crashed.status, 86);
  const stateRoot = path.join(root, ".wakeflow-active/current", key);
  assert.equal(existsSync(path.join(stateRoot, "wakeflow-state.json")), true);
  assert.equal(existsSync(path.join(stateRoot, ".wakeflow-create-demand.json")), false);
  assert.equal(existsSync(`${stateRoot}.create-intent.json`), true);

  const resumed = runFaultRuntime(runtime, root, args);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.equal(parse(resumed).resumedPartial, true);
  const state = JSON.parse(readFileSync(path.join(stateRoot, "wakeflow-state.json"), "utf8"));
  assert.deepEqual(state.taskPackages.map((pkg) => pkg.taskPackageId), ["P1"]);
  assert.equal(JSON.parse(readFileSync(path.join(stateRoot, ".wakeflow-create-demand.json"), "utf8")).status, "complete");
  assert.equal(existsSync(`${stateRoot}.create-intent.json`), false);
});

test("create-demand compensates when init publishes the root but its process returns failure", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-init-return-failure-2026-07-30";
  const failed = runFaultRuntime(runtime, root, [
    "create-demand", "--demand-key", key, "--title", "Init return failure", "--write",
  ], {
    WAKEFLOW_TEST_FAIL_AFTER_INIT_PUBLISH: "1",
  });
  assert.notEqual(failed.status, 0);
  const payload = parse(failed);
  assert.match(payload.error, /removed the state root created by this failed attempt/);
  const stateRoot = path.join(root, ".wakeflow-active/current", key);
  assert.equal(existsSync(stateRoot), false);
  assert.equal(existsSync(`${stateRoot}.create-intent.json`), false);
});

test("create-demand resumes after TODO consume but before complete manifest", () => {
  const runtime = makeFaultRuntime();
  const { root, boardPath } = makeWorkspace(DELIVERED_ROW);
  const args = ["create-demand", "--todo-id", "feat-2026-06-21", "--write"];
  const crashed = runFaultRuntime(runtime, root, args, {
    WAKEFLOW_TEST_CRASH_AFTER_TODO: "1",
  });
  assert.equal(crashed.status, 87);
  assert.match(readFileSync(boardPath, "utf8"), /feat-2026-06-21 \| completed \/ claimed \|/);
  const stateRoot = path.join(root, ".wakeflow-active/current", "feat-2026-06-21");
  assert.equal(JSON.parse(readFileSync(path.join(stateRoot, ".wakeflow-create-demand.json"), "utf8")).status, "partial");

  const resumed = runFaultRuntime(runtime, root, args);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.equal(parse(resumed).resumedPartial, true);
  assert.equal(JSON.parse(readFileSync(path.join(stateRoot, ".wakeflow-create-demand.json"), "utf8")).status, "complete");
});

test("create-demand finishes cleanup after the complete manifest was committed", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-complete-cleanup-2026-07-30";
  const args = [
    "create-demand", "--demand-key", key, "--title", "Complete cleanup",
    "--write",
  ];
  const crashed = runFaultRuntime(runtime, root, args, {
    WAKEFLOW_TEST_CRASH_AFTER_COMPLETE_MANIFEST: "1",
  });
  assert.equal(crashed.status, 88);
  const stateRoot = path.join(root, ".wakeflow-active/current", key);
  const manifest = JSON.parse(readFileSync(path.join(stateRoot, ".wakeflow-create-demand.json"), "utf8"));
  assert.equal(manifest.status, "complete");
  const sidecar = `${stateRoot}.create-intent.json`;
  assert.equal(existsSync(sidecar), true);

  const resumed = runFaultRuntime(runtime, root, args);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const payload = JSON.parse(resumed.stdout);
  assert.equal(payload.recoveredCompleted, true);
  assert.equal(existsSync(sidecar), false);
  assert.equal(JSON.parse(readFileSync(path.join(stateRoot, ".wakeflow-create-demand.json"), "utf8")).status, "complete");
});

test("create-demand complete recovery requires the full intended package and target set", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-complete-set-2026-07-30";
  const packages = JSON.stringify([
    { taskPackageId: "P1", summary: "first", targetWindow: "WinA", targetTaskId: "T1" },
    { taskPackageId: "P2", summary: "second", targetWindow: "WinB", targetTaskId: "T2" },
  ]);
  const args = [
    "create-demand", "--demand-key", key, "--title", "Complete set",
    "--task-packages", packages, "--write",
  ];
  const crashed = runFaultRuntime(runtime, root, args, {
    WAKEFLOW_TEST_CRASH_AFTER_COMPLETE_MANIFEST: "1",
  });
  assert.equal(crashed.status, 88);
  const stateRoot = path.join(root, ".wakeflow-active/current", key);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.taskPackages = state.taskPackages.filter((pkg) => pkg.taskPackageId !== "P2");
  state.targetTasks = state.targetTasks.filter((target) => target.targetTaskId !== "T2");
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const recovered = runFaultRuntime(runtime, root, args);
  assert.notEqual(recovered.status, 0);
  assert.match(parse(recovered).error, /full package\/target set|does not contain/);
  assert.equal(
    existsSync(`${stateRoot}.create-intent.json`),
    true,
    "failed validation must preserve the recovery sidecar for manual reconciliation",
  );
});

test("create-demand partial recovery rejects target identity drift", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-target-drift-2026-07-30";
  const counter = path.join(root, "create-counter.txt");
  const packages = [
    { taskPackageId: "P1", summary: "first", targetWindow: "WinA", targetTaskId: "T1" },
    { taskPackageId: "P2", summary: "second", targetWindow: "WinB", targetTaskId: "T2" },
  ];
  const args = [
    "create-demand", "--demand-key", key, "--title", "Target drift",
    "--task-packages", JSON.stringify(packages), "--write",
  ];
  const failed = runFaultRuntime(runtime, root, args, {
    WAKEFLOW_TEST_CREATE_COUNTER: counter,
    WAKEFLOW_TEST_FAIL_ADD_NUMBER: "2",
    WAKEFLOW_TEST_EXTERNAL_PROGRESS: "1",
  });
  assert.notEqual(failed.status, 0);
  const stateRoot = path.join(root, ".wakeflow-active/current", key);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.targetTasks[0].summary = "drifted target summary";
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const resumed = runFaultRuntime(runtime, root, args);
  assert.notEqual(resumed.status, 0);
  assert.match(parse(resumed).error, /target task T1 .*drifted|drifted from/i);
});

test("create-demand partial recovery rejects immutable package artifact drift", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-package-identity-drift-2026-07-30";
  const counter = path.join(root, "create-counter.txt");
  const packages = [
    { taskPackageId: "P1", summary: "first", targetWindow: "WinA", targetTaskId: "T1" },
    { taskPackageId: "P2", summary: "second", targetWindow: "WinB", targetTaskId: "T2" },
  ];
  const args = [
    "create-demand", "--demand-key", key, "--title", "Package identity drift",
    "--task-packages", JSON.stringify(packages), "--write",
  ];
  const failed = runFaultRuntime(runtime, root, args, {
    WAKEFLOW_TEST_CREATE_COUNTER: counter,
    WAKEFLOW_TEST_FAIL_ADD_NUMBER: "2",
    WAKEFLOW_TEST_EXTERNAL_PROGRESS: "1",
  });
  assert.notEqual(failed.status, 0);
  const packageFile = path.join(
    root,
    ".wakeflow-active/current",
    key,
    "task-packages",
    "P1.json",
  );
  const packageArtifact = JSON.parse(readFileSync(packageFile, "utf8"));
  packageArtifact.status = "accepted";
  writeFileSync(packageFile, `${JSON.stringify(packageArtifact, null, 2)}\n`);

  const resumed = runFaultRuntime(runtime, root, args);
  assert.notEqual(resumed.status, 0);
  assert.match(parse(resumed).error, /package artifact .*drifted|drifted from/i);

  packageArtifact.status = "pending";
  packageArtifact.targetTasks[0].dependsOnTaskIds = ["ghost-task"];
  writeFileSync(packageFile, `${JSON.stringify(packageArtifact, null, 2)}\n`);
  const dependencyDrift = runFaultRuntime(runtime, root, args);
  assert.notEqual(dependencyDrift.status, 0);
  assert.match(parse(dependencyDrift).error, /package artifact .*drifted|drifted from/i);
});

test("create-demand rejects drifted recovery intent and existing package content", () => {
  const runtime = makeFaultRuntime();
  const { root } = makeWorkspace();
  const key = "create-drift-2026-07-30";
  const counter = path.join(root, "create-counter.txt");
  const packages = [
    { taskPackageId: "P1", summary: "first", targetWindow: "WinA", targetTaskId: "T1" },
    { taskPackageId: "P2", summary: "second", targetWindow: "WinB", targetTaskId: "T2" },
  ];
  const args = [
    "create-demand", "--demand-key", key, "--title", "Drift",
    "--task-packages", JSON.stringify(packages), "--write",
  ];
  const failed = runFaultRuntime(runtime, root, args, {
    WAKEFLOW_TEST_CREATE_COUNTER: counter,
    WAKEFLOW_TEST_FAIL_ADD_NUMBER: "2",
    WAKEFLOW_TEST_EXTERNAL_PROGRESS: "1",
  });
  assert.notEqual(failed.status, 0);
  const stateRoot = path.join(root, ".wakeflow-active/current", key);
  const packageFile = path.join(stateRoot, "task-packages", "P1.json");
  const packageArtifact = JSON.parse(readFileSync(packageFile, "utf8"));
  packageArtifact.summary = "drifted";
  writeFileSync(packageFile, `${JSON.stringify(packageArtifact, null, 2)}\n`);

  const driftedPackage = runFaultRuntime(runtime, root, args);
  assert.notEqual(driftedPackage.status, 0);
  assert.match(parse(driftedPackage).error, /artifact .*drifted|drifted from/i);

  const manifestFile = path.join(stateRoot, ".wakeflow-create-demand.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  manifest.intent.title = "tampered without digest";
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const driftedManifest = runFaultRuntime(runtime, root, args);
  assert.notEqual(driftedManifest.status, 0);
  assert.match(parse(driftedManifest).error, /digest does not match/);
});

test("create-demand refuses an ineligible / unknown TODO row", () => {
  const { root } = makeWorkspace();
  const result = run(root, ["create-demand", "--todo-id", "missing-2026-06-21", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error ?? "", /not an eligible candidate/);
});

test("create-demand refuses to re-create an existing demand state root", () => {
  const { root } = makeWorkspace(DELIVERED_ROW);
  assert.equal(run(root, ["create-demand", "--todo-id", "feat-2026-06-21", "--write"]).status, 0);
  // The row is consumed now; an inline retry on the same key hits the state-root guard.
  const second = run(root, ["create-demand", "--demand-key", "feat-2026-06-21", "--title", "Dup", "--write"]);
  assert.notEqual(second.status, 0);
  assert.match(parse(second).error ?? "", /already exists|intent differs/);
});

test("claim-todo auto-claims the single controller-claimable row and consumes it", () => {
  const { root, boardPath } = makeWorkspace(DELIVERED_ROW);
  const payload = parse(run(root, ["claim-todo", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.claimed.id, "feat-2026-06-21");
  assert.equal(payload.claimMode, "auto-claimable-todo");
  assert.equal(existsSync(statePath(root, "feat-2026-06-21")), true);
  assert.match(readFileSync(boardPath, "utf8"), /feat-2026-06-21 \| completed \/ claimed \|/);
});

test("claim-todo with no auto-claimable row reports nothing to claim", () => {
  const { root } = makeWorkspace(MANUAL_ROW);
  const payload = parse(run(root, ["claim-todo", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, false);
  assert.equal(payload.claimed, null);
  assert.equal(existsSync(statePath(root, "manual-2026-06-21")), false);
});

test("claim-todo claims an explicit eligible row even when not auto-claimable", () => {
  const { root } = makeWorkspace(MANUAL_ROW);
  const payload = parse(run(root, ["claim-todo", "--design-key", "manual-2026-06-21", "--write"]));
  assert.equal(payload.ok, true);
  assert.equal(payload.claimMode, "explicit-eligible-todo");
  assert.equal(existsSync(statePath(root, "manual-2026-06-21")), true);
});

test("claim-todo refuses when multiple rows are controller-claimable", () => {
  const second =
    `| feat2-2026-06-21 | pending-claim | requirement | P1 | Design | Second | no | none | Wakeflow | none | yes | controller-only: unit | ${REQUIREMENT_REFS} |`;
  const { root } = makeWorkspace(`${DELIVERED_ROW}\n${second}`);
  const result = run(root, ["claim-todo", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(parse(result).error ?? "", /multiple controller-claimable/);
});
