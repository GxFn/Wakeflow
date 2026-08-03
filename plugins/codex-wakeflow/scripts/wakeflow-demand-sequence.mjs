#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/wakeflow-process.mjs";
import {
  loadWorkspaceConfig,
  testWindowNames,
  trackedWorkspaceConfigPath,
  workspaceLedgerPaths,
} from "./lib/wakeflow-config.mjs";
import {
  normalizeTaskPackageContext,
  requirementRefIssue,
} from "./lib/wakeflow-task-package.mjs";
import {
  WakeflowStateLockTimeoutError,
  withFileLock,
  withStateRootLock,
} from "./lib/wakeflow-state-lock.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const wakeflowRoot = path.dirname(scriptsDir);
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "help";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = path.resolve(getValue("--root", wakeflowRoot));
const write = hasFlag("--write");
const json = hasFlag("--json");
let cachedWorkspaceConfig = undefined;
let activeCreateRecovery = null;

const helpText = `
Controller demand claim/create runner

Usage:
  node scripts/wakeflow-demand-sequence.mjs create-demand --todo-id <id> | --demand-key <key> --title <title> [--placement <main|pod> --authorization-ref <user-authority> --pod-id <id>] [--controller-window <window>] [--root <workspace>] [--write] [--json]
  node scripts/wakeflow-demand-sequence.mjs claim-todo [--design-key <id>] [--placement <main|pod> --authorization-ref <user-authority> --pod-id <id>] [--controller-window <window>] [--root <workspace>] [--write] [--json]

Design:
  Claims or creates at most one demand from the global TODO board: create-demand
  inits the state root (adopting this host), adds any initial task packages,
  renders the progress doc, and consumes the originating TODO row; claim-todo
  auto-claims the single controller-claimable row (Auto Claim = yes and
  eligible) or an explicitly named eligible row by delegating to create-demand.
  Ordinary claims use the mainline lane and wait while it is busy. Isolated
  placement requires an explicit Pod request plus a user authorization
  reference; unattended Auto Claim never creates a Pod. It does not dispatch
  windows, send thread messages, accept evidence, or complete demands.
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

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (!complete.agentNext) {
    complete.agentNext = complete.ok
      ? "Use total-control judgment to dispatch from the claimed state root; claim the next TODO row after this demand completes and archives."
      : "Stop and inspect the reported demand sequence issue.";
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  console.log(`Agent next: ${complete.agentNext}`);
}

function fail(message, details = {}) {
  const recovery = activeCreateRecovery;
  const activeRoot = recovery?.stateRoot ? resolveFromWorkspace(recovery.stateRoot) : null;
  let recoveryOutcome = null;
  let recoveryWarning = "";
  if (activeRoot) {
    try {
      recoveryOutcome = recoverFailedCreate(activeRoot, recovery);
    } catch (error) {
      recoveryWarning = `\ncreate-demand recovery could not finish: ${error.message}`;
    }
  }
  const authorityArtifacts = activeRoot
    ? [
        "demand.json",
        "wakeflow-state.json",
        "controller-events.jsonl",
        "projection.json",
        "developer-progress.md",
      ].filter((name) => existsSync(path.join(activeRoot, name)))
    : [];
  const partial = authorityArtifacts.length > 0 && recoveryOutcome?.removed !== true;
  output({
    ok: false,
    command,
    ...(details.status ? { status: details.status } : {}),
    ...(details.errorCode ? { errorCode: details.errorCode } : {}),
    ...(details.retryable !== undefined ? { retryable: details.retryable } : {}),
    ...(details.activeDemands ? { activeDemands: details.activeDemands } : {}),
    ...(details.placement ? { placement: details.placement } : {}),
    ...(details.mainlineHealth ? { mainlineHealth: details.mainlineHealth } : {}),
    error: partial
      ? `${message}\ncreate-demand found or left authority artifacts in the state root; they were preserved because concurrent, prior, or external progress cannot be ruled out.${recoveryWarning}`
      : recoveryOutcome?.removed
        ? `${message}\ncreate-demand removed the state root created by this failed attempt because no external progress was present.`
        : `${message}${recoveryWarning}`,
    ...(details.recovery && !partial ? { recovery: details.recovery } : {}),
    ...(partial
      ? {
          partial: true,
          partialCreated: true,
          stateRoot: recovery.stateRoot,
          partialArtifacts: authorityArtifacts,
          intentDigest: recovery?.intentDigest,
          recovery: recoveryOutcome?.sameIntentRetryAllowed
            ? `Retry create-demand with the same input to add only missing packages under ${recovery.stateRoot}; a different intent is rejected.`
            : `Inspect ${recovery.stateRoot}; reconcile it before retrying the same demand key.`,
        }
      : {}),
  });
  process.exitCode = 1;
  throw new CliExit(message);
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function resolveFromWorkspace(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

function relative(file) {
  const rel = path.relative(workspaceRoot, file).split(path.sep).join("/");
  return rel || ".";
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function stableDigest(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function createIntentManifestFile(stateRootAbs) {
  return path.join(stateRootAbs, ".wakeflow-create-demand.json");
}

function createIntentSidecarFile(stateRootAbs) {
  return `${stateRootAbs}.create-intent.json`;
}

function createDemandLockFile(stateRootAbs) {
  return `${stateRootAbs}.create-lock`;
}

function intendedCreateIds(intent) {
  const packageIds = (intent.taskPackages ?? [])
    .map((pkg) => pkg.taskPackageId ?? pkg.targetTaskId);
  const targetTaskIds = (intent.taskPackages ?? [])
    .filter((pkg) => pkg.targetWindow)
    .map((pkg) => pkg.targetTaskId ?? `${pkg.taskPackageId ?? pkg.targetTaskId}__${slug(pkg.targetWindow)}`);
  return { packageIds, targetTaskIds };
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

function rawReadJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readValidatedCreateManifest(file, { label = "create-demand recovery manifest" } = {}) {
  if (!existsSync(file)) return null;
  const manifest = rawReadJson(file);
  const expectedIds = manifest?.intent && typeof manifest.intent === "object" && !Array.isArray(manifest.intent)
    ? intendedCreateIds(manifest.intent)
    : null;
  if (
    !manifest
    || manifest.artifactKind !== "wakeflow-create-demand-intent"
    || !manifest.intent
    || typeof manifest.intent !== "object"
    || Array.isArray(manifest.intent)
    || typeof manifest.intentDigest !== "string"
    || stableDigest(manifest.intent) !== manifest.intentDigest
    || !["preparing", "partial", "complete"].includes(manifest.status)
    || manifest.demandKey !== manifest.intent.demandKey
    || typeof manifest.stateRoot !== "string"
    || !Array.isArray(manifest.packageIds)
    || !Array.isArray(manifest.targetTaskIds)
    || !sameStableValue(manifest.packageIds, expectedIds?.packageIds ?? [])
    || !sameStableValue(manifest.targetTaskIds, expectedIds?.targetTaskIds ?? [])
    || manifest.partialCreated !== (manifest.status !== "complete")
  ) {
    fail(`${label} is malformed, inconsistent with its intent, or its intent digest does not match: ${relative(file)}. Manual reconciliation is required.`);
  }
  return manifest;
}

function readCreateRecoveryManifest(stateRootAbs) {
  const sidecarFile = createIntentSidecarFile(stateRootAbs);
  const rootManifestFile = createIntentManifestFile(stateRootAbs);
  const sidecar = readValidatedCreateManifest(sidecarFile, { label: "create-demand intent sidecar" });
  const rootManifest = readValidatedCreateManifest(rootManifestFile);
  if (sidecar && rootManifest && sidecar.intentDigest !== rootManifest.intentDigest) {
    fail(`create-demand recovery manifests disagree for ${relative(stateRootAbs)}. Manual reconciliation is required.`);
  }
  return rootManifest ?? sidecar;
}

function jsonFilesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.name.endsWith(".json")) files.push(candidate);
    }
  };
  visit(directory);
  return files;
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) files.push(candidate);
    }
  };
  visit(directory);
  return files;
}

function artifactReferencesDemand(value, recovery) {
  if (!value || typeof value !== "object") return false;
  if (
    value.demandKey === recovery?.manifest?.intent?.demandKey
    || value.stateRoot === recovery?.stateRoot
    || value.stateRef?.stateRoot === recovery?.stateRoot
  ) return true;
  return Object.values(value).some((entry) => artifactReferencesDemand(entry, recovery));
}

function todoWasConsumed(todoId) {
  // Avoid introducing another Markdown-table parser here. next-work owns TODO
  // eligibility; absence from its exact-id result is conservatively treated as
  // external progress, whether the row was consumed, blocked, or removed.
  const scan = runNextWorkTodo(todoId);
  return !(scan.candidates ?? []).some((entry) => entry.id === todoId)
    && scan.recommended?.id !== todoId;
}

function sameStableValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function intendedPackageShape(pkg, title) {
  const taskPackageId = pkg.taskPackageId ?? pkg.targetTaskId;
  const contextKeys = ["workType", "objective", "contextSummary", "requirementRefs", "boundaries", "completionExpectations", "dependsOnTaskIds", "commitExpectation"];
  const taskContext = contextKeys.some((key) => pkg[key] !== undefined)
    ? normalizeTaskPackageContext({ ...pkg, acceptanceAnchors: pkg.acceptanceAnchors, contextVersion: 1 })
    : null;
  return {
    taskPackageId,
    summary: pkg.summary ?? title,
    sourceRef: pkg.sourceRef ?? null,
    ...(taskContext ?? {}),
    ...(pkg.designIntent ? { designIntent: pkg.designIntent } : {}),
    ...(pkg.acceptanceAnchors ? { acceptanceAnchors: pkg.acceptanceAnchors } : {}),
    ...(pkg.evidenceContract ? { evidenceContract: pkg.evidenceContract } : {}),
  };
}

function actualPackageShape(pkg, expected) {
  const fields = Object.keys(expected);
  return Object.fromEntries(fields.map((field) => [field, pkg?.[field] ?? null]));
}

function intendedPackageTargetShape(pkg, packageId, title) {
  if (!pkg.targetWindow) return [];
  return [{
    targetTaskId: pkg.targetTaskId ?? `${packageId}__${slug(pkg.targetWindow)}`,
    taskPackageId: packageId,
    targetWindow: pkg.targetWindow,
    summary: pkg.summary ?? title,
    status: "pending",
    dependsOnTaskIds: pkg.dependsOnTaskIds ?? [],
  }];
}

function actualPackageTargetShape(targets, expectedTargets) {
  if (!Array.isArray(targets)) return null;
  return targets.map((target, index) => {
    const expected = expectedTargets[index] ?? {};
    const actual = actualPackageShape(target, expected);
    if (Object.hasOwn(expected, "dependsOnTaskIds")) {
      actual.dependsOnTaskIds = target?.dependsOnTaskIds ?? [];
    }
    return actual;
  });
}

function assertPartialStateMatchesIntent(stateRootAbs, intent) {
  const state = rawReadJson(path.join(stateRootAbs, "wakeflow-state.json"));
  const demand = rawReadJson(path.join(stateRootAbs, "demand.json"));
  if (!state || !demand) {
    throw new Error(`partial create authority at ${relative(stateRootAbs)} is missing readable demand/state JSON. Manual reconciliation is required.`);
  }
  const podPlacement = intent.placement === "pod";
  const expectedPodId = podPlacement ? slug(intent.podId ?? intent.demandKey) : null;
  const expectedControllerWindow = podPlacement
    ? (intent.controllerWindow || `Controller__${expectedPodId}`)
    : intent.controllerWindow;
  const criticalState = {
    demandKey: state.demandKey,
    title: state.title,
    testDecision: state.testDecision ?? null,
    ...(expectedControllerWindow ? { controllerWindow: state.controllerWindow ?? null } : {}),
    ...(podPlacement
      ? {
          executionPlacement: state.executionPlacement ?? null,
          podProvisioning: state.podProvisioning ?? null,
        }
      : {}),
  };
  const expectedState = {
    demandKey: intent.demandKey,
    title: intent.title,
    testDecision: intent.testDecision ?? null,
    ...(expectedControllerWindow ? { controllerWindow: expectedControllerWindow } : {}),
    ...(podPlacement
      ? {
          executionPlacement: {
            mode: "isolated",
            podId: expectedPodId,
            selection: "explicit-user-pod",
            authorizationRef: intent.authorizationRef,
          },
          podProvisioning: {
            phase: "creating-control",
            podId: expectedPodId,
            authorizationRef: intent.authorizationRef,
          },
        }
      : {}),
  };
  const criticalDemand = {
    demandKey: demand.demandKey,
    title: demand.title,
    designKey: demand.source?.designKey ?? null,
    sourceDocuments: demand.source?.documents ?? [],
    ...(intent.goal ? { goal: demand.goal } : {}),
    ...(intent.completionDefinition ? { completionDefinition: demand.completionDefinition } : {}),
  };
  const expectedDemand = {
    demandKey: intent.demandKey,
    title: intent.title,
    designKey: intent.todoId ?? null,
    sourceDocuments: intent.sourceDocumentRefs ?? [],
    ...(intent.goal ? { goal: intent.goal } : {}),
    ...(intent.completionDefinition ? { completionDefinition: intent.completionDefinition } : {}),
  };
  if (!sameStableValue(criticalState, expectedState) || !sameStableValue(criticalDemand, expectedDemand)) {
    throw new Error(`partial create authority at ${relative(stateRootAbs)} no longer matches its recorded create intent. Manual reconciliation is required.`);
  }

  const intendedPackages = new Map(
    (intent.taskPackages ?? []).map((pkg) => [pkg.taskPackageId ?? pkg.targetTaskId, pkg]),
  );
  for (const statePackage of state.taskPackages ?? []) {
    const intended = intendedPackages.get(statePackage.taskPackageId);
    if (!intended) {
      throw new Error(`partial create authority at ${relative(stateRootAbs)} contains an unintended task package ${statePackage.taskPackageId}. Manual reconciliation is required.`);
    }
    const expected = intendedPackageShape(intended, intent.title);
    if (
      !sameStableValue(actualPackageShape(statePackage, expected), expected)
      || typeof statePackage.createdAt !== "string"
      || !statePackage.createdAt.trim()
    ) {
      throw new Error(`existing task package ${statePackage.taskPackageId} in ${relative(stateRootAbs)} has drifted from the recorded create intent. Manual reconciliation is required.`);
    }
    const packageFile = path.join(stateRootAbs, "task-packages", `${slug(statePackage.taskPackageId)}.json`);
    const packageArtifact = rawReadJson(packageFile);
    const expectedArtifact = {
      schemaVersion: 1,
      ...expected,
      status: "pending",
      demandKey: intent.demandKey,
      targetTasks: intendedPackageTargetShape(intended, statePackage.taskPackageId, intent.title),
    };
    const actualArtifact = packageArtifact
      ? {
          ...actualPackageShape(packageArtifact, expected),
          schemaVersion: packageArtifact.schemaVersion ?? null,
          status: packageArtifact.status ?? null,
          demandKey: packageArtifact.demandKey ?? null,
          targetTasks: actualPackageTargetShape(packageArtifact.targetTasks, expectedArtifact.targetTasks),
        }
      : null;
    if (
      !packageArtifact
      || !sameStableValue(actualArtifact, expectedArtifact)
      || typeof packageArtifact.createdAt !== "string"
      || !packageArtifact.createdAt.trim()
      || (packageArtifact.targetTasks ?? []).some(
        (target) => typeof target.createdAt !== "string" || !target.createdAt.trim(),
      )
    ) {
      throw new Error(`existing task package artifact ${relative(packageFile)} is missing or has drifted from the recorded create intent. Manual reconciliation is required.`);
    }
    if (intended.targetWindow) {
      const targetTaskId = intended.targetTaskId ?? `${statePackage.taskPackageId}__${slug(intended.targetWindow)}`;
      const target = (state.targetTasks ?? []).find((item) => item.targetTaskId === targetTaskId);
      const expectedTarget = {
        targetTaskId,
        taskPackageId: statePackage.taskPackageId,
        targetWindow: intended.targetWindow,
        summary: intended.summary ?? intent.title,
        dependsOnTaskIds: expected.dependsOnTaskIds ?? [],
      };
      const actualTarget = target
        ? {
            targetTaskId: target.targetTaskId,
            taskPackageId: target.taskPackageId,
            targetWindow: target.targetWindow,
            summary: target.summary,
            dependsOnTaskIds: target.dependsOnTaskIds ?? [],
          }
        : null;
      if (!target || !sameStableValue(actualTarget, expectedTarget)) {
        throw new Error(`existing target task ${targetTaskId} in ${relative(stateRootAbs)} has drifted from the recorded create intent. Manual reconciliation is required.`);
      }
    }
  }
  const intendedTargetTaskIds = new Set(
    (intent.taskPackages ?? [])
      .filter((pkg) => pkg.targetWindow)
      .map((pkg) => pkg.targetTaskId ?? `${pkg.taskPackageId ?? pkg.targetTaskId}__${slug(pkg.targetWindow)}`),
  );
  const unexpectedTargetTask = (state.targetTasks ?? [])
    .find((target) => !intendedTargetTaskIds.has(target.targetTaskId));
  if (unexpectedTargetTask) {
    throw new Error(`partial create authority at ${relative(stateRootAbs)} contains an unintended target task ${unexpectedTargetTask.targetTaskId}. Manual reconciliation is required.`);
  }
  return { state, demand };
}

function assertCompleteStateMatchesIntent(stateRootAbs, intent) {
  const { state } = assertPartialStateMatchesIntent(stateRootAbs, intent);
  const expectedIds = intendedCreateIds(intent);
  const actualPackageIds = (state.taskPackages ?? []).map((pkg) => pkg.taskPackageId);
  const actualTargetTaskIds = (state.targetTasks ?? []).map((target) => target.targetTaskId);
  if (
    !sameStableValue([...actualPackageIds].sort(), [...expectedIds.packageIds].sort())
    || !sameStableValue([...actualTargetTaskIds].sort(), [...expectedIds.targetTaskIds].sort())
  ) {
    throw new Error(`complete create authority at ${relative(stateRootAbs)} does not contain the full package/target set recorded by its intent. Manual reconciliation is required.`);
  }
}

function createHasExternalProgress(stateRootAbs, recovery) {
  const state = rawReadJson(path.join(stateRootAbs, "wakeflow-state.json"));
  if (!state) return true;
  if (recovery?.todoConsumed) return true;
  const todoId = recovery?.manifest?.intent?.todoId;
  if (todoId && todoWasConsumed(todoId)) return true;
  try {
    assertPartialStateMatchesIntent(stateRootAbs, recovery?.manifest?.intent ?? {});
  } catch {
    return true;
  }
  const intendedPackageIds = new Set(recovery?.packageIds ?? []);
  const intendedTargetTaskIds = new Set(recovery?.targetTaskIds ?? []);
  if ((state.taskPackages ?? []).some((item) => !intendedPackageIds.has(item.taskPackageId))) return true;
  if ((state.targetTasks ?? []).some((item) => !intendedTargetTaskIds.has(item.targetTaskId))) return true;
  if ((state.targetTasks ?? []).some((item) => item.delivery || !["pending", "planned"].includes(item.status ?? "pending"))) return true;
  if ((state.reviewCandidates ?? []).length > 0 || (state.blockers ?? []).length > 0 || (state.decisionsRequired ?? []).length > 0) return true;
  if (filesUnder(path.join(stateRootAbs, "target-results")).length > 0) return true;
  if (filesUnder(path.join(stateRootAbs, "evidence")).length > 0) return true;
  const intendedPackageFiles = new Set(
    [...intendedPackageIds].map((packageId) => `task-packages/${slug(packageId)}.json`),
  );
  const allowedCreateFiles = new Set([
    ".wakeflow-create-demand.json",
    "controller-events.jsonl",
    "demand.json",
    "developer-progress.md",
    "index.md",
    "projection.json",
    "wakeflow-state.json",
  ]);
  const unexpectedStateRootFile = filesUnder(stateRootAbs)
    .map((file) => path.relative(stateRootAbs, file).split(path.sep).join("/"))
    .find((ref) => !allowedCreateFiles.has(ref) && !intendedPackageFiles.has(ref));
  if (unexpectedStateRootFile) return true;
  const transportRoot = path.join(workspaceRoot, ".wakeflow-local", "wakeflow-delivery");
  for (const file of jsonFilesUnder(transportRoot)) {
    const artifact = rawReadJson(file);
    if (artifactReferencesDemand(artifact, recovery)) return true;
  }

  try {
    const allowedEventTypes = new Set([
      "state.initialized",
      "demand.host-adopted",
      "task-package.added",
    ]);
    const events = readFileSync(path.join(stateRootAbs, "controller-events.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (events.some((event) => !allowedEventTypes.has(event.type))) return true;
  } catch {
    return true;
  }
  return false;
}

function recoverFailedCreate(stateRootAbs, recovery) {
  if (!recovery) return null;
  const sidecarFile = createIntentSidecarFile(stateRootAbs);
  if (!recovery.createdRoot && !recovery.resumePartial && recovery.ownsSidecar && !existsSync(stateRootAbs)) {
    if (existsSync(sidecarFile)) rmSync(sidecarFile, { force: true });
    activeCreateRecovery = null;
    return { removed: false, cleanedPreIntent: true, sameIntentRetryAllowed: false };
  }
  const rootPublishedByThisAttempt = Boolean(
    recovery.createdRoot
    || (
      !recovery.resumePartial
      && recovery.ownsSidecar
      && existsSync(stateRootAbs)
    )
  );
  if (!rootPublishedByThisAttempt && !recovery.resumePartial) {
    return { removed: false, sameIntentRetryAllowed: false };
  }
  const manifestFile = createIntentManifestFile(stateRootAbs);
  if (!existsSync(stateRootAbs) && !recovery.resumePartial) {
    if (recovery.ownsSidecar && existsSync(sidecarFile)) rmSync(sidecarFile, { force: true });
    activeCreateRecovery = null;
    return { removed: true, sameIntentRetryAllowed: false };
  }
  let removed = false;
  if (rootPublishedByThisAttempt && existsSync(stateRootAbs)) {
    withStateRootLock(stateRootAbs, () => {
      if (!createHasExternalProgress(stateRootAbs, recovery)) {
        rmSync(stateRootAbs, { recursive: true, force: true });
        if (existsSync(sidecarFile)) rmSync(sidecarFile, { force: true });
        removed = true;
      }
    });
  }
  if (removed) {
    activeCreateRecovery = null;
    return { removed: true, sameIntentRetryAllowed: false };
  }
  if (existsSync(stateRootAbs)) {
    const prior = rawReadJson(manifestFile);
    const partialManifest = {
      ...(prior ?? recovery.manifest),
      status: "partial",
      partialCreated: true,
      intentDigest: recovery.intentDigest,
      failedAt: new Date().toISOString(),
    };
    writeJsonAtomic(sidecarFile, partialManifest);
    writeJsonAtomic(manifestFile, partialManifest);
  }
  return {
    removed: false,
    sameIntentRetryAllowed: Boolean(
      existsSync(stateRootAbs)
      && rawReadJson(sidecarFile)?.intentDigest === recovery.intentDigest
      && rawReadJson(manifestFile)?.intentDigest === recovery.intentDigest
    ),
  };
}
function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demand";
}

function readJson(file, label = "JSON file") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${relative(file)}: ${error.message}`);
  }
  return null;
}
function readWorkspaceConfig() {
  if (cachedWorkspaceConfig !== undefined) return cachedWorkspaceConfig;
  const configPath = trackedWorkspaceConfigPath(workspaceRoot);
  cachedWorkspaceConfig = existsSync(configPath) ? readJson(configPath, "workspace config") : null;
  return cachedWorkspaceConfig;
}
function runControllerState(argsForScript) {
  const result = runSync(process.execPath, [path.join(scriptsDir, "wakeflow-state.mjs"), ...argsForScript], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    let stateFailure = null;
    try {
      stateFailure = result.stdout ? JSON.parse(result.stdout) : null;
    } catch {
      stateFailure = null;
    }
    fail([
      `wakeflow-state failed: node scripts/wakeflow-state.mjs ${argsForScript.join(" ")}`,
      stateFailure?.error ?? result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"), {
      status: stateFailure?.status,
      errorCode: stateFailure?.errorCode,
      retryable: stateFailure?.diagnostics?.retryable,
      recovery: stateFailure?.diagnostics?.recovery,
      activeDemands: stateFailure?.activeDemands,
      placement: stateFailure?.placement,
      mainlineHealth: stateFailure?.mainlineHealth,
    });
  }
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function runRenderProgressDoc(stateRoot) {
  const result = runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-render-progress.mjs"),
    "--root",
    workspaceRoot,
    "--state-root",
    stateRoot,
    "--write",
    "--json",
  ], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail([
      `wakeflow-render-progress failed for ${stateRoot}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout ? JSON.parse(result.stdout) : null;
}
function runTodoConsume(designKey, mount) {
  return runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-todo.mjs"),
    "consume", "--root", workspaceRoot, "--design-key", designKey, "--mount", mount, "--apply", "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runNextWorkTodo(todoId = null) {
  const result = runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-next-work.mjs"),
    "--root", workspaceRoot, "--source", "todo",
    ...(todoId ? ["--id", todoId] : []),
    "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { candidates: [], recommended: null };
  }
}

function runCreateDemandTodo(todoId, {
  controllerWindow = "",
  placement = "main",
  authorizationRef = "",
  podId = "",
  apply = true,
} = {}) {
  return runSync(process.execPath, [
    path.join(scriptsDir, "wakeflow-demand-sequence.mjs"),
    "create-demand", "--root", workspaceRoot, "--todo-id", todoId,
    "--placement", placement,
    ...(authorizationRef ? ["--authorization-ref", authorizationRef] : []),
    ...(podId ? ["--pod-id", podId] : []),
    ...(controllerWindow ? ["--controller-window", controllerWindow] : []),
    ...(apply ? ["--write"] : []),
    "--json",
  ], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function preflightTaskPackages(taskPackages) {
  if (!Array.isArray(taskPackages)) fail("--task-packages must be a JSON array of task package objects.");
  const packageIds = new Set(), targetTaskIds = new Set();
  const configuredTestWindows = testWindowNames(loadWorkspaceConfig({ workspaceRoot, args: options }));
  taskPackages.forEach((pkg, index) => {
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) fail(`--task-packages entry ${index + 1} must be a JSON object.`);
    for (const field of ["summary", "targetWindow", "targetTaskId", "sourceRef", "designIntent"]) {
      if (pkg[field] !== undefined && (typeof pkg[field] !== "string" || !pkg[field].trim())) {
        fail(`--task-packages entry ${index + 1}.${field} must be a non-empty string.`);
      }
    }
    const packageId = pkg.taskPackageId ?? pkg.targetTaskId;
    if (typeof packageId !== "string" || !packageId.trim()) fail(`--task-packages entry ${index + 1} needs a non-empty taskPackageId or targetTaskId.`);
    const packageStorageId = slug(packageId).toLowerCase();
    if (packageIds.has(packageStorageId)) fail(`--task-packages task package ids must be unique after path normalization; duplicate: ${packageId}.`);
    packageIds.add(packageStorageId);
    if (configuredTestWindows.some((window) => pkg.targetWindow === window || pkg.targetWindow?.startsWith(`${window}__`))) {
      fail(`--task-packages entry ${index + 1} targets ${pkg.targetWindow}; initial Test work requires a state-root Test card and cannot be added by create-demand.`);
    }
    if (pkg.workType === "test") {
      fail(`--task-packages entry ${index + 1} uses workType=test; create the demand, intake its Test card, then add the bounded Test task separately.`);
    }
    const targetTaskId = pkg.targetWindow ? (pkg.targetTaskId ?? `${packageId}__${slug(pkg.targetWindow)}`) : null;
    if (pkg.targetTaskId !== undefined && pkg.targetWindow === undefined) {
      fail(`--task-packages entry ${index + 1}.targetTaskId requires targetWindow.`);
    }
    if (targetTaskId) {
      if (targetTaskIds.has(targetTaskId)) fail(`--task-packages target task ids must be unique; duplicate: ${targetTaskId}.`);
    }
    if (pkg.acceptanceAnchors !== undefined) {
      const ids = new Set();
      if (!Array.isArray(pkg.acceptanceAnchors) || pkg.acceptanceAnchors.length === 0) fail(`--task-packages entry ${index + 1}.acceptanceAnchors must be a non-empty array.`);
      for (const anchor of pkg.acceptanceAnchors) {
        const anchorId = typeof anchor?.id === "string" ? anchor.id.trim() : "";
        if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)
          || ["id", "claim", "probe", "expected"].some((field) => typeof anchor[field] !== "string" || !anchor[field].trim())
          || ids.has(anchorId)) fail(`--task-packages entry ${index + 1}.acceptanceAnchors must contain unique {id, claim, probe, expected} string fields.`);
        ids.add(anchorId);
      }
    }
    if (pkg.evidenceContract !== undefined && (!pkg.evidenceContract || typeof pkg.evidenceContract !== "object" || Array.isArray(pkg.evidenceContract))) {
      fail(`--task-packages entry ${index + 1}.evidenceContract must be a JSON object.`);
    }
    for (const listName of ["required", "advisory"]) {
      const list = pkg.evidenceContract?.[listName];
      if (list !== undefined && (!Array.isArray(list)
        || list.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.kind !== "string" || !entry.kind.trim()))) {
        fail(`--task-packages entry ${index + 1}.evidenceContract.${listName} must be an array of objects with a non-empty kind.`);
      }
    }
    const contextKeys = ["workType", "objective", "contextSummary", "requirementRefs", "boundaries", "completionExpectations", "dependsOnTaskIds", "commitExpectation"];
    if (contextKeys.some((key) => pkg[key] !== undefined)) {
      try {
        const context = normalizeTaskPackageContext({ ...pkg, acceptanceAnchors: pkg.acceptanceAnchors, contextVersion: 1 });
        if (new Set(context.dependsOnTaskIds).size !== context.dependsOnTaskIds.length) {
          fail(`--task-packages entry ${index + 1}.dependsOnTaskIds must not contain duplicates.`);
        }
        for (const requirementRef of context.requirementRefs) {
          const issue = requirementRefIssue(workspaceRoot, requirementRef);
          if (issue) {
            fail(`--task-packages entry ${index + 1} has invalid task context: ${issue}`);
          }
        }
        const missing = context.dependsOnTaskIds.find((dependency) => !targetTaskIds.has(dependency));
        if (missing) fail(`--task-packages entry ${index + 1} depends on ${missing}, which is not an earlier target task in this create-demand sequence.`);
      } catch (error) {
        if (error instanceof CliExit) throw error;
        fail(`--task-packages entry ${index + 1} has invalid task context: ${error.message}`);
      }
    }
    if (targetTaskId) targetTaskIds.add(targetTaskId);
  });
}

// Unified create: replaces init_demand + intake_design_handoff + add_task + adopt_demand_host.
// From a delivered TODO row (--todo-id) it reads the title + Documents and synthesizes the
// goal/completion from them (or takes them explicitly); it inits the state root, adopts host,
// adds any initial task packages, renders progress, and consumes the TODO row (writing the
// state root into its Current Mount). The demand execution state machine is unchanged.
function commandCreateDemand() {
  const todoId = getValue("--todo-id");
  const explicitDemandKey = getValue("--demand-key");
  const placement = String(getValue("--placement", "main") || "main").trim().toLowerCase();
  const authorizationRef = String(getValue("--authorization-ref", "") || "").trim();
  const podId = String(getValue("--pod-id", "") || "").trim();
  if (!["main", "pod"].includes(placement)) {
    fail(`--placement must be main or pod, got ${placement || "(empty)"}.`);
  }
  if (placement === "pod" && !authorizationRef) {
    fail("--authorization-ref is required when --placement pod is explicitly requested.");
  }
  if (placement === "main" && (authorizationRef || podId)) {
    fail("--authorization-ref and --pod-id are valid only with --placement pod.");
  }
  if (todoId && explicitDemandKey && explicitDemandKey !== todoId) {
    fail(`--demand-key must equal --todo-id when creating from a delivered TODO row; ${todoId} is the canonical demand identity.`);
  }
  let demandKey = explicitDemandKey ?? todoId;
  let title = getValue("--title");
  let goal = getValue("--goal");
  let completionDefinition = getValue("--completion-definition");
  let testDecision = getValue("--test-decision");
  let stagePlan = getValue("--stage-plan");

  const taskPackagesRaw = getValue("--task-packages");
  let taskPackages = [];
  if (taskPackagesRaw) {
    try {
      taskPackages = JSON.parse(taskPackagesRaw);
    } catch {
      fail("--task-packages must be a valid JSON array of {taskPackageId, summary, targetWindow, targetTaskId}.");
    }
  }
  preflightTaskPackages(taskPackages);

  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: options, config });
  const provisionalStateRootAbs = demandKey
    ? path.join(ledgerPaths.workspaceCurrentDir, slug(demandKey))
    : null;
  let sourceDocumentRefs = [];
  if (todoId) {
    const scan = runNextWorkTodo(todoId);
    const candidate = [...(scan.candidates ?? []), ...(scan.waitingCandidates ?? [])]
      .find((entry) => entry.id === todoId)
      ?? (scan.recommended && scan.recommended.id === todoId ? scan.recommended : null);
    if (!candidate) {
      const recoveryManifest = provisionalStateRootAbs
        ? readCreateRecoveryManifest(provisionalStateRootAbs)
        : null;
      const recoveryIntent = recoveryManifest?.intent;
      if (
        !recoveryIntent
        || recoveryIntent.todoId !== todoId
        || !sameStableValue(recoveryIntent.taskPackages ?? [], taskPackages)
      ) {
        fail(`TODO row ${todoId} is not an eligible candidate (missing, blocked, or not controller-recommended); inspect it with wakeflow_next_work source=todo first.`);
      }
      title = title ?? recoveryIntent.title;
      sourceDocumentRefs = recoveryIntent.sourceDocumentRefs ?? [];
      goal = goal ?? recoveryIntent.goal;
      completionDefinition = completionDefinition ?? recoveryIntent.completionDefinition;
      testDecision = testDecision ?? recoveryIntent.testDecision;
      stagePlan = stagePlan ?? recoveryIntent.stagePlan;
    } else {
      title = title ?? candidate.title;
      const documents = candidate.documents ?? "";
      // next-work resolves board-relative Markdown targets back to workspace refs.
      // Keep the fallback for older next-work payloads and hand-authored rows.
      sourceDocumentRefs = Array.isArray(candidate.documentRefs) ? candidate.documentRefs : [];
      if (sourceDocumentRefs.length === 0) {
        sourceDocumentRefs = [...documents.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
      }
      if (sourceDocumentRefs.length === 0 && documents.trim()) sourceDocumentRefs = [documents.trim()];
      if (!testDecision && candidate.testDecision?.trim()) testDecision = candidate.testDecision.trim();
      const documentSummary = sourceDocumentRefs.map((ref) => `\`${ref}\``).join(", ");
      if (!goal) {
        goal = documentSummary
          ? `Deliver the requirement described by the delivered docs: ${documentSummary}`
          : `Deliver TODO ${todoId}: ${title}`;
      }
      if (!completionDefinition) {
        completionDefinition = "Total control confirms the completion definition from the delivered docs before dispatch.";
      }
      if (!stagePlan && documentSummary) {
        stagePlan = `Derive the stage plan from the delivered docs: ${documentSummary}`;
      }
    }
  }

  if (!demandKey) fail("--demand-key or --todo-id is required.");
  if (!title) fail("--title is required (or pass --todo-id pointing at a titled delivered row).");

  const stateRootAbs = path.join(ledgerPaths.workspaceCurrentDir, slug(demandKey));
  const stateRoot = relative(stateRootAbs);
  const demandControllerWindow = getValue("--controller-window", "");
  const packageIds = taskPackages.map((pkg) => pkg.taskPackageId ?? pkg.targetTaskId);
  const targetTaskIds = taskPackages
    .filter((pkg) => pkg.targetWindow)
    .map((pkg) => pkg.targetTaskId ?? `${pkg.taskPackageId ?? pkg.targetTaskId}__${slug(pkg.targetWindow)}`);
  const createIntent = {
    version: 1,
    demandKey,
    title,
    todoId: todoId ?? null,
    sourceDocumentRefs,
    goal: goal ?? null,
    completionDefinition: completionDefinition ?? null,
    testDecision: testDecision ?? null,
    stagePlan: stagePlan ?? null,
    controllerWindow: demandControllerWindow || null,
    ...(placement === "pod"
      ? {
          placement,
          authorizationRef,
          podId: podId || null,
        }
      : {}),
    taskPackages,
  };
  const intentDigest = stableDigest(createIntent);
  const manifestFile = createIntentManifestFile(stateRootAbs);
  const sidecarFile = createIntentSidecarFile(stateRootAbs);
  const existingStateFile = path.join(stateRootAbs, "wakeflow-state.json");
  const stateInitArgs = ({ apply = false } = {}) => {
    const initArgs = ["init", "--root", workspaceRoot, "--state-root", stateRoot, "--demand-key", demandKey, "--title", title];
    if (todoId) initArgs.push("--design-key", todoId);
    for (const doc of sourceDocumentRefs) initArgs.push("--source-doc", doc);
    if (goal) initArgs.push("--goal", goal);
    if (completionDefinition) initArgs.push("--completion-definition", completionDefinition);
    if (testDecision) initArgs.push("--test-decision", testDecision);
    if (stagePlan) initArgs.push("--stage-plan", stagePlan);
    initArgs.push("--placement", placement);
    if (placement === "main") {
      initArgs.push("--require-mainline-health");
      for (const windowName of [...new Set(taskPackages
        .map((pkg) => pkg.targetWindow)
        .filter(Boolean))]) {
        initArgs.push("--required-mainline-window", windowName);
      }
      initArgs.push("--ignore-create-intent-file", sidecarFile);
    }
    if (authorizationRef) initArgs.push("--authorization-ref", authorizationRef);
    if (podId) initArgs.push("--pod-id", podId);
    if (demandControllerWindow) initArgs.push("--controller-window", demandControllerWindow);
    if (apply) initArgs.push("--write");
    initArgs.push("--json");
    return initArgs;
  };
  const runCreateLocked = () => {
    const priorManifest = readCreateRecoveryManifest(stateRootAbs);
    if (priorManifest && priorManifest.intentDigest !== intentDigest) {
      fail(`create-demand intent differs from the recoverable intent for ${stateRoot}; refuse to continue ${demandKey}.`);
    }
    const stateExists = existsSync(existingStateFile);
    let rootExists = false;
    try {
      rootExists = readdirSync(stateRootAbs).length >= 0;
    } catch (error) {
      if (error?.code !== "ENOENT") rootExists = true;
    }
    let resumePartial = false;
    if (stateExists) {
      if (priorManifest?.status === "complete" && existsSync(sidecarFile)) {
        try {
          assertCompleteStateMatchesIntent(stateRootAbs, createIntent);
        } catch (error) {
          fail(error.message);
        }
        if (todoId && !todoWasConsumed(todoId)) {
          fail(`create-demand manifest is complete but TODO row ${todoId} is still eligible; manual reconciliation is required.`);
        }
        if (!write) {
          output({
            ok: true,
            command: "create-demand",
            wrote: false,
            wouldRecoverCompleted: { demandKey, title, stateRoot, intentDigest },
          }, [`Would remove the stale create-demand recovery sidecar for completed demand ${demandKey}`]);
          return;
        }
        rmSync(sidecarFile, { force: true });
        output({
          ok: true,
          command: "create-demand",
          wrote: true,
          recoveredCompleted: true,
          created: {
            demandKey,
            title,
            stateRoot,
            taskPackages: (rawReadJson(existingStateFile)?.taskPackages ?? []).map((pkg) => pkg.taskPackageId),
            consumedTodoId: todoId ?? null,
          },
          intentDigest,
          forbiddenConclusions: ["create-demand-is-dispatch", "create-demand-is-acceptance"],
          agentNext: "Recovered the final create-demand cleanup after its complete manifest was already committed. Dispatch remains a separate step.",
        }, [`Recovered completed demand creation ${demandKey} at ${stateRoot}`]);
        return;
      }
      if (!priorManifest || !["partial", "preparing"].includes(priorManifest.status)) {
        fail(`a demand state root already exists at ${stateRoot}; refuse to re-create ${demandKey}.`);
      }
      try {
        assertPartialStateMatchesIntent(stateRootAbs, createIntent);
      } catch (error) {
        fail(error.message);
      }
      resumePartial = true;
    } else if (rootExists) {
      activeCreateRecovery = {
        stateRoot,
        stateRootAbs,
        intentDigest,
        packageIds,
        targetTaskIds,
        createdRoot: false,
        resumePartial: false,
        ownsSidecar: false,
        manifest: priorManifest,
      };
      fail(`a demand state root already exists at ${stateRoot}, but it has no recoverable state authority.`);
    } else if (priorManifest?.status === "complete") {
      fail(`create-demand recovery metadata says ${demandKey} is complete, but its state root is missing. Manual reconciliation is required.`);
    }

    // A fresh create probes placement before writing its recovery sidecar.
    // This keeps normal mainline waiting at zero new state/TODO/package
    // artifacts. The write-mode init repeats the check under the same
    // workspace identity lock, closing the race between probe and publish.
    if (!resumePartial) {
      runControllerState(stateInitArgs({ apply: false }));
    }

    if (!write) {
      output({
        ok: true,
        command: "create-demand",
        wrote: false,
        ...(resumePartial
          ? { wouldResume: { demandKey, title, stateRoot, todoId: todoId ?? null, taskPackageCount: taskPackages.length, intentDigest } }
          : { wouldCreate: { demandKey, title, stateRoot, todoId: todoId ?? null, taskPackageCount: taskPackages.length, intentDigest } }),
      }, [`Would ${resumePartial ? "resume" : "create"} demand ${demandKey} at ${stateRoot}`]);
      return;
    }

    const manifest = {
      schemaVersion: 1,
      artifactKind: "wakeflow-create-demand-intent",
      demandKey,
      stateRoot,
      intentDigest,
      intent: createIntent,
      packageIds,
      targetTaskIds,
      status: "preparing",
      partialCreated: true,
      createdAt: priorManifest?.createdAt ?? new Date().toISOString(),
    };
    activeCreateRecovery = {
      stateRoot,
      stateRootAbs,
      intentDigest,
      packageIds,
      targetTaskIds,
      createdRoot: false,
      resumePartial,
      ownsSidecar: !priorManifest,
      manifest,
    };
    writeJsonAtomic(sidecarFile, manifest);

    let initOut = null;
    if (!resumePartial) {
      initOut = runControllerState(stateInitArgs({ apply: true }));
      activeCreateRecovery.createdRoot = true;
      const partialManifest = { ...manifest, status: "partial" };
      activeCreateRecovery.manifest = partialManifest;
      writeJsonAtomic(sidecarFile, partialManifest);
      writeJsonAtomic(manifestFile, partialManifest);
    } else {
      const partialManifest = { ...manifest, status: "partial" };
      activeCreateRecovery.manifest = partialManifest;
      writeJsonAtomic(sidecarFile, partialManifest);
      writeJsonAtomic(manifestFile, partialManifest);
    }
    runControllerState(["adopt-demand-host", "--root", workspaceRoot, "--state-root", stateRoot, "--reason", "create-demand", "--write", "--json"]);

    const addedPackages = [];
    const existingPackageIds = new Set(
      (rawReadJson(existingStateFile)?.taskPackages ?? []).map((pkg) => pkg.taskPackageId),
    );
    for (const pkg of taskPackages) {
      const packageId = pkg.taskPackageId ?? pkg.targetTaskId;
      if (existingPackageIds.has(packageId)) {
        addedPackages.push(packageId);
        continue;
      }
      const tpArgs = ["add-task-package", "--root", workspaceRoot, "--state-root", stateRoot, "--task-package-id", packageId, "--summary", pkg.summary ?? title];
      if (pkg.targetWindow) tpArgs.push("--target-window", pkg.targetWindow);
      if (pkg.targetTaskId) tpArgs.push("--target-task-id", pkg.targetTaskId);
      if (pkg.sourceRef) tpArgs.push("--source-ref", pkg.sourceRef);
      if (pkg.workType) tpArgs.push("--work-type", pkg.workType);
      if (pkg.objective) tpArgs.push("--objective", pkg.objective);
      if (pkg.contextSummary) tpArgs.push("--context-summary", JSON.stringify(pkg.contextSummary));
      if (pkg.requirementRefs) tpArgs.push("--requirement-refs", JSON.stringify(pkg.requirementRefs));
      if (pkg.boundaries) tpArgs.push("--boundaries", JSON.stringify(pkg.boundaries));
      if (pkg.completionExpectations) tpArgs.push("--completion-expectations", JSON.stringify(pkg.completionExpectations));
      if (pkg.dependsOnTaskIds) tpArgs.push("--depends-on-task-ids", JSON.stringify(pkg.dependsOnTaskIds));
      if (pkg.commitExpectation) tpArgs.push("--commit-expectation", pkg.commitExpectation);
      if (pkg.designIntent) tpArgs.push("--design-intent", pkg.designIntent);
      if (pkg.acceptanceAnchors) tpArgs.push("--acceptance-anchors", JSON.stringify(pkg.acceptanceAnchors));
      if (pkg.evidenceContract) tpArgs.push("--evidence-contract", JSON.stringify(pkg.evidenceContract));
      tpArgs.push("--write", "--json");
      runControllerState(tpArgs);
      addedPackages.push(packageId);
    }

    const renderOut = runRenderProgressDoc(stateRoot);
    let consumedTodoId = null;
    if (todoId) {
      const consumeResult = runTodoConsume(todoId, stateRoot);
      if (consumeResult.status !== 0) {
        fail(`demand ${demandKey} created, but consuming TODO row ${todoId} failed: ${(consumeResult.stdout || consumeResult.stderr || "").trim()}`);
      }
      consumedTodoId = todoId;
      activeCreateRecovery.todoConsumed = true;
    }

    const completedManifest = {
      ...manifest,
      status: "complete",
      partialCreated: false,
      completedAt: new Date().toISOString(),
    };
    writeJsonAtomic(manifestFile, completedManifest);
    activeCreateRecovery = null;
    if (existsSync(sidecarFile)) rmSync(sidecarFile, { force: true });

    output({
      ok: true,
      command: "create-demand",
      wrote: true,
      created: { demandKey, title, stateRoot, taskPackages: addedPackages, consumedTodoId },
      ...(resumePartial ? { resumedPartial: true } : {}),
      intentDigest,
      controllerOutputs: [initOut, renderOut].filter(Boolean),
      ...(testDecision ? {} : { testDecisionReminder: "No testing decision recorded for this demand. Confirm the test approach was decided at Design (requirement-design testing decision), or record it with --test-decision. Reminder only — not a gate." }),
      ...(taskPackages.length > 0 && taskPackages.every((pkg) => !pkg.evidenceContract)
        ? { evidenceContractReminder: "None of the initial task packages carries a craft review-input contract: the craft gate stays dormant for this demand. If this is implementation work, author evidenceContract requirements per package (kinds like tests/change-scope; see wakeflow-target-craft). Reminder only — not a gate." }
        : {}),
      forbiddenConclusions: ["create-demand-is-dispatch", "create-demand-is-acceptance"],
      agentNext: `Demand created and any delivered TODO row consumed. Dispatch is a separate step; no dispatch, delivery, or acceptance was performed.${testDecision ? "" : " Reminder: no testing decision recorded — confirm the Design-stage test approach or record it."}`,
    }, [`Created demand ${demandKey} at ${stateRoot}`]);
  };
  const runCreate = () => {
    try {
      return runCreateLocked();
    } catch (error) {
      if (error instanceof CliExit) throw error;
      fail(`create-demand failed: ${error.message}`);
    }
    return null;
  };

  if (!write) {
    runCreate();
    return;
  }
  mkdirSync(ledgerPaths.workspaceCurrentDir, { recursive: true });
  try {
    // A create lock guards only this short synchronous transaction. Use a
    // bounded crash grace so an abruptly exited creator can be resumed
    // immediately without weakening the generic state-lock stale policy.
    withFileLock(createDemandLockFile(stateRootAbs), runCreate, { staleMs: 250 });
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

// Unified controller auto-claim: the global-TODO-board successor to claim-from-design.
// Unattended (no key), it claims the single controller-claimable row (Auto Claim = yes and
// eligible). With an explicit --design-key/--todo-id, a user-confirmed eligible row may be
// claimed even when not auto-claimable. It delegates to create-demand, so it inits a state
// root and consumes the row only — no dispatch, evidence acceptance, or per-demand
// confirmation bypass.
function commandClaimTodo() {
  const explicitId = getValue("--todo-id") ?? getValue("--design-key");
  const placement = String(getValue("--placement", "main") || "main").trim().toLowerCase();
  const authorizationRef = String(getValue("--authorization-ref", "") || "").trim();
  const podId = String(getValue("--pod-id", "") || "").trim();
  if (!["main", "pod"].includes(placement)) {
    fail(`--placement must be main or pod, got ${placement || "(empty)"}.`);
  }
  if (!explicitId && placement === "pod") {
    fail("unattended Auto Claim cannot create an isolated pod; pass an explicit --design-key/--todo-id plus --authorization-ref.");
  }
  if (placement === "pod" && !authorizationRef) {
    fail("--authorization-ref is required when --placement pod is explicitly requested.");
  }
  if (placement === "main" && (authorizationRef || podId)) {
    fail("--authorization-ref and --pod-id are valid only with --placement pod.");
  }
  const scan = runNextWorkTodo();
  const candidates = scan.candidates ?? [];
  const waitingCandidates = scan.waitingCandidates ?? [];

  let target;
  if (explicitId) {
    target = [...candidates, ...waitingCandidates].find((entry) => entry.id === explicitId);
    if (!target) {
      fail(`TODO row ${explicitId} is not an eligible candidate (missing, blocked, or not controller-recommended); inspect it with wakeflow_next_work source=todo first.`);
    }
  } else {
    const claimable = candidates.filter((entry) => entry.controllerClaimable);
    if (claimable.length === 0) {
      const waitingAutoClaim = waitingCandidates.filter((entry) => entry.autoClaim);
      if (waitingAutoClaim.length > 0) {
        fail(
          `mainline is busy; controller-claimable TODO row(s) ${waitingAutoClaim.map((entry) => entry.id).join(", ")} remain waiting and were not consumed.`,
          {
            status: "waiting",
            errorCode: "mainline-busy",
            retryable: true,
            activeDemands: scan.activeDemands,
            placement: { requested: "main", selection: "mainline-default" },
            recovery: "Continue the active mainline demand or wait until it is archived. Auto Claim never creates a pod.",
          },
        );
      }
      output({
        ok: true,
        command: "claim-todo",
        wrote: false,
        claimed: null,
        agentNext: "No controller-claimable TODO row (Auto Claim = yes and eligible). Deliver one with Auto Claim, or claim a specific eligible row explicitly with --design-key.",
      }, ["No controller-claimable TODO row to auto-claim."]);
      return;
    }
    if (claimable.length > 1) {
      fail(`multiple controller-claimable TODO rows (${claimable.map((entry) => entry.id).join(", ")}); claim one explicitly with --design-key.`);
    }
    target = claimable[0];
  }

  const createOptions = {
    controllerWindow: getValue("--controller-window", ""),
    placement,
    authorizationRef,
    podId,
  };
  if (!write) {
    const probed = runCreateDemandTodo(target.id, { ...createOptions, apply: false });
    if (probed.status !== 0) {
      let payload = null;
      try {
        payload = probed.stdout ? JSON.parse(probed.stdout) : null;
      } catch {
        payload = null;
      }
      fail(payload?.error ?? `failed to probe TODO row ${target.id}: ${(probed.stdout || probed.stderr || "").trim()}`, {
        status: payload?.status,
        errorCode: payload?.errorCode,
        retryable: payload?.retryable,
        recovery: payload?.recovery,
        activeDemands: payload?.activeDemands,
        placement: payload?.placement,
      });
    }
    output({
      ok: true,
      command: "claim-todo",
      wrote: false,
      wouldClaim: {
        id: target.id,
        title: target.title,
        autoClaim: target.controllerClaimable,
        placement,
      },
    }, [`Would claim TODO ${target.id}`]);
    return;
  }

  const created = runCreateDemandTodo(target.id, createOptions);
  if (created.status !== 0) {
    let payload = null;
    try {
      payload = created.stdout ? JSON.parse(created.stdout) : null;
    } catch {
      payload = null;
    }
    fail(payload?.error ?? `failed to create the demand from TODO row ${target.id}: ${(created.stdout || created.stderr || "").trim()}`, {
      status: payload?.status,
      errorCode: payload?.errorCode,
      retryable: payload?.retryable,
      recovery: payload?.recovery,
      activeDemands: payload?.activeDemands,
      placement: payload?.placement,
    });
  }
  const createdPayload = created.stdout ? JSON.parse(created.stdout) : null;
  const stateRoot = createdPayload?.created?.stateRoot ?? null;
  output({
    ok: true,
    command: "claim-todo",
    wrote: true,
    claimed: { id: target.id, title: target.title, stateRoot },
    claimMode: explicitId ? "explicit-eligible-todo" : "auto-claimable-todo",
    controllerOutputs: [createdPayload].filter(Boolean),
    forbiddenConclusions: [
      "claim-todo-is-dispatch",
      "claim-todo-is-acceptance",
      "controller-claim-bypasses-per-demand-confirmation",
    ],
    agentNext: "Demand created from the TODO row; confirm dispatch as a separate step. No dispatch, delivery, or acceptance was performed.",
  }, [
    `Claimed TODO ${target.id}`,
    `State root: ${stateRoot ?? "(see create-demand output)"}`,
    "Init-only: no dispatch, delivery, automation loop, or evidence acceptance was performed.",
  ]);
}

function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(helpText);
    return;
  }
  if (command === "create-demand") {
    commandCreateDemand();
    return;
  }
  if (command === "claim-todo") {
    commandClaimTodo();
    return;
  }
  fail(`Unknown wakeflow-demand-sequence command: ${command}\n\n${helpText}`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
