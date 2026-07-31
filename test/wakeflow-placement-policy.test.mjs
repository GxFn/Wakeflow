#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../core/lib/wakeflow-process.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runtimeTemp = mkdtempSync(path.join(os.tmpdir(), "wakeflow-placement-runtime-"));
const runtimeRoot = path.join(runtimeTemp, "runtime");
cpSync(path.join(repositoryRoot, "core"), runtimeRoot, { recursive: true });
cpSync(
  path.join(repositoryRoot, "plugins/codex-wakeflow/templates"),
  path.join(runtimeRoot, "templates"),
  { recursive: true },
);
const stateScript = path.join(runtimeRoot, "scripts/wakeflow-state.mjs");
const demandScript = path.join(runtimeRoot, "scripts/wakeflow-demand-sequence.mjs");

test.after(() => rmSync(runtimeTemp, { recursive: true, force: true }));

function makeRoot(config = null) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-placement-"));
  if (config) {
    writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  }
  return root;
}

function run(script, args) {
  return runSync(process.execPath, [script, ...args], {
    cwd: runtimeRoot,
    encoding: "utf8",
  });
}

function runAsync(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: runtimeRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function init(root, demandKey, extra = []) {
  return run(stateScript, [
    "init",
    "--root", root,
    "--demand-key", demandKey,
    "--title", demandKey,
    ...extra,
    "--write",
    "--json",
  ]);
}

function makeHealthyMainlineRoot({ products = [] } = {}) {
  const repositories = [
    { windowName: "Design", path: "Design", role: "requirement design" },
    { windowName: "Test", path: "Test", role: "real environment test" },
    ...products.map((windowName) => ({
      windowName,
      path: windowName,
      role: "product implementation",
    })),
  ];
  const root = makeRoot({
    controllerWindow: "Controller",
    designWindow: "Design",
    testWindow: "Test",
    repositories,
  });
  for (const repository of repositories) {
    mkdirSync(path.join(root, repository.path), { recursive: true });
  }
  const windows = ["Controller", "Design", "Test", ...products];
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
  windows.forEach((windowName, index) => {
    const role = windowName === "Controller"
      ? "controller"
      : windowName === "Design"
        ? "design"
        : windowName === "Test"
          ? "test-target"
          : "target";
    const cwd = windowName === "Controller" ? root : path.join(root, windowName);
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
  return root;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

test("normal create-demand fails closed as mainline-unavailable before any write when workspace config is missing", () => {
  const root = makeRoot();
  const result = run(demandScript, [
    "create-demand",
    "--root", root,
    "--demand-key", "NO-CONFIG",
    "--title", "No config",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "blocked");
  assert.equal(payload.errorCode, "mainline-unavailable");
  assert.equal(payload.mainlineHealth.available, false);
  assert.ok(payload.mainlineHealth.issues.some((item) => item.code === "workspace-config-missing"));
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/NO-CONFIG")), false);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/NO-CONFIG.create-intent.json")), false);
});

test("normal create-demand requires healthy Controller, Design, Test, and task product registrations", () => {
  const root = makeHealthyMainlineRoot({ products: ["RepoA"] });
  rmSync(
    path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/RepoA.json"),
  );
  const taskPackages = JSON.stringify([{
    taskPackageId: "PKG-REPO-A",
    summary: "Implement RepoA",
    targetWindow: "RepoA",
    targetTaskId: "TASK-REPO-A",
  }]);
  const result = run(demandScript, [
    "create-demand",
    "--root", root,
    "--demand-key", "MISSING-REPO-WINDOW",
    "--title", "Missing RepoA window",
    "--task-packages", taskPackages,
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.errorCode, "mainline-unavailable");
  assert.deepEqual(payload.mainlineHealth.requiredWindows, [
    "Controller",
    "Design",
    "Test",
    "RepoA",
  ]);
  assert.ok(payload.mainlineHealth.issues.some(
    (item) => item.code === "window-not-registered" && item.windowName === "RepoA",
  ));
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/MISSING-REPO-WINDOW")), false);
});

test("normal create-demand rejects a configured project identity that no longer resolves", () => {
  const root = makeHealthyMainlineRoot({ products: ["RepoA"] });
  rmSync(path.join(root, "RepoA"), { recursive: true });
  const result = run(demandScript, [
    "create-demand",
    "--root", root,
    "--demand-key", "MISSING-PROJECT",
    "--title", "Missing project",
    "--task-packages", JSON.stringify([{
      taskPackageId: "PKG-REPO-A",
      targetWindow: "RepoA",
      targetTaskId: "TASK-REPO-A",
    }]),
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.errorCode, "mainline-unavailable");
  assert.ok(payload.mainlineHealth.issues.some(
    (item) => item.code === "project-root-missing" && item.windowName === "RepoA",
  ));
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/MISSING-PROJECT")), false);
});

test("unresolved mainline create recovery blocks a new mainline demand but never creates a Pod", () => {
  const root = makeHealthyMainlineRoot();
  const currentDir = path.join(root, ".wakeflow-active/current");
  mkdirSync(currentDir, { recursive: true });
  writeFileSync(path.join(currentDir, "prior.create-intent.json"), `${JSON.stringify({
    artifactKind: "wakeflow-create-demand-intent",
    demandKey: "PRIOR",
    status: "partial",
    partialCreated: true,
    intent: { demandKey: "PRIOR" },
  }, null, 2)}\n`);
  const result = run(demandScript, [
    "create-demand",
    "--root", root,
    "--demand-key", "AFTER-RECOVERY",
    "--title", "After recovery",
    "--write",
    "--json",
  ]);
  assert.equal(result.status, 1, result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.errorCode, "mainline-unavailable");
  assert.ok(payload.mainlineHealth.issues.some(
    (item) => item.code === "mainline-create-recovery-required",
  ));
  assert.equal(existsSync(path.join(currentDir, "AFTER-RECOVERY")), false);
  assert.equal(
    readdirSync(currentDir).some((name) => name.startsWith(".wakeflow-init-AFTER-RECOVERY")),
    false,
  );
});

test("healthy registered mainline creates normally while an explicit Pod placement probe bypasses mainline health", () => {
  const mainRoot = makeHealthyMainlineRoot({ products: ["RepoA"] });
  const main = run(demandScript, [
    "create-demand",
    "--root", mainRoot,
    "--demand-key", "HEALTHY-MAIN",
    "--title", "Healthy main",
    "--task-packages", JSON.stringify([{
      taskPackageId: "PKG-REPO-A",
      targetWindow: "RepoA",
      targetTaskId: "TASK-REPO-A",
    }]),
    "--write",
    "--json",
  ]);
  assert.equal(main.status, 0, main.stderr || main.stdout);
  assert.equal(
    readJson(path.join(mainRoot, ".wakeflow-active/current/HEALTHY-MAIN/wakeflow-state.json"))
      .executionPlacement.mode,
    "main",
  );

  const podRoot = makeRoot();
  const pod = init(podRoot, "EXPLICIT-POD", [
    "--placement", "pod",
    "--authorization-ref", "user://placement/explicit-pod",
  ]);
  assert.equal(pod.status, 0, pod.stderr || pod.stdout);
  assert.equal(
    readJson(path.join(podRoot, ".wakeflow-active/current/EXPLICIT-POD/wakeflow-state.json"))
      .executionPlacement.selection,
    "explicit-user-pod",
  );
});

test("ordinary demand defaults to the one mainline lane", () => {
  const root = makeRoot();
  const result = init(root, "MAIN");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = readJson(path.join(root, ".wakeflow-active/current/MAIN/wakeflow-state.json"));
  assert.deepEqual(state.executionPlacement, {
    mode: "main",
    podId: null,
    selection: "mainline-default",
    authorizationRef: null,
  });
  assert.equal(state.podProvisioning, undefined);
});

test("busy mainline makes dry-run and apply wait without creating a second state root", () => {
  const root = makeRoot();
  assert.equal(init(root, "ACTIVE").status, 0);
  const secondRoot = path.join(root, ".wakeflow-active/current/WAITING");
  for (const writeArgs of [[], ["--write"]]) {
    const result = run(stateScript, [
      "init",
      "--root", root,
      "--demand-key", "WAITING",
      "--title", "Waiting",
      ...writeArgs,
      "--json",
    ]);
    assert.equal(result.status, 1, result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "waiting");
    assert.equal(payload.errorCode, "mainline-busy");
    assert.equal(payload.diagnostics.retryable, true);
    assert.equal(existsSync(secondRoot), false);
  }
});

test("concurrent ordinary creators cannot publish two mainline demands", async () => {
  const root = makeRoot();
  const results = await Promise.all(["RACE-A", "RACE-B"].map((demandKey) => runAsync(stateScript, [
    "init",
    "--root", root,
    "--demand-key", demandKey,
    "--title", demandKey,
    "--write",
    "--json",
  ])));
  const winners = results.filter((result) => result.status === 0);
  const waiters = results.filter((result) => result.status === 1);
  assert.equal(winners.length, 1, JSON.stringify(results));
  assert.equal(waiters.length, 1, JSON.stringify(results));
  assert.equal(JSON.parse(waiters[0].stdout).errorCode, "mainline-busy");
});

test("explicit authorized pods ignore legacy numeric limits and carry provisioning authority", () => {
  const root = makeRoot({
    maxActiveDemands: 1,
    hosts: { codex: { maxStreamsPerRepo: 1 } },
  });
  assert.equal(init(root, "MAIN").status, 0);
  for (const demandKey of ["POD-A", "POD-B", "POD-C"]) {
    const result = init(root, demandKey, [
      "--placement", "pod",
      "--authorization-ref", `user://placement/${demandKey}`,
      "--pod-id", demandKey.toLowerCase(),
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = readJson(path.join(root, `.wakeflow-active/current/${demandKey}/wakeflow-state.json`));
    assert.deepEqual(state.executionPlacement, {
      mode: "isolated",
      podId: demandKey.toLowerCase(),
      selection: "explicit-user-pod",
      authorizationRef: `user://placement/${demandKey}`,
    });
    assert.deepEqual(state.podProvisioning, {
      phase: "creating-control",
      podId: demandKey.toLowerCase(),
      authorizationRef: `user://placement/${demandKey}`,
    });
  }
});

test("isolated pods do not occupy the mainline lane", () => {
  const root = makeRoot();
  assert.equal(init(root, "POD", [
    "--placement", "pod",
    "--authorization-ref", "user://placement/pod-only",
  ]).status, 0);
  assert.equal(init(root, "MAIN-AFTER-POD").status, 0);
});

test("controller suffix never grants isolated placement and pod placement requires authority", () => {
  const suffixRoot = makeRoot();
  const suffix = init(suffixRoot, "SUFFIX", ["--controller-window", "Controller__SUFFIX"]);
  assert.equal(suffix.status, 0, suffix.stderr || suffix.stdout);
  const suffixState = readJson(path.join(suffixRoot, ".wakeflow-active/current/SUFFIX/wakeflow-state.json"));
  assert.equal(suffixState.executionPlacement.mode, "main");
  assert.equal(suffixState.executionPlacement.selection, "mainline-default");

  const unauthorizedRoot = makeRoot();
  const unauthorized = init(unauthorizedRoot, "NO-AUTH", ["--placement", "pod"]);
  assert.equal(unauthorized.status, 1);
  assert.match(JSON.parse(unauthorized.stdout).error, /authorization-ref is required/);
  assert.equal(existsSync(path.join(unauthorizedRoot, ".wakeflow-active/current/NO-AUTH")), false);
});

test("create-demand probes placement before writing recovery, package, or state artifacts", () => {
  const root = makeRoot();
  assert.equal(init(root, "ACTIVE").status, 0);
  const taskPackages = JSON.stringify([{
    taskPackageId: "PKG-WAITING",
    summary: "Must not be written.",
    targetWindow: "RepoA",
    targetTaskId: "TASK-WAITING",
  }]);
  for (const writeArgs of [[], ["--write"]]) {
    const result = run(demandScript, [
      "create-demand",
      "--root", root,
      "--demand-key", "WAITING-CREATE",
      "--title", "Waiting create",
      "--task-packages", taskPackages,
      ...writeArgs,
      "--json",
    ]);
    assert.equal(result.status, 1, result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "waiting");
    assert.equal(payload.errorCode, "mainline-busy");
    assert.equal(existsSync(path.join(root, ".wakeflow-active/current/WAITING-CREATE")), false);
    assert.equal(existsSync(path.join(root, ".wakeflow-active/current/WAITING-CREATE.create-intent.json")), false);
  }
});

test("claim-todo preserves a waiting row and unattended Auto Claim cannot request a pod", () => {
  const root = makeRoot();
  assert.equal(init(root, "ACTIVE").status, 0);
  const board = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  mkdirSync(path.dirname(board), { recursive: true });
  writeFileSync(board, [
    "# Global TODO",
    "",
    "## Global TODO",
    "",
    "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Testing Decision | Documents |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| WAITING-TODO | pending-claim | requirement | P1 | Wakeflow | Waiting todo | no | none | Wakeflow | none | yes | focused | |",
    "",
  ].join("\n"));
  const before = readFileSync(board, "utf8");

  const waiting = run(demandScript, [
    "claim-todo",
    "--root", root,
    "--design-key", "WAITING-TODO",
    "--write",
    "--json",
  ]);
  assert.equal(waiting.status, 1, waiting.stdout);
  const waitingPayload = JSON.parse(waiting.stdout);
  assert.equal(waitingPayload.status, "waiting");
  assert.equal(waitingPayload.errorCode, "mainline-busy");
  assert.equal(readFileSync(board, "utf8"), before);
  assert.equal(existsSync(path.join(root, ".wakeflow-active/current/WAITING-TODO")), false);

  const autoWaiting = run(demandScript, [
    "claim-todo",
    "--root", root,
    "--write",
    "--json",
  ]);
  assert.equal(autoWaiting.status, 1);
  assert.equal(JSON.parse(autoWaiting.stdout).errorCode, "mainline-busy");
  assert.equal(readFileSync(board, "utf8"), before);

  const autoPod = run(demandScript, [
    "claim-todo",
    "--root", root,
    "--placement", "pod",
    "--authorization-ref", "user://must-be-explicit",
    "--write",
    "--json",
  ]);
  assert.equal(autoPod.status, 1);
  assert.match(JSON.parse(autoPod.stdout).error, /Auto Claim cannot create an isolated pod/);
  assert.equal(readFileSync(board, "utf8"), before);
});
