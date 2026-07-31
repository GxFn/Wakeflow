#!/usr/bin/env node

// Host-neutral complete Pod lifecycle.
//
// Wakeflow plans logical windows, records host receipts, verifies exact
// bindings, and tracks logical close. It never creates, removes, adopts, or
// prunes a Git worktree/branch and never writes a dynamic repository overlay.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  controllerEventStateAlignment,
  readControllerEventsStrict,
} from "./lib/wakeflow-controller-events.mjs";
import {
  durableWorkspaceConfigPath,
  loadDurableWorkspaceConfig,
  resolveWorkspaceRoot,
  workspaceLedgerPaths,
} from "./lib/wakeflow-config.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import {
  POD_BINDING_KIND,
  POD_MANIFEST_KIND,
  POD_OPERATION_KIND,
  POD_TEST_ACCESS_PLAN_KIND,
  POD_TEST_ACCESS_RECEIPT_KIND,
  contentDigest,
  correlationId,
  createPodRuntime,
} from "./lib/wakeflow-pod-runtime.mjs";
import { stableArtifactPart } from "./lib/wakeflow-artifact-identity.mjs";
import {
  WakeflowStateLockTimeoutError,
  withFileLock,
  withStateRootLock,
} from "./lib/wakeflow-state-lock.mjs";
import {
  commitStateTransition,
  recoverPendingStateTransition,
} from "./lib/wakeflow-state-transition.mjs";

const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "list";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const workspaceRoot = resolveWorkspaceRoot(options, process.cwd());
const stateDir = path.resolve(
  workspaceRoot,
  getValue("--state-dir", ".wakeflow-local/wakeflow-delivery"),
);
const json = hasFlag("--json");
const write = hasFlag("--write");
const currentHost = hostProfile.hostId || hostProfile.runtime.hostDirName;

const helpText = `
Host-managed complete Pod lifecycle

Usage:
  node scripts/wakeflow-pod.mjs open --mode create --request-json '<json>' [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs open --mode create --request-file <file> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs open --mode resume --request-json '<json>' [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-materialization --attempt-json '<json>' [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-materialization --attempt-file <file> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs bind --receipt-json '<json>' [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs bind --receipt-file <file> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs prepare-design-request --request-json '<json>' [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs prepare-design-request --request-file <file> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-design-handoff --handoff-json '<json>' [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-design-handoff --handoff-file <file> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs prepare-test-access --demand-key <key> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-test-access --receipt-json '<json>' [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-test-access --receipt-file <file> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs close --demand-key <key> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-close-receipt --receipt-json '<json>' [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs record-close-receipt --receipt-file <file> [--write] [--root <workspace>] [--json]
  node scripts/wakeflow-pod.mjs list [--root <workspace>] [--json]

Mutating commands are dry-run by default. Pass --write only after reviewing the
complete plan/preflight output. Wakeflow never performs Git worktree or branch
mutation; Codex/Claude Code owns all physical host resources.
`.trim();

const PHASES = new Set([
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
const CONTROL_ROLES = new Set(["controller", "design", "test"]);
const DESIGN_REQUEST_TYPES = new Set(["initial-design", "supplement", "redesign"]);
const MATERIALIZATION_STATUSES = new Set(["creating", "pending", "finalized", "failed"]);
const TERMINAL_DEMAND_STATES = new Set(["completed", "archived", "cancelled"]);
const SESSION_CLOSE_STATUSES = new Set(["archived", "closed", "handed-off", "not-found"]);
const WORKTREE_CLOSE_STATUSES = new Set(["removed", "retained", "not-applicable", "unknown"]);
const TEST_ACCESS_CAPABILITIES = new Set([
  "direct-multi-root",
  "unsupported",
  "per-repo-executor-unavailable",
]);
const TEST_ACCESS_BLOCK_REASONS = new Set([
  "direct-multi-root-unsupported",
  "access-probe-failed",
  "per-repo-executor-unavailable",
]);

class CliExit extends Error {}

function hasFlag(name) {
  return options.includes(name);
}

function getValue(name, fallback = null) {
  const equal = options.find((argument) => argument.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
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

function fail(message, details = {}) {
  const payload = {
    ok: false,
    scriptComplete: true,
    command,
    error: message,
    ...details,
  };
  if (json) console.error(JSON.stringify(payload, null, 2));
  else console.error(`wakeflow-pod: ${message}`);
  process.exitCode = 1;
  throw new CliExit(message);
}

function output(payload, textLines = []) {
  const complete = {
    ok: true,
    scriptComplete: true,
    command,
    wrote: write && command !== "list",
    ...payload,
  };
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
  if (complete.agentNext) console.log(`Agent next: ${complete.agentNext}`);
}

function readJsonObjectText(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(`Invalid ${label}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
  return value;
}

function structuredInput({ jsonFlag, fileFlag, label }) {
  const jsonValue = getValue(jsonFlag);
  const fileValue = getValue(fileFlag);
  if (Boolean(jsonValue) === Boolean(fileValue)) {
    fail(`Provide exactly one of ${jsonFlag} or ${fileFlag}.`);
  }
  if (jsonValue) return readJsonObjectText(jsonValue, label);
  const file = path.isAbsolute(fileValue)
    ? fileValue
    : path.resolve(workspaceRoot, fileValue);
  try {
    if (lstatSync(file).isSymbolicLink()) {
      fail(`${label} file cannot be a symbolic link: ${file}`);
    }
    return readJsonObjectText(readFileSync(file, "utf8"), `${label} file ${file}`);
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fail(`Cannot read ${label} file ${file}: ${error.message}`);
  }
  return null;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function requireNullableObject(value, label) {
  if (value === null || value === undefined) return null;
  return requireObject(value, label);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireStringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  }
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function nowIso() {
  return new Date().toISOString();
}

function slash(value) {
  return String(value).split(path.sep).join("/");
}

function legacySlug(value, fallback = "item") {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function readConfig() {
  const configFile = durableWorkspaceConfigPath({ workspaceRoot, args: options });
  if (!existsSync(configFile)) {
    fail("wakeflow.config.json not found; initialize the workspace first.");
  }
  try {
    return loadDurableWorkspaceConfig({ workspaceRoot, args: options });
  } catch (error) {
    fail(`Cannot read durable Wakeflow config: ${error.message}`);
  }
  return null;
}

function stateRootForDemand(demandKey, config) {
  const explicit = getValue("--state-root");
  if (explicit) {
    const stateRoot = path.isAbsolute(explicit)
      ? path.resolve(explicit)
      : path.resolve(workspaceRoot, explicit);
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    if (!existsSync(stateFile)) fail(`State root is missing wakeflow-state.json: ${stateRoot}`);
    const state = readJsonObjectText(readFileSync(stateFile, "utf8"), "controller state");
    if (state.demandKey !== demandKey) {
      fail(`State root demand ${state.demandKey ?? "(missing)"} does not match ${demandKey}.`);
    }
    return stateRoot;
  }

  const currentDir = workspaceLedgerPaths({
    workspaceRoot,
    args: options,
    config,
  }).workspaceCurrentDir;
  if (!existsSync(currentDir)) {
    fail(`No current demand state directory exists at ${currentDir}.`);
  }
  if (lstatSync(currentDir).isSymbolicLink()) {
    fail(`Current demand state directory cannot be a symbolic link: ${currentDir}`);
  }
  const matches = [];
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".wakeflow-init-")) {
      continue;
    }
    const stateRoot = path.join(currentDir, entry.name);
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    if (!existsSync(stateFile)) continue;
    let state;
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      continue;
    }
    if (state?.demandKey === demandKey) matches.push(stateRoot);
  }
  if (matches.length === 0) {
    fail(`No canonical current state root exists for demand ${demandKey}; create the explicitly authorized isolated demand first.`);
  }
  if (matches.length > 1) {
    fail(`Demand ${demandKey} has multiple current state roots; repair the authority split before Pod provisioning.`);
  }
  return matches[0];
}

function readStateAuthority(stateRoot, { recover = false } = {}) {
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  let state = readJsonObjectText(readFileSync(stateFile, "utf8"), "controller state");
  let events = readControllerEventsStrict(eventsFile);
  const recovery = recoverPendingStateTransition({
    stateRoot,
    state,
    events,
    write: recover,
  });
  if (!recover && recovery.status !== "none") {
    fail(`State root has a pending transition (${recovery.status}); recover it with a writing Wakeflow state command before this dry-run.`);
  }
  if (recover && recovery.status !== "none") {
    state = readJsonObjectText(readFileSync(stateFile, "utf8"), "controller state");
    events = readControllerEventsStrict(eventsFile);
  }
  const alignment = controllerEventStateAlignment(events, state.revision);
  if (alignment.status !== "aligned") {
    fail(`Controller state revision ${state.revision} is not aligned with event revision ${alignment.latestEventRevision}.`);
  }
  return { state, events, stateFile, eventsFile };
}

function accessDemandState(demandKey, config, callback) {
  const stateRoot = stateRootForDemand(demandKey, config);
  const run = () => callback({
    stateRoot,
    ...readStateAuthority(stateRoot, { recover: write }),
  });
  if (!write) return run();
  try {
    return withStateRootLock(stateRoot, run);
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function nextEventId(createdAt, revision, eventType) {
  const stamp = createdAt.replace(/[^0-9]/g, "").slice(0, 17);
  const suffix = createHash("sha256").update(`${eventType}:${revision}`).digest("hex").slice(0, 8);
  return `evt-pod-${stamp}-${revision}-${suffix}`;
}

function commitPodState({
  stateRoot,
  state,
  stateFile,
  eventsFile,
  nextState,
  eventType,
  reason,
  artifacts = [],
}) {
  if (!write) return state;
  const createdAt = nowIso();
  const revision = Number(state.revision ?? 0) + 1;
  const committed = {
    ...nextState,
    revision,
    updatedAt: createdAt,
    projection: nextState.projection
      ? { ...nextState.projection, status: "stale" }
      : nextState.projection,
  };
  const previousPhase = state.podProvisioning?.phase ?? null;
  const nextPhase = committed.podProvisioning?.phase ?? null;
  commitStateTransition({
    stateRoot,
    stateFile,
    eventsFile,
    event: {
      eventId: nextEventId(createdAt, revision, eventType),
      createdAt,
      actor: "controller",
      type: eventType,
      from: previousPhase,
      to: nextPhase,
      reason,
      evidenceRefs: artifacts.map((artifact) => slash(path.relative(stateRoot, artifact.file))),
      allowedWrites: [
        "wakeflow-state.json",
        "controller-events.jsonl",
        ...artifacts.map((artifact) => slash(path.relative(stateRoot, artifact.file))),
      ],
      forbiddenConclusions: [
        "pod-resource-state-is-demand-acceptance",
        "host-receipt-is-product-result",
        "logical-close-proves-physical-worktree-removal",
      ],
      stateRevision: revision,
    },
    nextState: committed,
    jsonArtifacts: artifacts,
    command,
  });
  return committed;
}

function assertPodAuthority(state, demandKey) {
  if (state.demandKey !== demandKey) {
    fail(`Controller state demand ${state.demandKey ?? "(missing)"} does not match ${demandKey}.`);
  }
  const placement = requireObject(state.executionPlacement, "executionPlacement");
  if (placement.mode !== "isolated") {
    fail(`Demand ${demandKey} is assigned to main placement; Pod provisioning requires explicit isolated placement.`);
  }
  if (placement.selection !== "explicit-user-pod") {
    fail(`Demand ${demandKey} lacks executionPlacement.selection=explicit-user-pod.`);
  }
  requireString(placement.authorizationRef, "executionPlacement.authorizationRef");
  const podId = requireString(placement.podId, "executionPlacement.podId");
  if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
    fail(`Demand ${demandKey} is owned by controller host ${state.controllerHost}; current runtime host is ${hostProfile.runtime.hostDirName}.`);
  }
  return {
    podId,
    authorizationRef: placement.authorizationRef,
  };
}

function assertRequestHost(host) {
  const requested = requireString(host, "host");
  if (
    requested !== currentHost
    || hostProfile.runtime.hostDirName !== currentHost
  ) {
    fail(`Pod request host ${requested} must equal current runtime host ${currentHost}; cross-host provisioning is forbidden.`);
  }
  return requested;
}

function repositoryRootFor(config, windowName) {
  const entry = (config.repositories ?? []).find((candidate) => candidate?.windowName === windowName);
  if (!entry) fail(`Repository window is not configured: ${windowName}`);
  const repositoryRoot = path.resolve(workspaceRoot, requireString(entry.path, `repository ${windowName} path`));
  try {
    if (!statSync(repositoryRoot).isDirectory()) {
      fail(`Configured repository root is not a directory: ${repositoryRoot}`);
    }
    return realpathSync(repositoryRoot);
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fail(`Cannot resolve configured repository root ${repositoryRoot}: ${error.message}`);
  }
  return null;
}

function productWindowName(repositoryWindow, podId) {
  return `${repositoryWindow}__${podId}`;
}

function expectedControlRootFor() {
  // A complete Pod has three independent control sessions, not three product
  // checkouts. All of them belong to the saved workspace control project;
  // only product roles resolve separate repository projects/worktrees.
  return realpathSync(workspaceRoot);
}

function entryPrompt({
  role,
  windowName,
  demandKey,
  podId,
  repositoryWindow = null,
  launchCorrelationId,
}) {
  const recoveryMarker = `Wakeflow launch correlation: ${launchCorrelationId}`;
  if (role === "controller") {
    return [
      `You are ${windowName}, the independent Controller for Pod ${podId} and demand ${demandKey}.`,
      recoveryMarker,
      "Perform entry sync only. Bind to this Pod's canonical state root, load wakeflow-controller, and wait for the Design handoff before product dispatch.",
      "Do not read another Pod state root and do not treat host provisioning as acceptance.",
    ].join("\n");
  }
  if (role === "design") {
    return [
      `You are ${windowName}, the independent Design window for Pod ${podId} and demand ${demandKey}.`,
      recoveryMarker,
      "Perform entry sync only. Preserve the original requirement anchors and return a PodDesignHandoffEnvelope to this Pod Controller.",
      "Do not dispatch, accept, create a second demand, or return redesign to the mainline Design window.",
    ].join("\n");
  }
  if (role === "test") {
    return [
      `You are ${windowName}, the independent Test window for Pod ${podId} and demand ${demandKey}.`,
      recoveryMarker,
      "Perform entry sync only. Wait until the Pod Controller has completed functional acceptance and gives an anchored environment test card.",
      "Do not invent test goals, modify product code, or use a main checkout as a fallback.",
    ].join("\n");
  }
  return [
    `You are ${windowName}, the ${repositoryWindow} product window for Pod ${podId} and demand ${demandKey}.`,
    recoveryMarker,
    "Your first turn is identity entry sync only: report actual cwd and Git top-level/common-dir/HEAD, then wait.",
    "Do not write code before the Controller sends one complete task package, and never fall back to a parent project or main checkout.",
  ].join("\n");
}

function hostEntryExtras(operation, context) {
  const extension = hostProfile?.pod?.entryExtras;
  if (typeof extension !== "function") return {};
  const extras = extension(operation, context) ?? {};
  requireObject(extras, "hostProfile.pod.entryExtras result");
  for (const forbidden of [
    "demandKey",
    "podId",
    "windowName",
    "role",
    "repositoryWindow",
    "repositoryRoot",
    "expectedBaseHead",
    "basePolicy",
    "expectedControlRoot",
    "host",
    "environmentIntent",
    "launchCorrelationId",
    "registrationBindingId",
    "stateRootRelative",
    "actualCwd",
    "gitTopLevel",
    "gitCommonDir",
    "branch",
  ]) {
    if (Object.hasOwn(extras, forbidden)) {
      fail(`hostProfile.pod.entryExtras cannot replace canonical field ${forbidden}.`);
    }
  }
  return extras;
}

function buildLaunchOperations({ request, stateRoot, config, podId }) {
  const host = assertRequestHost(request.host);
  const repositories = request.repositories;
  if (!Array.isArray(repositories)) {
    fail("repositories must be an array; use [] when Design has not frozen the landing plan yet.");
  }
  const seen = new Set();
  const productSpecs = repositories.map((raw, index) => {
    const item = requireObject(raw, `repositories[${index}]`);
    const windowName = requireString(item.windowName, `repositories[${index}].windowName`);
    if (seen.has(windowName)) fail(`Repository window is duplicated in the Pod request: ${windowName}`);
    seen.add(windowName);
    const expectedBaseHead = requireString(
      item.expectedBaseHead,
      `repositories[${index}].expectedBaseHead`,
    );
    if (!/^[0-9a-f]{40,64}$/i.test(expectedBaseHead)) {
      fail(`Expected base HEAD for ${windowName} must be a full hexadecimal object id.`);
    }
    const basePolicy = item.basePolicy ?? "local-head";
    if (basePolicy !== "local-head") {
      fail(`Repository ${windowName} uses unsupported basePolicy ${basePolicy}; host-managed Pods require local-head.`);
    }
    const repositoryRoot = repositoryRootFor(config, windowName);
    const observedHead = gitProbe(
      repositoryRoot,
      ["rev-parse", "HEAD"],
      `configured repository HEAD for ${windowName}`,
    );
    if (observedHead !== expectedBaseHead) {
      fail(
        `Expected base HEAD for ${windowName} is ${expectedBaseHead}, but the configured `
        + `main checkout is currently ${observedHead}. Refresh the launch request from the clean local HEAD.`,
      );
    }
    const dirty = gitProbe(
      repositoryRoot,
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      `configured repository status for ${windowName}`,
    );
    if (dirty) {
      fail(
        `Configured repository ${windowName} has uncommitted or untracked changes; `
        + "the default Pod path requires a clean local HEAD.",
      );
    }
    return {
      repositoryWindow: windowName,
      repositoryRoot,
      expectedBaseHead,
      basePolicy,
    };
  }).sort((left, right) => left.repositoryWindow.localeCompare(right.repositoryWindow));

  const definitions = [
    { role: "controller", windowName: `Controller__${podId}` },
    { role: "design", windowName: `Design__${podId}` },
    { role: "test", windowName: `Test__${podId}` },
    ...productSpecs.map((item) => ({
      role: "product",
      windowName: productWindowName(item.repositoryWindow, podId),
      ...item,
    })),
  ];
  const context = { config, workspaceRoot, stateRoot };
  return definitions.map((definition) => {
    const correlationShape = {
      version: 1,
      demandKey: request.demandKey,
      podId,
      host,
      windowName: definition.windowName,
      role: definition.role,
      repositoryWindow: definition.repositoryWindow ?? null,
      expectedBaseHead: definition.expectedBaseHead ?? null,
    };
    const launchCorrelationId = correlationId("pod-launch", correlationShape);
    const operation = {
      demandKey: request.demandKey,
      podId,
      windowName: definition.windowName,
      role: definition.role,
      ...(definition.repositoryWindow ? {
        repositoryWindow: definition.repositoryWindow,
        repositoryRoot: definition.repositoryRoot,
        expectedBaseHead: definition.expectedBaseHead,
        basePolicy: definition.basePolicy,
      } : {
        expectedControlRoot: expectedControlRootFor(),
      }),
      host,
      environmentIntent: definition.role === "product" ? "host-worktree" : "host-local",
      startingStatePolicy: definition.role === "product" ? "head" : "default",
      displayTitle: definition.windowName,
      createPrompt: entryPrompt({
        ...definition,
        demandKey: request.demandKey,
        podId,
        launchCorrelationId,
      }),
      launchCorrelationId,
      registrationBindingId: correlationId("pod-binding", {
        version: 1,
        demandKey: request.demandKey,
        podId,
        host,
        windowName: definition.windowName,
        launchCorrelationId,
      }),
      stateRootRelative: slash(path.relative(workspaceRoot, stateRoot)),
    };
    return {
      ...operation,
      ...hostEntryExtras(operation, context),
    };
  });
}

function operationRecord(intent, existing = null) {
  const digest = contentDigest(intent);
  if (existing) {
    if (
      existing.kind !== POD_OPERATION_KIND
      || existing.operationType !== "launch"
      || existing.operationId !== intent.launchCorrelationId
      || existing.intentDigest !== digest
      || !isDeepStrictEqual(existing.intent, intent)
    ) {
      fail(`Launch operation ${intent.launchCorrelationId} conflicts with its persisted host operation.`);
    }
    return existing;
  }
  const createdAt = nowIso();
  return {
    kind: POD_OPERATION_KIND,
    version: 1,
    operationType: "launch",
    operationId: intent.launchCorrelationId,
    demandKey: intent.demandKey,
    podId: intent.podId,
    host: intent.host,
    windowName: intent.windowName,
    role: intent.role,
    intentDigest: digest,
    intent,
    status: "planned",
    createdAt,
    updatedAt: createdAt,
  };
}

function stateWindowFor(intent, existing = null) {
  return {
    windowName: intent.windowName,
    role: intent.role,
    ...(intent.repositoryWindow ? { repositoryWindow: intent.repositoryWindow } : {}),
    launchCorrelationId: intent.launchCorrelationId,
    status: existing?.status ?? "planned",
  };
}

function commandResume(request) {
  if (write) {
    fail("Pod resume planning is read-only; omit --write/apply and let the host verify or resume the existing sessions.");
  }
  const demandKey = requireString(request.demandKey, "demandKey");
  assertRequestHost(request.host);
  if (Array.isArray(request.repositories) && request.repositories.length > 0) {
    fail("Pod resume reads frozen launch operations; do not supply repositories or new base identities.");
  }
  const config = readConfig();
  return accessDemandState(demandKey, config, ({ stateRoot, state }) => {
    const authority = assertPodAuthority(state, demandKey);
    const runtime = createPodRuntime({
      workspaceRoot,
      stateDir,
      host: currentHost,
      write: false,
    });
    const manifest = runtime.readManifest(authority.podId);
    if (
      !manifest
      || manifest.kind !== POD_MANIFEST_KIND
      || manifest.podId !== authority.podId
      || manifest.demandKey !== demandKey
      || manifest.host !== currentHost
      || manifest.stateRootRelative !== slash(path.relative(workspaceRoot, stateRoot))
      || !Array.isArray(manifest.operationIds)
    ) {
      fail(`Pod ${authority.podId} has no complete host-local manifest to resume.`);
    }
    if (!state.podProvisioning || state.podProvisioning.podId !== authority.podId) {
      fail(`Pod ${authority.podId} has no matching canonical provisioning state.`);
    }
    if (
      ["completed", "archived", "cancelled"].includes(state.state)
      || ["closing", "cancelling", "closed"].includes(state.podProvisioning.phase)
    ) {
      fail(`Pod ${authority.podId} cannot resume while demand=${state.state} and provisioning=${state.podProvisioning.phase}.`);
    }

    const plannedWindows = new Map(
      (state.podProvisioning.windows ?? []).map((item) => [item.launchCorrelationId, item]),
    );
    const pendingWindowNames = [];
    const operations = [];
    for (const operationId of manifest.operationIds) {
      const operation = runtime.readOperation(operationId);
      if (
        !operation
        || operation.kind !== POD_OPERATION_KIND
        || operation.operationType !== "launch"
        || operation.operationId !== operationId
        || operation.host !== currentHost
        || operation.demandKey !== demandKey
        || operation.podId !== authority.podId
        || operation.intentDigest !== contentDigest(operation.intent)
        || operation.intent?.launchCorrelationId !== operationId
        || !operation.intent?.registrationBindingId
      ) {
        fail(`Pod ${authority.podId} has an invalid persisted launch operation ${operationId}.`);
      }
      const planned = plannedWindows.get(operationId);
      if (!planned || planned.windowName !== operation.windowName || planned.role !== operation.role) {
        fail(`Pod state does not match persisted launch operation ${operationId}.`);
      }
      if (operation.status !== "bound" || planned.status !== "bound") {
        pendingWindowNames.push(operation.windowName);
        continue;
      }
      const binding = runtime.readBinding(authority.podId, operation.windowName);
      const registration = registrationFor(operation.windowName);
      if (
        !binding
        || binding.kind !== POD_BINDING_KIND
        || binding.status !== "active"
        || binding.host !== currentHost
        || binding.demandKey !== demandKey
        || binding.podId !== authority.podId
        || binding.windowName !== operation.windowName
        || binding.role !== operation.role
        || binding.launchCorrelationId !== operationId
        || binding.bindingId !== operation.bindingId
        || binding.bindingId !== registration.bindingId
        || binding.receiptDigest !== contentDigest(binding.receipt)
        || binding.handleDigest !== contentDigest({ host: currentHost, handle: registration.threadId })
        || operation.receiptDigest !== binding.receiptDigest
      ) {
        fail(`Pod ${authority.podId} cannot trust the existing binding/registry identity for ${operation.windowName}.`);
      }
      const actualCwd = assertExistingDirectory(binding.receipt.actualCwd, "binding receipt actualCwd");
      let observation = { actualCwd };
      if (operation.role === "product") {
        const repositoryRoot = realpathSync(operation.intent.repositoryRoot);
        const expectedCommonDir = configuredGitCommonDir(repositoryRoot);
        const observed = probeProductGitIdentity(actualCwd);
        const receiptTopLevel = assertExistingDirectory(binding.receipt.gitTopLevel, "binding receipt gitTopLevel");
        const receiptCommonDir = assertExistingDirectory(binding.receipt.gitCommonDir, "binding receipt gitCommonDir");
        if (
          actualCwd === repositoryRoot
          || receiptTopLevel !== actualCwd
          || observed.gitTopLevel !== actualCwd
          || receiptCommonDir !== expectedCommonDir
          || observed.gitCommonDir !== expectedCommonDir
        ) {
          fail(`Pod recovery identity for ${operation.windowName} no longer resolves to its exact independent repository worktree.`);
        }
        observation = {
          ...observation,
          gitTopLevel: observed.gitTopLevel,
          gitCommonDir: observed.gitCommonDir,
          currentHead: observed.head,
          branch: observed.branch,
          detached: observed.detached,
          dirty: Boolean(gitProbe(
            actualCwd,
            ["status", "--porcelain=v1", "--untracked-files=normal"],
            "Pod recovery Git status",
          )),
        };
      } else {
        const expectedControlRoot = assertExistingDirectory(
          operation.intent.expectedControlRoot,
          "expectedControlRoot",
        );
        if (actualCwd !== expectedControlRoot) {
          fail(`Pod recovery control cwd for ${operation.windowName} no longer matches ${expectedControlRoot}.`);
        }
      }
      operations.push({
        demandKey,
        podId: authority.podId,
        windowName: operation.windowName,
        role: operation.role,
        ...(operation.intent.repositoryWindow
          ? {
              repositoryWindow: operation.intent.repositoryWindow,
              repositoryRoot: operation.intent.repositoryRoot,
            }
          : {}),
        host: currentHost,
        environmentIntent: operation.intent.environmentIntent,
        displayTitle: operation.intent.displayTitle || operation.windowName,
        launchCorrelationId: operationId,
        registrationBindingId: operation.intent.registrationBindingId,
        stateRootRelative: operation.intent.stateRootRelative,
        hostAction: "verify-live-or-resume-same-session",
        requiresCoreBind: false,
        recovery: {
          mode: "resume",
          bindingId: binding.bindingId,
          receiptDigest: binding.receiptDigest,
          ...observation,
        },
      });
    }

    return output({
      kind: "WakeflowPodResumePlan",
      mode: "resume",
      demandKey,
      podId: authority.podId,
      host: currentHost,
      phase: state.podProvisioning.phase,
      stateRevision: state.revision,
      operations,
      boundWindowNames: operations.map((item) => item.windowName),
      pendingWindowNames,
      readOnly: true,
      agentNext: pendingWindowNames.length > 0
        ? "Resume only the verified bound windows with their same registered final sessions. Pending windows are not recovery candidates; return to create mode only when the canonical launch plan still authorizes their first materialization."
        : "Ask the host to verify live sessions or resume each exact registered final session at recovery.actualCwd. Do not create, rediscover, or rebind any thread/worktree; current HEAD and dirty state are observations for Agent judgment.",
    });
  });
}

function sameStateProvisioning(left, right) {
  return isDeepStrictEqual(left ?? null, right ?? null);
}

function stringSetEqual(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function readRecordedDesignHandoff(stateRoot, handoffRef) {
  const absolute = path.resolve(stateRoot, requireString(handoffRef, "designHandoffRef"));
  const relative = path.relative(stateRoot, absolute);
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    fail(`Pod Design handoff must stay below its canonical state root: ${handoffRef}`);
  }
  if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) {
    fail(`Recorded Pod Design handoff is missing or unsafe: ${handoffRef}`);
  }
  const handoff = readJsonObjectText(
    readFileSync(absolute, "utf8"),
    "recorded Pod Design handoff",
  );
  const expectedDigest = path.basename(absolute, ".json");
  if (contentDigest(handoff) !== expectedDigest) {
    fail(`Recorded Pod Design handoff content no longer matches its frozen ref: ${handoffRef}`);
  }
  return handoff;
}

function normalizeDesignRequest(value, { demandKey, podId }) {
  const request = requireObject(value, "Pod Design request");
  if (requireString(request.demandKey, "demandKey") !== demandKey) {
    fail(`Pod Design request demandKey must equal ${demandKey}.`);
  }
  if (requireString(request.podId, "podId") !== podId) {
    fail(`Pod Design request podId must equal ${podId}.`);
  }
  const requestType = requireString(request.requestType, "requestType");
  if (!DESIGN_REQUEST_TYPES.has(requestType)) {
    fail("Pod Design request requestType must be initial-design, supplement, or redesign.");
  }
  return {
    demandKey,
    podId,
    requestType,
    originalGoal: requireString(request.originalGoal, "originalGoal"),
    requirementAnchors: requireStringArray(
      request.requirementAnchors,
      "requirementAnchors",
    ),
    codeEvidenceRefs: requireStringArray(
      request.codeEvidenceRefs,
      "codeEvidenceRefs",
    ),
    pausedTargetIdentity: requireNullableObject(
      request.pausedTargetIdentity,
      "pausedTargetIdentity",
    ),
    pausedReviewIdentity: requireNullableObject(
      request.pausedReviewIdentity,
      "pausedReviewIdentity",
    ),
    nonGoals: requireStringArray(request.nonGoals, "nonGoals", { allowEmpty: true }),
    decisionsRequired: requireStringArray(
      request.decisionsRequired,
      "decisionsRequired",
      { allowEmpty: true },
    ),
  };
}

function designRequestArtifact(body) {
  const requestDigest = contentDigest(body);
  return {
    kind: "WakeflowPodDesignRequest",
    version: 1,
    requestId: `pod-design-request-${requestDigest.slice(0, 32)}`,
    requestDigest,
    ...body,
  };
}

function readRecordedDesignRequest(stateRoot, provisioning, manifest) {
  const requestRef = requireString(
    provisioning?.designRequestRef,
    "podProvisioning.designRequestRef",
  );
  const absolute = path.resolve(stateRoot, requestRef);
  const relative = path.relative(stateRoot, absolute);
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    fail(`Pod Design request must stay below its canonical state root: ${requestRef}`);
  }
  if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) {
    fail(`Recorded Pod Design request is missing or unsafe: ${requestRef}`);
  }
  const artifact = readJsonObjectText(
    readFileSync(absolute, "utf8"),
    "recorded Pod Design request",
  );
  const body = normalizeDesignRequest(artifact, {
    demandKey: manifest.demandKey,
    podId: manifest.podId,
  });
  const expected = designRequestArtifact(body);
  const expectedRef = slash(path.join(
    "pod-design-requests",
    `${expected.requestDigest}.json`,
  ));
  if (
    !isDeepStrictEqual(artifact, expected)
    || requestRef !== expectedRef
    || provisioning.designRequestId !== expected.requestId
  ) {
    fail(`Recorded Pod Design request content no longer matches its frozen identity: ${requestRef}`);
  }
  return { artifact, requestRef };
}

function repositoryWindowsFromHandoff(handoff) {
  if (!Array.isArray(handoff?.landingPlan) || handoff.landingPlan.length === 0) {
    fail("Recorded Pod Design handoff has no landingPlan.");
  }
  const windows = handoff.landingPlan.map((item, index) => (
    requireString(
      requireObject(item, `landingPlan[${index}]`).repositoryWindow,
      `landingPlan[${index}].repositoryWindow`,
    )
  ));
  if (new Set(windows).size !== windows.length) {
    fail("Recorded Pod Design handoff landingPlan contains duplicate repository windows.");
  }
  return new Set(windows);
}

function commandOpen() {
  const request = structuredInput({
    jsonFlag: "--request-json",
    fileFlag: "--request-file",
    label: "Pod open request",
  });
  const mode = getValue("--mode", "create");
  if (!new Set(["create", "resume"]).has(mode)) {
    fail("--mode must be create or resume.");
  }
  if (mode === "resume") return commandResume(request);
  const demandKey = requireString(request.demandKey, "demandKey");
  const config = readConfig();
  return accessDemandState(demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    if (TERMINAL_DEMAND_STATES.has(state.state)) {
      fail(`Demand ${demandKey} is ${state.state}; it cannot open a new Pod lifecycle.`);
    }
    const authority = assertPodAuthority(state, demandKey);
    assertRequestHost(request.host);
    const podId = authority.podId;
    if (
      state.podProvisioning?.podId
      && state.podProvisioning.podId !== podId
    ) {
      fail(`State is already provisioned as Pod ${state.podProvisioning.podId}, not ${podId}.`);
    }
    if (
      state.podProvisioning?.host
      && state.podProvisioning.host !== currentHost
    ) {
      fail(`Pod ${podId} is already provisioned by host ${state.podProvisioning.host}.`);
    }
    if (state.podProvisioning?.phase === "closed") {
      fail(`Pod ${podId} is logically closed and cannot be reopened.`);
    }

    const intents = buildLaunchOperations({ request: { ...request, demandKey }, stateRoot, config, podId });
    const requestShape = {
      demandKey,
      podId,
      host: currentHost,
      operations: intents,
    };
    const requestDigest = contentDigest(requestShape);
    const runtime = createPodRuntime({
      workspaceRoot,
      stateDir,
      host: currentHost,
      write,
    });
    const existingManifest = runtime.readManifest(podId);
    if (existingManifest && (
      existingManifest.kind !== POD_MANIFEST_KIND
      || existingManifest.demandKey !== demandKey
      || existingManifest.host !== currentHost
      || !Array.isArray(existingManifest.operationIds)
    )) {
      fail(`Pod ${podId} has an invalid or conflicting launch manifest.`);
    }

    const nextIntentsByCorrelation = new Map(
      intents.map((intent) => [intent.launchCorrelationId, intent]),
    );
    const existingLaunchOperations = (existingManifest?.operationIds ?? []).map((operationId) => {
      const operation = runtime.readOperation(operationId);
      if (
        !operation
        || operation.kind !== POD_OPERATION_KIND
        || operation.operationType !== "launch"
        || operation.operationId !== operationId
      ) {
        fail(`Pod ${podId} is missing persisted launch operation ${operationId}.`);
      }
      const nextIntent = nextIntentsByCorrelation.get(operationId);
      if (!nextIntent) {
        fail(`Pod ${podId} open cannot remove or replace existing launch intent ${operation.windowName}.`);
      }
      operationRecord(nextIntent, operation);
      return operation;
    });
    const existingOperationIds = new Set(
      existingLaunchOperations.map((operation) => operation.operationId),
    );
    const addedIntents = intents.filter(
      (intent) => !existingOperationIds.has(intent.launchCorrelationId),
    );
    const addedProductIntents = addedIntents.filter((intent) => intent.role === "product");
    if (existingManifest && addedProductIntents.length > 0) {
      const handoffRef = state.podProvisioning?.designHandoffRef;
      if (!handoffRef) {
        fail("Product launch intents may be appended only after the Pod Design handoff freezes the landing plan.");
      }
      const handoff = readRecordedDesignHandoff(stateRoot, handoffRef);
      const frozenRepositories = repositoryWindowsFromHandoff(handoff);
      const requestedRepositories = new Set(
        intents
          .filter((intent) => intent.role === "product")
          .map((intent) => intent.repositoryWindow),
      );
      if (!stringSetEqual(requestedRepositories, frozenRepositories)) {
        fail(
          "Reopened Pod product intents must exactly match the repository coverage "
          + "frozen by the recorded Design landingPlan.",
        );
      }
    }
    const records = intents.map((intent) => operationRecord(
      intent,
      runtime.readOperation(intent.launchCorrelationId),
    ));
    const existingWindows = new Map(
      (state.podProvisioning?.windows ?? []).map((item) => [item.launchCorrelationId, item]),
    );
    const windows = intents.map((intent) => stateWindowFor(intent, existingWindows.get(intent.launchCorrelationId)));
    if (state.podProvisioning?.windows?.length > 0) {
      const nextWindowsByCorrelation = new Map(
        windows.map((item) => [item.launchCorrelationId, item]),
      );
      for (const existingWindow of state.podProvisioning.windows) {
        const nextWindow = nextWindowsByCorrelation.get(existingWindow.launchCorrelationId);
        if (!nextWindow || !isDeepStrictEqual(nextWindow, existingWindow)) {
          fail(
            `Pod ${podId} open cannot remove or modify canonical window `
            + `${existingWindow.windowName}.`,
          );
        }
      }
    }

    const phase = state.podProvisioning?.phase ?? "creating-control";
    if (!PHASES.has(phase)) fail(`Pod ${podId} has unsupported provisioning phase ${phase}.`);
    const provisioningWithoutTime = {
      phase,
      podId,
      host: currentHost,
      authorizationRef: authority.authorizationRef,
      windows,
      ...(state.podProvisioning?.designRequestId
        ? { designRequestId: state.podProvisioning.designRequestId }
        : {}),
      ...(state.podProvisioning?.designRequestRef
        ? { designRequestRef: state.podProvisioning.designRequestRef }
        : {}),
      ...(state.podProvisioning?.designHandoffRef
        ? { designHandoffRef: state.podProvisioning.designHandoffRef }
        : {}),
    };
    const existingProvisioningWithoutTime = state.podProvisioning
      ? Object.fromEntries(
          Object.entries(state.podProvisioning)
            .filter(([key]) => key !== "updatedAt"),
        )
      : null;
    const provisioningChanged = !isDeepStrictEqual(
      existingProvisioningWithoutTime,
      provisioningWithoutTime,
    );
    const provisioning = {
      ...provisioningWithoutTime,
      updatedAt: provisioningChanged
        ? nowIso()
        : (state.podProvisioning?.updatedAt ?? nowIso()),
    };
    const stateChanged = (
      state.controllerHost !== hostProfile.runtime.hostDirName
      || provisioningChanged
    );
    const nextState = {
      ...state,
      controllerHost: hostProfile.runtime.hostDirName,
      controllerWindow: `Controller__${podId}`,
      podProvisioning: provisioning,
    };
    const createdAt = existingManifest?.createdAt ?? nowIso();
    let manifest = {
      kind: POD_MANIFEST_KIND,
      version: 1,
      demandKey,
      podId,
      host: currentHost,
      stateRootRelative: slash(path.relative(workspaceRoot, stateRoot)),
      requestDigest,
      repositoryWindows: intents
        .filter((item) => item.role === "product")
        .map((item) => item.repositoryWindow),
      operationIds: intents.map((item) => item.launchCorrelationId),
      lastKnownPhase: phase,
      createdAt,
      updatedAt: nowIso(),
    };
    if (write) {
      for (const record of records) runtime.writeOperation(record);
      runtime.writeManifest(manifest);
    }
    const committedState = stateChanged
      ? commitPodState({
          stateRoot,
          state,
          stateFile,
          eventsFile,
          nextState,
          eventType: "pod.provisioning-planned",
          reason: "host-managed complete Pod launch plan recorded",
        })
      : state;
    manifest = {
      ...manifest,
      lastKnownPhase: committedState.podProvisioning?.phase ?? phase,
      updatedAt: nowIso(),
    };
    if (write) runtime.writeManifest(manifest);

    const statusByCorrelation = new Map(
      (committedState.podProvisioning?.windows ?? windows)
        .map((item) => [item.launchCorrelationId, item.status]),
    );
    const boundWindowNames = intents
      .filter((item) => statusByCorrelation.get(item.launchCorrelationId) === "bound")
      .map((item) => item.windowName);
    const pendingWindowNames = intents
      .filter((item) => statusByCorrelation.get(item.launchCorrelationId) !== "bound")
      .map((item) => item.windowName);
    output({
      kind: "WakeflowPodLaunchPlan",
      mode: "create",
      demandKey,
      podId,
      host: currentHost,
      phase: committedState.podProvisioning?.phase ?? phase,
      stateRevision: committedState.revision,
      operations: intents,
      boundWindowNames,
      pendingWindowNames,
      idempotent: Boolean(existingManifest)
        && addedIntents.length === 0
        && existingManifest.requestDigest === requestDigest
        && !stateChanged,
      agentNext: "Materialize only missing operations with the current host, register each final handle, collect entry-sync identity, then call pod bind. Product windows remain undispatchable until the Design handoff gate and all bindings are complete.",
    });
  });
}

function normalizeMaterializationAttempt(value, operation) {
  const attempt = requireObject(value, "Pod host materialization attempt");
  const launchCorrelationId = requireString(
    attempt.launchCorrelationId,
    "launchCorrelationId",
  );
  if (launchCorrelationId !== operation.operationId) {
    fail(`Materialization attempt does not match launch operation ${operation.operationId}.`);
  }
  const status = requireString(attempt.status, "status");
  if (!MATERIALIZATION_STATUSES.has(status)) {
    fail("Materialization status must be creating, pending, finalized, or failed.");
  }
  if (attempt.host !== currentHost) {
    fail(`Materialization attempt host ${attempt.host ?? "(missing)"} must equal ${currentHost}.`);
  }
  const observedAt = requireString(attempt.observedAt, "observedAt");
  if (!Number.isFinite(Date.parse(observedAt))) {
    fail("Materialization observedAt must be an ISO timestamp.");
  }
  const hostRequestId = typeof attempt.hostRequestId === "string"
    ? attempt.hostRequestId.trim()
    : "";
  if (status === "pending" && !hostRequestId) {
    fail("Pending materialization must include the host's asynchronous request id.");
  }
  if (["creating", "finalized"].includes(status) && hostRequestId) {
    fail(`${status} materialization must not include hostRequestId.`);
  }
  const terminalFailure = attempt.terminalFailure === true;
  const failureReason = typeof attempt.failureReason === "string"
    ? attempt.failureReason.trim()
    : "";
  if (status === "failed" && (!terminalFailure || !failureReason)) {
    fail("Failed materialization must prove terminalFailure=true and include failureReason.");
  }
  if (status !== "failed" && (attempt.terminalFailure !== undefined || failureReason)) {
    fail("terminalFailure/failureReason are valid only for failed materialization.");
  }
  const retryAuthorizationRef = typeof attempt.retryAuthorizationRef === "string"
    ? attempt.retryAuthorizationRef.trim()
    : "";
  if (status !== "creating" && retryAuthorizationRef) {
    fail("retryAuthorizationRef is valid only when restarting a terminally failed attempt.");
  }
  return {
    status,
    observedAt,
    ...(hostRequestId
      ? { hostRequestIdDigest: contentDigest({ host: currentHost, hostRequestId }) }
      : {}),
    ...(status === "failed"
      ? { terminalFailure: true, failureReason }
      : {}),
    ...(retryAuthorizationRef ? { retryAuthorizationRef } : {}),
  };
}

function assertMaterializationTransition(previous, next) {
  const priorStatus = previous?.status ?? null;
  if (priorStatus === null) {
    if (next.status !== "creating") {
      fail("A host materialization attempt must be recorded as creating immediately before the host create call.");
    }
    return;
  }
  if (priorStatus === "creating") {
    if (next.status === "creating") {
      if (!isDeepStrictEqual(previous, next)) {
        fail(
          "This launch correlation already has a creating host attempt. "
          + "Discover the existing session by launchCorrelationId instead of starting again.",
        );
      }
      return;
    }
    if (!["creating", "pending", "finalized", "failed"].includes(next.status)) {
      fail(`Cannot transition materialization from creating to ${next.status}.`);
    }
    return;
  }
  if (priorStatus === "pending") {
    if (!["pending", "finalized", "failed"].includes(next.status)) {
      fail(`Cannot transition materialization from pending to ${next.status}.`);
    }
    if (
      next.status === "pending"
      && previous.hostRequestIdDigest !== next.hostRequestIdDigest
    ) {
      fail("A pending host operation cannot be replaced by another asynchronous request id.");
    }
    return;
  }
  if (priorStatus === "finalized") {
    if (next.status !== "finalized") {
      fail("A finalized host materialization cannot be restarted or replaced.");
    }
    return;
  }
  if (priorStatus === "failed") {
    if (next.status === "failed") return;
    if (next.status === "creating" && next.retryAuthorizationRef) return;
    fail(
      "A terminally failed materialization may restart only with the same "
      + "launchCorrelationId and an explicit retryAuthorizationRef.",
    );
  }
}

function commandRecordMaterialization() {
  const attemptInput = structuredInput({
    jsonFlag: "--attempt-json",
    fileFlag: "--attempt-file",
    label: "Pod host materialization attempt",
  });
  const launchCorrelationId = requireString(
    attemptInput.launchCorrelationId,
    "launchCorrelationId",
  );
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  const recordAttempt = () => {
    const { manifest, operation } = manifestAndLaunchOperationFor(
      runtime,
      launchCorrelationId,
    );
    if (operation.status === "bound" || operation.status === "closed") {
      fail(
        `Launch operation ${launchCorrelationId} is already ${operation.status}; `
        + "host materialization history is immutable after binding.",
      );
    }
    const nextAttempt = normalizeMaterializationAttempt(attemptInput, operation);
    assertMaterializationTransition(operation.materialization, nextAttempt);
    const idempotent = isDeepStrictEqual(operation.materialization ?? null, nextAttempt);
    const nextOperation = idempotent
      ? operation
      : {
          ...operation,
          materialization: nextAttempt,
          updatedAt: nowIso(),
        };
    if (write && !idempotent) runtime.writeOperation(nextOperation);
    output({
      kind: "WakeflowPodMaterializationRecord",
      demandKey: manifest.demandKey,
      podId: manifest.podId,
      windowName: operation.windowName,
      launchCorrelationId,
      status: nextAttempt.status,
      recoveryCorrelationId: launchCorrelationId,
      recoveryMatchPolicy: "exactly-one-final-session",
      idempotent,
      agentNext: nextAttempt.status === "creating"
        ? "Call the host create tool exactly once. If it returns an asynchronous request id, record pending before waiting; never register that temporary id."
        : nextAttempt.status === "pending"
          ? `Use the host profile's bounded discovery protocol to find final sessions matching exact launch correlation ${launchCorrelationId}; finalize only when exactly one matches, and do not call the create tool again.`
          : nextAttempt.status === "finalized"
            ? "Register only the final host session handle, collect entry-sync identity, and bind the verified receipt."
            : "The host proved this attempt terminally failed. Use the host profile's bounded discovery protocol and require exactly one match for the same launch correlation before any explicitly authorized retry.",
    });
  };
  if (!write) return recordAttempt();
  try {
    return withFileLock(
      path.join(runtime.dirs.hostRoot, "pod-operations.lock"),
      recordAttempt,
    );
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function registryFileCandidates(windowName) {
  const registryDir = path.join(
    stateDir,
    "hosts",
    hostProfile.runtime.hostDirName,
    "thread-registry",
  );
  const names = new Set([
    legacySlug(windowName, "item"),
    stableArtifactPart(windowName, { fallback: "item" }),
    // Transitional digest-only artifact names were briefly emitted during the
    // stable-name migration; they remain readable but can never coexist with a
    // second registration for the same logical window.
    contentDigest(windowName).slice(0, 12),
  ]);
  return [...names].map((name) => path.join(registryDir, `${name}.json`));
}

function registrationFor(windowName) {
  const candidates = registryFileCandidates(windowName);
  const registrations = candidates
    .filter((file) => existsSync(file))
    .map((file) => ({
      file,
      registration: readJsonObjectText(
        readFileSync(file, "utf8"),
        `thread registration for ${windowName}`,
      ),
    }))
    .filter(({ registration }) => registration.windowName === windowName);
  if (registrations.length === 0) {
    fail(`Final host handle is not registered for ${windowName}; register it before bind.`);
  }
  if (registrations.length !== 1) {
    fail(`Final host handle for ${windowName} is ambiguous across ${registrations.length} registry files; preserve all evidence and repair the registry before bind/resume.`);
  }
  const registration = registrations[0].registration;
  if (
    registration.kind !== hostProfile.kinds.windowRegistration
    || registration.windowName !== windowName
    || !registration.threadId
    || !registration.bindingId
  ) {
    fail(`Thread registration for ${windowName} is incomplete or belongs to another host/window.`);
  }
  const placeholders = new Set(
    (hostProfile.handleId?.placeholders ?? []).map((item) => String(item).trim().toLowerCase()),
  );
  if (placeholders.has(String(registration.threadId).trim().toLowerCase())) {
    fail(`Thread registration for ${windowName} still contains a placeholder handle.`);
  }
  return registration;
}

function manifestAndLaunchOperationFor(runtime, launchCorrelationId) {
  const matches = runtime.listManifests().filter(({ value }) => (
    value.operationIds?.includes(launchCorrelationId)
  ));
  if (matches.length === 0) fail(`Unknown launchCorrelationId: ${launchCorrelationId}`);
  if (matches.length > 1) fail(`Launch correlation ${launchCorrelationId} appears in multiple Pod manifests.`);
  const manifest = matches[0].value;
  const operation = runtime.readOperation(launchCorrelationId);
  if (
    !operation
    || operation.kind !== POD_OPERATION_KIND
    || operation.operationType !== "launch"
    || operation.operationId !== launchCorrelationId
  ) {
    fail(`Launch operation ${launchCorrelationId} is missing or invalid.`);
  }
  return { manifest, operation };
}

function assertExistingDirectory(candidate, label) {
  const absolute = path.resolve(requireString(candidate, label));
  try {
    if (!statSync(absolute).isDirectory()) fail(`${label} is not a directory: ${absolute}`);
    return realpathSync(absolute);
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fail(`Cannot resolve ${label} ${absolute}: ${error.message}`);
  }
  return null;
}

function configuredGitCommonDir(repositoryRoot) {
  const dotGit = path.join(repositoryRoot, ".git");
  if (!existsSync(dotGit)) fail(`Configured repository has no .git identity: ${repositoryRoot}`);
  const stat = lstatSync(dotGit);
  if (stat.isDirectory()) return realpathSync(dotGit);
  if (!stat.isFile()) fail(`Configured repository .git identity is unsupported: ${dotGit}`);
  const match = readFileSync(dotGit, "utf8").trim().match(/^gitdir:\s*(.+)$/i);
  if (!match) fail(`Configured repository .git file is malformed: ${dotGit}`);
  const gitDir = path.resolve(repositoryRoot, match[1]);
  const commonFile = path.join(gitDir, "commondir");
  if (!existsSync(commonFile)) return realpathSync(gitDir);
  return realpathSync(path.resolve(gitDir, readFileSync(commonFile, "utf8").trim()));
}

function gitProbe(cwd, args, label, { allowDetached = false } = {}) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (allowDetached && result.status === 1) return null;
  if (result.status !== 0) {
    fail(
      `Cannot verify ${label} from actualCwd ${cwd}: `
      + `${String(result.stderr || result.stdout || `git exited ${result.status}`).trim()}`,
    );
  }
  return String(result.stdout).trim();
}

function probeProductGitIdentity(actualCwd) {
  const topLevelRaw = requireString(
    gitProbe(actualCwd, ["rev-parse", "--show-toplevel"], "Git top-level"),
    "verified Git top-level",
  );
  const commonDirRaw = requireString(
    gitProbe(actualCwd, ["rev-parse", "--git-common-dir"], "Git common-dir"),
    "verified Git common-dir",
  );
  const head = requireString(
    gitProbe(actualCwd, ["rev-parse", "HEAD"], "Git HEAD"),
    "verified Git HEAD",
  );
  const branch = gitProbe(
    actualCwd,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    "Git branch",
    { allowDetached: true },
  );
  const commonDirPath = path.isAbsolute(commonDirRaw)
    ? commonDirRaw
    : path.resolve(actualCwd, commonDirRaw);
  return {
    gitTopLevel: realpathSync(topLevelRaw),
    gitCommonDir: realpathSync(commonDirPath),
    head,
    branch,
    detached: branch === null,
  };
}

function validateReceiptIdentity({
  receipt,
  operation,
  manifest,
  config,
  stateRoot,
  runtime,
  registration,
}) {
  if (receipt.windowName !== operation.windowName) {
    fail(`Receipt window ${receipt.windowName ?? "(missing)"} does not match ${operation.windowName}.`);
  }
  if (receipt.host !== currentHost || receipt.host !== manifest.host) {
    fail(`Receipt host ${receipt.host ?? "(missing)"} does not match current Pod host ${currentHost}.`);
  }
  if (receipt.handleRegistered !== true || receipt.handleKind !== "final") {
    fail("Receipt must confirm handleRegistered=true and handleKind=final; async client ids cannot bind.");
  }
  const bindingId = requireString(receipt.bindingId, "bindingId");
  if (bindingId !== operation.intent.registrationBindingId) {
    fail(
      `Receipt bindingId for ${operation.windowName} must reuse the deterministic `
      + "registrationBindingId from its launch intent.",
    );
  }
  if (registration.bindingId !== bindingId) {
    fail(`Receipt bindingId does not match the final host registry for ${operation.windowName}.`);
  }
  const expectedStateRoot = slash(path.relative(workspaceRoot, stateRoot));
  if (receipt.stateRootRelative !== expectedStateRoot) {
    fail(`Receipt stateRootRelative ${receipt.stateRootRelative ?? "(missing)"} does not match ${expectedStateRoot}.`);
  }
  if (!Number.isFinite(Date.parse(receipt.createdAt))) {
    fail("Receipt createdAt must be an ISO timestamp.");
  }
  const actualCwd = assertExistingDirectory(receipt.actualCwd, "actualCwd");
  const handleDigest = contentDigest({
    host: currentHost,
    handle: registration.threadId,
  });
  for (const { value: binding } of runtime.listBindings()) {
    const sameLogicalBinding = (
      binding.podId === manifest.podId
      && binding.windowName === operation.windowName
    );
    if (sameLogicalBinding) continue;
    if (binding.bindingId === bindingId || binding.handleDigest === handleDigest) {
      fail(
        `Host windows ${binding.windowName} and ${operation.windowName} do not `
        + "have distinct binding/final-session identities.",
      );
    }
    if (
      operation.role === "product"
      && binding.role === "product"
      && !(
        binding.status === "closed"
        && binding.closeReceipt?.worktreeStatus === "removed"
      )
      && binding.receipt?.actualCwd
      && (() => {
        try {
          return realpathSync(binding.receipt.actualCwd) === actualCwd;
        } catch {
          return path.resolve(binding.receipt.actualCwd) === actualCwd;
        }
      })()
    ) {
      fail(
        `Product windows ${binding.windowName} and ${operation.windowName} `
        + "cannot share the same host worktree cwd.",
      );
    }
    if (
      operation.role === "product"
      && binding.role === "product"
      && binding.demandKey === manifest.demandKey
      && binding.repositoryWindow === operation.intent.repositoryWindow
      && binding.status === "active"
    ) {
      fail(`Demand ${manifest.demandKey} already has an active binding for repository ${operation.intent.repositoryWindow}.`);
    }
  }

  const verified = { actualCwd, handleDigest };
  if (operation.role !== "product") {
    const expectedControlRoot = assertExistingDirectory(
      operation.intent.expectedControlRoot,
      "expectedControlRoot",
    );
    if (actualCwd !== expectedControlRoot) {
      fail(
        `Control receipt actualCwd for ${operation.windowName} must exactly match `
        + `its launch intent expectedControlRoot ${expectedControlRoot}.`,
      );
    }
    return verified;
  }
  if (receipt.mainCheckout !== false) {
    fail(`Product receipt for ${operation.windowName} points at a main checkout or does not prove mainCheckout=false.`);
  }
  const gitTopLevel = assertExistingDirectory(receipt.gitTopLevel, "gitTopLevel");
  if (gitTopLevel !== actualCwd) {
    fail(`Product gitTopLevel must equal actualCwd for ${operation.windowName}.`);
  }
  const repositoryRoot = realpathSync(operation.intent.repositoryRoot);
  if (actualCwd === repositoryRoot) {
    fail(`Product window ${operation.windowName} cannot bind the repository main checkout.`);
  }
  const gitCommonDir = assertExistingDirectory(receipt.gitCommonDir, "gitCommonDir");
  const expectedCommonDir = configuredGitCommonDir(repositoryRoot);
  if (gitCommonDir !== expectedCommonDir) {
    fail(`Product gitCommonDir for ${operation.windowName} does not belong to ${operation.intent.repositoryWindow}.`);
  }
  const observed = probeProductGitIdentity(actualCwd);
  if (observed.gitTopLevel !== gitTopLevel) {
    fail(`Product gitTopLevel receipt for ${operation.windowName} does not match Git observed from actualCwd.`);
  }
  if (observed.gitCommonDir !== gitCommonDir) {
    fail(`Product gitCommonDir receipt for ${operation.windowName} does not match Git observed from actualCwd.`);
  }
  if (observed.head !== receipt.head) {
    fail(`Product HEAD receipt for ${operation.windowName} does not match Git observed from actualCwd.`);
  }
  if (receipt.head !== operation.intent.expectedBaseHead) {
    fail(`Product HEAD for ${operation.windowName} does not match expectedBaseHead.`);
  }
  if (typeof receipt.detached !== "boolean") {
    fail(`Product receipt for ${operation.windowName} must report detached as a boolean.`);
  }
  if (!(receipt.branch === null || typeof receipt.branch === "string")) {
    fail(`Product receipt for ${operation.windowName} must report branch as a string or null.`);
  }
  if (receipt.detached !== observed.detached || receipt.branch !== observed.branch) {
    fail(`Product branch/detached receipt for ${operation.windowName} does not match Git observed from actualCwd.`);
  }
  return { ...verified, gitTopLevel, gitCommonDir };
}

function phaseAfterBindings(provisioning) {
  const controls = provisioning.windows.filter((item) => CONTROL_ROLES.has(item.role));
  const products = provisioning.windows.filter((item) => item.role === "product");
  const controlsReady = controls.length === 3 && controls.every((item) => item.status === "bound");
  const productsReady = products.length > 0 && products.every((item) => item.status === "bound");
  if (!controlsReady) return "creating-control";
  if (provisioning.designRequestRef && !provisioning.designHandoffRef) return "designing";
  if (!provisioning.designHandoffRef) return "control-ready";
  return productsReady ? "execution-ready" : "creating-products";
}

function commandBind() {
  const receipt = structuredInput({
    jsonFlag: "--receipt-json",
    fileFlag: "--receipt-file",
    label: "Pod provisioning receipt",
  });
  const launchCorrelationId = requireString(
    receipt.launchCorrelationId,
    "launchCorrelationId",
  );
  assertRequestHost(receipt.host);
  const config = readConfig();
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  const { manifest, operation } = manifestAndLaunchOperationFor(runtime, launchCorrelationId);
  const bindWithStateAuthority = () => accessDemandState(manifest.demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    const authority = assertPodAuthority(state, manifest.demandKey);
    if (authority.podId !== manifest.podId) {
      fail(`Pod manifest ${manifest.podId} does not match canonical Pod ${authority.podId}.`);
    }
    if (!state.podProvisioning || ["closing", "closed", "cancelling"].includes(state.podProvisioning.phase)) {
      fail(`Pod ${manifest.podId} is not accepting provisioning receipts in phase ${state.podProvisioning?.phase ?? "(missing)"}.`);
    }
    const registration = registrationFor(operation.windowName);
    const verified = validateReceiptIdentity({
      receipt,
      operation,
      manifest,
      config,
      stateRoot,
      runtime,
      registration,
    });
    const normalizedReceipt = {
      ...receipt,
      actualCwd: verified.actualCwd,
      ...(verified.gitTopLevel ? { gitTopLevel: verified.gitTopLevel } : {}),
      ...(verified.gitCommonDir ? { gitCommonDir: verified.gitCommonDir } : {}),
    };
    const receiptDigest = contentDigest(normalizedReceipt);
    const existingBinding = runtime.readBinding(manifest.podId, operation.windowName);
    if (existingBinding && (
      existingBinding.kind !== POD_BINDING_KIND
      || existingBinding.receiptDigest !== receiptDigest
      || existingBinding.handleDigest !== verified.handleDigest
      || existingBinding.bindingId !== receipt.bindingId
    )) {
      fail(`Binding for ${operation.windowName} already exists with different host facts.`);
    }
    const createdAt = existingBinding?.createdAt ?? nowIso();
    const binding = existingBinding ?? {
      kind: POD_BINDING_KIND,
      version: 1,
      demandKey: manifest.demandKey,
      podId: manifest.podId,
      host: currentHost,
      windowName: operation.windowName,
      role: operation.role,
      ...(operation.intent.repositoryWindow
        ? { repositoryWindow: operation.intent.repositoryWindow }
        : {}),
      launchCorrelationId,
      bindingId: receipt.bindingId,
      handleDigest: verified.handleDigest,
      receiptDigest,
      receipt: normalizedReceipt,
      status: "active",
      createdAt,
      updatedAt: createdAt,
    };
    const windows = state.podProvisioning.windows.map((item) => (
      item.launchCorrelationId === launchCorrelationId
        ? { ...item, status: "bound" }
        : item
    ));
    if (!windows.some((item) => item.launchCorrelationId === launchCorrelationId)) {
      fail(`Canonical Pod state has no planned window for ${launchCorrelationId}.`);
    }
    const nextProvisioning = {
      ...state.podProvisioning,
      windows,
    };
    nextProvisioning.phase = phaseAfterBindings(nextProvisioning);
    nextProvisioning.updatedAt = nowIso();
    const alreadyStateBound = state.podProvisioning.windows
      .some((item) => item.launchCorrelationId === launchCorrelationId && item.status === "bound");
    const nextState = {
      ...state,
      ...(nextProvisioning.phase === "execution-ready" && state.state === "intake"
        ? { state: "planned", stateReason: "pod-provisioning-execution-ready" }
        : {}),
      podProvisioning: nextProvisioning,
    };
    if (write) {
      runtime.writeBinding(binding);
      runtime.writeOperation({
        ...operation,
        status: "bound",
        bindingId: receipt.bindingId,
        receiptDigest,
        updatedAt: nowIso(),
      });
    }
    const stateChanged = !sameStateProvisioning(state.podProvisioning, nextProvisioning)
      || nextState.state !== state.state;
    const committedState = stateChanged
      ? commitPodState({
          stateRoot,
          state,
          stateFile,
          eventsFile,
          nextState,
          eventType: "pod.window-bound",
          reason: `host provisioning receipt verified for ${operation.windowName}`,
        })
      : state;
    const committedProvisioning = write
      ? (committedState.podProvisioning ?? nextProvisioning)
      : nextProvisioning;
    if (write) {
      runtime.writeManifest({
        ...manifest,
        lastKnownPhase: committedProvisioning.phase,
        updatedAt: nowIso(),
      });
    }
    output({
      kind: "WakeflowPodBindingResult",
      demandKey: manifest.demandKey,
      podId: manifest.podId,
      windowName: operation.windowName,
      bindingId: receipt.bindingId,
      status: "bound",
      phase: committedProvisioning.phase,
      stateRevision: committedState.revision,
      boundWindowNames: committedProvisioning.windows
        .filter((item) => item.status === "bound")
        .map((item) => item.windowName),
      pendingWindowNames: committedProvisioning.windows
        .filter((item) => item.status !== "bound")
        .map((item) => item.windowName),
      idempotent: Boolean(existingBinding) && alreadyStateBound,
      agentNext: committedProvisioning.phase === "control-ready"
        ? "Send the anchored PodDesignRequest to Design__pod and record its handoff; product bindings cannot make the Pod execution-ready by themselves."
        : committedProvisioning.phase === "execution-ready"
          ? "All exact bindings and the Design handoff gate are complete; the Pod Controller may now create and dispatch product task packages."
          : "Continue materializing or binding only the missing Pod windows.",
    });
  });
  if (!write) return bindWithStateAuthority();
  try {
    // Final registry identity and immutable Pod binding are one transaction:
    // registration cannot swap the handle between bind validation and write.
    return withFileLock(
      path.join(runtime.dirs.hostRoot, "thread-registry.lock"),
      () => withFileLock(
        path.join(runtime.dirs.hostRoot, "pod-bindings.lock"),
        bindWithStateAuthority,
      ),
    );
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function validateDesignHandoff(handoff, manifest, config, designRequest) {
  if (handoff.demandKey !== manifest.demandKey || handoff.podId !== manifest.podId) {
    fail("Design handoff demand/pod identity does not match the Pod manifest.");
  }
  if (
    handoff.designRequestId !== designRequest.requestId
    || handoff.designRequestRef !== designRequest.requestRef
    || handoff.designRequestDigest !== designRequest.requestDigest
  ) {
    fail("Design handoff must cite the exact frozen Design request id/ref/digest.");
  }
  if (handoff.requestType !== designRequest.requestType) {
    fail(`Design handoff requestType must match ${designRequest.requestType}.`);
  }
  if (handoff.preservesOriginalGoal !== true) {
    fail("Design handoff must explicitly preserve the original goal.");
  }
  const requirementAnchors = requireStringArray(
    handoff.requirementAnchors,
    "requirementAnchors",
  );
  if (!isDeepStrictEqual(requirementAnchors, designRequest.requirementAnchors)) {
    fail("Design handoff requirementAnchors must exactly match the frozen Design request.");
  }
  requireStringArray(handoff.evidenceRefs, "evidenceRefs");
  requireStringArray(handoff.userConfirmationRefs, "userConfirmationRefs", { allowEmpty: true });
  requireString(handoff.designIntent, "designIntent");
  requireString(handoff.testDecision, "testDecision");
  requireObject(handoff.environmentSpec, "environmentSpec");
  if (!Array.isArray(handoff.landingPlan) || handoff.landingPlan.length === 0) {
    fail("Design handoff landingPlan must be a non-empty array.");
  }
  const plannedRepos = handoff.landingPlan.map((item, index) => (
    requireString(
      requireObject(item, `landingPlan[${index}]`).repositoryWindow,
      `landingPlan[${index}].repositoryWindow`,
    )
  ));
  if (new Set(plannedRepos).size !== plannedRepos.length) {
    fail("Design handoff landingPlan cannot contain duplicate repository windows.");
  }
  const configuredRepositories = new Set(
    (Array.isArray(config.repositories) ? config.repositories : [])
      .map((item) => item?.windowName)
      .filter(Boolean),
  );
  const unknown = plannedRepos.filter((item) => !configuredRepositories.has(item));
  if (unknown.length > 0) {
    fail(`Design handoff landingPlan contains unconfigured repositories: ${unknown.join(", ")}.`);
  }
  const expected = [...manifest.repositoryWindows].sort();
  if (
    expected.length > 0
    && !isDeepStrictEqual([...plannedRepos].sort(), expected)
  ) {
    fail(`Design handoff landingPlan must cover exactly: ${expected.join(", ")}.`);
  }
}

function commandPrepareDesignRequest() {
  const requestInput = structuredInput({
    jsonFlag: "--request-json",
    fileFlag: "--request-file",
    label: "Pod Design request",
  });
  const demandKey = requireString(requestInput.demandKey, "demandKey");
  const config = readConfig();
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  return accessDemandState(demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    const authority = assertPodAuthority(state, demandKey);
    const manifest = runtime.readManifest(authority.podId);
    if (!manifest) fail(`Pod ${authority.podId} has no launch manifest.`);
    const requestBody = normalizeDesignRequest(requestInput, {
      demandKey,
      podId: manifest.podId,
    });
    const artifact = designRequestArtifact(requestBody);
    const requestRef = slash(path.join(
      "pod-design-requests",
      `${artifact.requestDigest}.json`,
    ));
    const existingRef = state.podProvisioning?.designRequestRef ?? null;
    const existingId = state.podProvisioning?.designRequestId ?? null;
    if (Boolean(existingRef) !== Boolean(existingId)) {
      fail("Canonical Pod state has an incomplete Design request identity.");
    }
    if (existingRef) {
      const existing = readRecordedDesignRequest(
        stateRoot,
        state.podProvisioning,
        manifest,
      );
      if (
        existing.requestRef !== requestRef
        || existing.artifact.requestId !== artifact.requestId
        || !isDeepStrictEqual(existing.artifact, artifact)
      ) {
        fail(
          `Pod already records immutable Design request ${existing.artifact.requestId}; `
          + "a different request cannot replace it.",
        );
      }
      output({
        kind: "WakeflowPodDesignRequestRecord",
        demandKey,
        podId: manifest.podId,
        requestId: artifact.requestId,
        requestRef,
        requestDigest: artifact.requestDigest,
        requestType: artifact.requestType,
        phase: state.podProvisioning.phase,
        stateRevision: state.revision,
        idempotent: true,
        agentNext: "Send this exact anchored request to Design__pod; do not create a target result or global TODO.",
      });
      return;
    }
    const controls = (state.podProvisioning?.windows ?? [])
      .filter((item) => CONTROL_ROLES.has(item.role));
    const controlRoles = new Set(controls.map((item) => item.role));
    const productsBound = (state.podProvisioning?.windows ?? [])
      .some((item) => item.role === "product" && item.status === "bound");
    if (
      state.podProvisioning?.phase !== "control-ready"
      || controls.length !== 3
      || controlRoles.size !== 3
      || !controls.every((item) => item.status === "bound")
      || productsBound
    ) {
      fail(
        "Pod Design request requires phase control-ready, exactly one bound "
        + "Controller/Design/Test session, and no bound product session.",
      );
    }
    const nextProvisioning = {
      ...state.podProvisioning,
      phase: "designing",
      designRequestId: artifact.requestId,
      designRequestRef: requestRef,
      updatedAt: nowIso(),
    };
    const committedState = commitPodState({
      stateRoot,
      state,
      stateFile,
      eventsFile,
      nextState: { ...state, podProvisioning: nextProvisioning },
      eventType: "pod.design-request-prepared",
      reason: `Pod Design request ${artifact.requestType} prepared by Controller`,
      artifacts: [{
        file: path.join(stateRoot, requestRef),
        value: artifact,
      }],
    });
    if (write) {
      runtime.writeManifest({
        ...manifest,
        lastKnownPhase: committedState.podProvisioning.phase,
        updatedAt: nowIso(),
      });
    }
    output({
      kind: "WakeflowPodDesignRequestRecord",
      demandKey,
      podId: manifest.podId,
      requestId: artifact.requestId,
      requestRef,
      requestDigest: artifact.requestDigest,
      requestType: artifact.requestType,
      phase: write
        ? (committedState.podProvisioning?.phase ?? "designing")
        : "designing",
      stateRevision: committedState.revision,
      idempotent: false,
      agentNext: "Send this exact anchored request to Design__pod; do not create a target result or global TODO.",
    });
  });
}

function commandRecordDesignHandoff() {
  const handoff = structuredInput({
    jsonFlag: "--handoff-json",
    fileFlag: "--handoff-file",
    label: "Pod Design handoff",
  });
  const demandKey = requireString(handoff.demandKey, "demandKey");
  assertRequestHost(currentHost);
  const config = readConfig();
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  return accessDemandState(demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    const authority = assertPodAuthority(state, demandKey);
    const manifest = runtime.readManifest(authority.podId);
    if (!manifest) fail(`Pod ${authority.podId} has no launch manifest.`);
    if (
      !state.podProvisioning?.designRequestId
      || !state.podProvisioning?.designRequestRef
    ) {
      fail("Design handoff requires a prepared immutable Pod Design request.");
    }
    const recordedRequest = readRecordedDesignRequest(
      stateRoot,
      state.podProvisioning,
      manifest,
    );
    validateDesignHandoff(handoff, manifest, config, {
      ...recordedRequest.artifact,
      requestRef: recordedRequest.requestRef,
    });
    const controls = state.podProvisioning.windows
      .filter((item) => CONTROL_ROLES.has(item.role));
    const controlsReady = controls.length === 3
      && new Set(controls.map((item) => item.role)).size === 3
      && controls.every((item) => item.status === "bound");
    if (
      !controlsReady
      || !["designing", "creating-products", "execution-ready"].includes(state.podProvisioning?.phase)
    ) {
      fail(`Design handoff requires all three control bindings and phase designing; current phase is ${state.podProvisioning?.phase ?? "(missing)"}.`);
    }
    const digest = contentDigest(handoff);
    const handoffRef = slash(path.join("pod-design-handoffs", `${digest}.json`));
    const existingRef = state.podProvisioning.designHandoffRef ?? null;
    if (existingRef && existingRef !== handoffRef) {
      fail(`Pod Design request ${handoff.designRequestId} already records immutable handoff ${existingRef}.`);
    }
    if (existingRef === handoffRef) {
      readRecordedDesignHandoff(stateRoot, handoffRef);
      output({
        kind: "WakeflowPodDesignHandoffRecord",
        demandKey,
        podId: manifest.podId,
        handoffRef,
        phase: state.podProvisioning.phase,
        stateRevision: state.revision,
        productWindowNames: state.podProvisioning.windows
          .filter((item) => item.role === "product")
          .map((item) => item.windowName),
        pendingProductWindowNames: state.podProvisioning.windows
          .filter((item) => item.role === "product" && item.status !== "bound")
          .map((item) => item.windowName),
        idempotent: true,
      });
      return;
    }
    const nextProvisioning = {
      ...state.podProvisioning,
      designHandoffRef: handoffRef,
    };
    nextProvisioning.phase = phaseAfterBindings(nextProvisioning);
    nextProvisioning.updatedAt = nowIso();
    const nextState = {
      ...state,
      ...(nextProvisioning.phase === "execution-ready" && state.state === "intake"
        ? { state: "planned", stateReason: "pod-provisioning-execution-ready" }
        : {}),
      podProvisioning: nextProvisioning,
    };
    const committedState = commitPodState({
      stateRoot,
      state,
      stateFile,
      eventsFile,
      nextState,
      eventType: "pod.design-handoff-recorded",
      reason: `Pod Design handoff ${handoff.requestType} recorded by Controller`,
      artifacts: [{
        file: path.join(stateRoot, handoffRef),
        value: handoff,
      }],
    });
    if (write) {
      runtime.writeManifest({
        ...manifest,
        lastKnownPhase: committedState.podProvisioning.phase,
        updatedAt: nowIso(),
      });
    }
    output({
      kind: "WakeflowPodDesignHandoffRecord",
      demandKey,
      podId: manifest.podId,
      handoffRef,
      phase: write
        ? (committedState.podProvisioning?.phase ?? nextProvisioning.phase)
        : nextProvisioning.phase,
      stateRevision: committedState.revision,
      productWindowNames: nextProvisioning.windows
        .filter((item) => item.role === "product")
        .map((item) => item.windowName),
      pendingProductWindowNames: nextProvisioning.windows
        .filter((item) => item.role === "product" && item.status !== "bound")
        .map((item) => item.windowName),
      idempotent: false,
      agentNext: nextProvisioning.phase === "execution-ready"
        ? "All product bindings already passed; the Controller may now dispatch the frozen landing plan."
        : "Materialize and bind only the product windows in this recorded landing plan.",
    });
  });
}

function privateExistingDirectory(candidate, label) {
  if (typeof candidate !== "string" || !candidate.trim() || !path.isAbsolute(candidate)) {
    fail(`${label} is unavailable or is not an absolute host-local directory.`);
  }
  try {
    const resolved = path.resolve(candidate);
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`${label} is unavailable or is not a stable real directory.`);
    }
    const real = realpathSync(resolved);
    if (real !== resolved) {
      fail(`${label} is unavailable or is not a stable real directory.`);
    }
    return real;
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fail(`${label} is unavailable or is not a stable real directory.`);
  }
  return null;
}

function testAccessBindingSet({ state, runtime, manifest }) {
  if (state.podProvisioning?.phase !== "execution-ready") {
    fail(
      `Pod Test access probe requires phase execution-ready; current phase is `
      + `${state.podProvisioning?.phase ?? "(missing)"}.`,
    );
  }
  if (!state.podProvisioning.designHandoffRef) {
    fail("Pod Test access probe requires the recorded Design handoff.");
  }
  const planned = state.podProvisioning.windows ?? [];
  const testWindows = planned.filter((item) => item.role === "test");
  const productWindows = planned.filter((item) => item.role === "product");
  if (testWindows.length !== 1 || testWindows[0].status !== "bound") {
    fail("Pod Test access probe requires exactly one verified bound Test window.");
  }
  if (
    productWindows.length === 0
    || productWindows.some((item) => item.status !== "bound")
  ) {
    fail("Pod Test access probe requires every frozen product window to be bound.");
  }

  function activeBinding(plannedWindow) {
    const binding = runtime.readBinding(manifest.podId, plannedWindow.windowName);
    const operation = runtime.readOperation(plannedWindow.launchCorrelationId);
    if (
      !binding
      || binding.kind !== POD_BINDING_KIND
      || binding.status !== "active"
      || binding.host !== currentHost
      || binding.demandKey !== manifest.demandKey
      || binding.podId !== manifest.podId
      || binding.windowName !== plannedWindow.windowName
      || binding.role !== plannedWindow.role
      || binding.launchCorrelationId !== plannedWindow.launchCorrelationId
      || !binding.bindingId
      || !binding.receipt
      || binding.receiptDigest !== contentDigest(binding.receipt)
      || !operation
      || operation.kind !== POD_OPERATION_KIND
      || operation.operationType !== "launch"
      || operation.status !== "bound"
      || operation.bindingId !== binding.bindingId
      || operation.receiptDigest !== binding.receiptDigest
      || operation.intent?.registrationBindingId !== binding.bindingId
    ) {
      fail(
        `Pod Test access probe cannot trust the active binding for `
        + `${plannedWindow.windowName}.`,
      );
    }
    return { binding, operation };
  }

  const test = activeBinding(testWindows[0]);
  const products = productWindows
    .map((plannedWindow) => {
      const value = activeBinding(plannedWindow);
      const actualCwd = privateExistingDirectory(
        value.binding.receipt.actualCwd,
        `product binding actualCwd for ${plannedWindow.windowName}`,
      );
      const gitTopLevel = privateExistingDirectory(
        value.binding.receipt.gitTopLevel,
        `product binding gitTopLevel for ${plannedWindow.windowName}`,
      );
      if (
        actualCwd !== gitTopLevel
        || value.binding.receipt.mainCheckout !== false
      ) {
        fail(
          `Pod Test access target ${plannedWindow.windowName} is not a `
          + "verified host worktree.",
        );
      }
      return {
        plannedWindow,
        binding: value.binding,
        operation: value.operation,
        actualCwd,
        gitTopLevel,
      };
    })
    .sort((left, right) => (
      left.plannedWindow.repositoryWindow.localeCompare(
        right.plannedWindow.repositoryWindow,
      )
    ));

  const identity = {
    test: {
      windowName: testWindows[0].windowName,
      bindingId: test.binding.bindingId,
      receiptDigest: test.binding.receiptDigest,
    },
    products: products.map((item) => ({
      windowName: item.plannedWindow.windowName,
      repositoryWindow: item.plannedWindow.repositoryWindow,
      bindingId: item.binding.bindingId,
      receiptDigest: item.binding.receiptDigest,
    })),
  };
  return {
    test,
    products,
    bindingSetDigest: contentDigest(identity),
  };
}

function buildTestAccessProbePlan({
  manifest,
  bindingSet,
}) {
  const probeId = correlationId("pod-test-access", {
    version: 1,
    demandKey: manifest.demandKey,
    podId: manifest.podId,
    host: currentHost,
    bindingSetDigest: bindingSet.bindingSetDigest,
  });
  const base = {
    kind: POD_TEST_ACCESS_PLAN_KIND,
    version: 1,
    probeId,
    demandKey: manifest.demandKey,
    podId: manifest.podId,
    host: currentHost,
    testWindowName: bindingSet.test.binding.windowName,
    testBindingId: bindingSet.test.binding.bindingId,
    bindingSetDigest: bindingSet.bindingSetDigest,
    capabilityUnderTest: "direct-multi-root",
    probeTargets: bindingSet.products.map((item) => ({
      windowName: item.plannedWindow.windowName,
      repositoryWindow: item.plannedWindow.repositoryWindow,
      bindingId: item.binding.bindingId,
      receiptDigest: item.binding.receiptDigest,
      actualRoot: item.actualCwd,
      expectedRootDigest: contentDigest({
        kind: "pod-product-root",
        value: item.actualCwd,
      }),
      expectedGitTopLevelDigest: contentDigest({
        kind: "pod-product-git-top-level",
        value: item.gitTopLevel,
      }),
      expectedHead: item.binding.receipt.head,
    })),
    prohibitedFallbacks: [
      "main-checkout",
      "product-window-as-test",
      "unverified-per-repository-executor",
    ],
  };
  return {
    ...base,
    planDigest: contentDigest(base),
  };
}

function commandPrepareTestAccess() {
  const demandKey = requireValue("--demand-key");
  const config = readConfig();
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  const prepare = () => accessDemandState(demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    const authority = assertPodAuthority(state, demandKey);
    const manifest = runtime.readManifest(authority.podId);
    if (
      !manifest
      || manifest.kind !== POD_MANIFEST_KIND
      || manifest.host !== currentHost
      || manifest.demandKey !== demandKey
    ) {
      fail(`Pod ${authority.podId} has no matching host-local launch manifest.`);
    }
    const bindingSet = testAccessBindingSet({ state, runtime, manifest });
    const plan = buildTestAccessProbePlan({ manifest, bindingSet });
    const existingPlan = runtime.readTestAccessPlan(plan.probeId);
    if (existingPlan && !isDeepStrictEqual(existingPlan, plan)) {
      fail(`Pod Test access probe ${plan.probeId} conflicts with its host-local plan.`);
    }
    const existingAccess = state.podProvisioning.testAccess ?? null;
    if (
      existingAccess
      && (
        existingAccess.probeId !== plan.probeId
        || existingAccess.bindingSetDigest !== bindingSet.bindingSetDigest
        || existingAccess.planDigest !== plan.planDigest
      )
    ) {
      fail(
        "Pod Test access authority already points at a different binding set; "
        + "close or repair that host identity instead of replacing the probe.",
      );
    }
    const nextAccess = existingAccess ?? {
      probeId: plan.probeId,
      status: "pending",
      capability: "pending",
      bindingSetDigest: bindingSet.bindingSetDigest,
      planDigest: plan.planDigest,
      productBindingCount: bindingSet.products.length,
      updatedAt: nowIso(),
    };
    const nextProvisioning = existingAccess
      ? state.podProvisioning
      : {
          ...state.podProvisioning,
          testAccess: nextAccess,
          updatedAt: nowIso(),
        };
    if (write) runtime.writeTestAccessPlan(plan);
    const committedState = existingAccess
      ? state
      : commitPodState({
          stateRoot,
          state,
          stateFile,
          eventsFile,
          nextState: {
            ...state,
            podProvisioning: nextProvisioning,
          },
          eventType: "pod.test-access-probe-planned",
          reason: `host-local Test access probe planned for ${bindingSet.products.length} product bindings`,
        });
    output({
      kind: "WakeflowPodTestAccessProbe",
      demandKey,
      podId: manifest.podId,
      probeId: plan.probeId,
      localPlanRef: slash(path.relative(
        workspaceRoot,
        runtime.testAccessPlanFile(plan.probeId),
      )),
      status: existingAccess?.status ?? "pending",
      capability: existingAccess?.capability ?? "pending",
      productBindingCount: bindingSet.products.length,
      planStoredLocally: write || Boolean(existingPlan),
      stateRevision: committedState.revision,
      idempotent: Boolean(existingAccess),
      agentNext: existingAccess?.status === "validated"
        ? "The exact direct-multi-root Test access capability is already validated."
        : existingAccess?.status === "blocked"
          ? "Keep Pod Test dispatch blocked. Do not substitute a main checkout, product window, or unverified per-repository executor."
          : "Send localPlanRef to the independent Test session, execute only that exact host-local probe, then record its redacted receipt. Do not substitute a main checkout, product window, or unverified per-repository executor.",
    });
  });
  if (!write) return prepare();
  try {
    return withFileLock(
      path.join(runtime.dirs.hostRoot, "pod-test-access.lock"),
      prepare,
    );
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function normalizeTestAccessReceipt(receipt, plan) {
  if (receipt.probeId !== plan.probeId) {
    fail(`Test access receipt probeId does not match ${plan.probeId}.`);
  }
  if (
    receipt.demandKey !== plan.demandKey
    || receipt.podId !== plan.podId
    || receipt.host !== currentHost
    || receipt.testWindowName !== plan.testWindowName
    || receipt.testBindingId !== plan.testBindingId
  ) {
    fail("Test access receipt does not match its Pod/Test binding identity.");
  }
  const status = requireString(receipt.status, "status");
  if (!["validated", "blocked"].includes(status)) {
    fail("Test access receipt status must be validated or blocked.");
  }
  const capability = requireString(receipt.capability, "capability");
  if (!TEST_ACCESS_CAPABILITIES.has(capability)) {
    fail(`Unsupported Test access capability: ${capability}`);
  }
  if (!Number.isFinite(Date.parse(receipt.observedAt))) {
    fail("Test access receipt observedAt must be an ISO timestamp.");
  }
  const productAccess = Array.isArray(receipt.productAccess)
    ? receipt.productAccess.map((raw, index) => {
        const item = requireObject(raw, `productAccess[${index}]`);
        return {
          windowName: requireString(item.windowName, `productAccess[${index}].windowName`),
          repositoryWindow: requireString(
            item.repositoryWindow,
            `productAccess[${index}].repositoryWindow`,
          ),
          bindingId: requireString(item.bindingId, `productAccess[${index}].bindingId`),
          rootDigest: requireString(item.rootDigest, `productAccess[${index}].rootDigest`),
          gitTopLevelDigest: requireString(
            item.gitTopLevelDigest,
            `productAccess[${index}].gitTopLevelDigest`,
          ),
          head: requireString(item.head, `productAccess[${index}].head`),
          readable: item.readable === true,
          gitIdentityVerified: item.gitIdentityVerified === true,
        };
      })
    : [];
  const targetsByBinding = new Map(
    plan.probeTargets.map((target) => [target.bindingId, target]),
  );
  const observedByBinding = new Map();
  for (const item of productAccess) {
    if (observedByBinding.has(item.bindingId)) {
      fail(`Test access receipt duplicates product binding ${item.bindingId}.`);
    }
    observedByBinding.set(item.bindingId, item);
    const target = targetsByBinding.get(item.bindingId);
    if (
      !target
      || item.windowName !== target.windowName
      || item.repositoryWindow !== target.repositoryWindow
      || item.rootDigest !== target.expectedRootDigest
      || item.gitTopLevelDigest !== target.expectedGitTopLevelDigest
      || item.head !== target.expectedHead
    ) {
      fail(
        `Test access receipt does not match the exact bound root/Git identity `
        + `for ${item.windowName}.`,
      );
    }
  }
  if (status === "validated") {
    if (capability !== "direct-multi-root") {
      fail("Only a verified direct-multi-root capability can validate Pod Test access.");
    }
    if (productAccess.length !== plan.probeTargets.length) {
      fail(
        `Validated Test access receipt must cover all ${plan.probeTargets.length} `
        + "product bindings exactly once.",
      );
    }
    for (const target of plan.probeTargets) {
      const item = observedByBinding.get(target.bindingId);
      if (
        !item
        || item.readable !== true
        || item.gitIdentityVerified !== true
      ) {
        fail(
          `Test access receipt does not prove the exact bound root/Git identity `
          + `for ${target.windowName}.`,
        );
      }
    }
  } else {
    if (capability === "direct-multi-root") {
      fail("A blocked Test access receipt cannot claim direct-multi-root capability.");
    }
    const reasonCode = requireString(receipt.reasonCode, "reasonCode");
    if (!TEST_ACCESS_BLOCK_REASONS.has(reasonCode)) {
      fail(`Unsupported Test access block reason: ${reasonCode}`);
    }
  }
  return {
    kind: POD_TEST_ACCESS_RECEIPT_KIND,
    version: 1,
    probeId: plan.probeId,
    demandKey: plan.demandKey,
    podId: plan.podId,
    host: currentHost,
    testWindowName: plan.testWindowName,
    testBindingId: plan.testBindingId,
    bindingSetDigest: plan.bindingSetDigest,
    planDigest: plan.planDigest,
    status,
    capability,
    productAccess,
    ...(status === "blocked" ? { reasonCode: receipt.reasonCode } : {}),
    observedAt: receipt.observedAt,
  };
}

function commandRecordTestAccess() {
  const receiptInput = structuredInput({
    jsonFlag: "--receipt-json",
    fileFlag: "--receipt-file",
    label: "Pod Test access probe receipt",
  });
  const probeId = requireString(receiptInput.probeId, "probeId");
  assertRequestHost(receiptInput.host);
  const config = readConfig();
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  const plan = runtime.readTestAccessPlan(probeId);
  if (
    !plan
    || plan.kind !== POD_TEST_ACCESS_PLAN_KIND
    || plan.probeId !== probeId
    || plan.host !== currentHost
  ) {
    fail(`Unknown or invalid host-local Pod Test access probe: ${probeId}`);
  }
  const record = () => accessDemandState(plan.demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    const authority = assertPodAuthority(state, plan.demandKey);
    const manifest = runtime.readManifest(authority.podId);
    if (!manifest || manifest.podId !== plan.podId) {
      fail(`Pod Test access probe ${probeId} no longer matches canonical Pod authority.`);
    }
    const bindingSet = testAccessBindingSet({ state, runtime, manifest });
    const expectedPlan = buildTestAccessProbePlan({ manifest, bindingSet });
    if (!isDeepStrictEqual(plan, expectedPlan)) {
      fail(`Pod Test access probe ${probeId} no longer matches the active bindings.`);
    }
    const currentAccess = state.podProvisioning.testAccess;
    if (
      !currentAccess
      || currentAccess.probeId !== probeId
      || currentAccess.bindingSetDigest !== plan.bindingSetDigest
      || currentAccess.planDigest !== plan.planDigest
    ) {
      fail(`Tracked Pod Test access summary does not authorize probe ${probeId}.`);
    }
    const receipt = normalizeTestAccessReceipt(receiptInput, plan);
    const receiptDigest = contentDigest(receipt);
    const existingReceipt = runtime.readTestAccessReceipt(probeId);
    if (existingReceipt && !isDeepStrictEqual(existingReceipt, receipt)) {
      fail(`Pod Test access probe ${probeId} already has a different exact receipt.`);
    }
    if (
      currentAccess.receiptDigest
      && currentAccess.receiptDigest !== receiptDigest
    ) {
      fail(`Tracked Pod Test access receipt for ${probeId} is immutable.`);
    }
    const nextAccess = {
      probeId,
      status: receipt.status,
      capability: receipt.capability,
      bindingSetDigest: plan.bindingSetDigest,
      planDigest: plan.planDigest,
      productBindingCount: plan.probeTargets.length,
      receiptDigest,
      ...(receipt.status === "blocked"
        ? { reasonCode: receipt.reasonCode }
        : { validatedAt: receipt.observedAt }),
      updatedAt: receipt.observedAt,
    };
    const stateChanged = !isDeepStrictEqual(currentAccess, nextAccess);
    if (write) runtime.writeTestAccessReceipt(receipt);
    const committedState = stateChanged
      ? commitPodState({
          stateRoot,
          state,
          stateFile,
          eventsFile,
          nextState: {
            ...state,
            podProvisioning: {
              ...state.podProvisioning,
              testAccess: nextAccess,
              updatedAt: nowIso(),
            },
          },
          eventType: receipt.status === "validated"
            ? "pod.test-access-validated"
            : "pod.test-access-blocked",
          reason: receipt.status === "validated"
            ? `independent Test direct-multi-root access verified for ${plan.probeTargets.length} product bindings`
            : `independent Test access blocked: ${receipt.reasonCode}`,
        })
      : state;
    output({
      kind: "WakeflowPodTestAccessRecord",
      demandKey: plan.demandKey,
      podId: plan.podId,
      probeId,
      status: receipt.status,
      capability: receipt.capability,
      productBindingCount: plan.probeTargets.length,
      ...(receipt.status === "blocked" ? { reasonCode: receipt.reasonCode } : {}),
      receiptStoredLocally: write || Boolean(existingReceipt),
      stateRevision: committedState.revision,
      idempotent: Boolean(existingReceipt) && !stateChanged,
      agentNext: receipt.status === "validated"
        ? "The independent Pod Test window may receive an anchored Test package after controller functional acceptance."
        : "Keep Pod Test dispatch blocked. Do not fall back to a main checkout or product window; a verifiable per-repository executor remains a separate host capability.",
    });
  });
  if (!write) return record();
  try {
    return withFileLock(
      path.join(runtime.dirs.hostRoot, "pod-test-access.lock"),
      record,
    );
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function closeOperationRecord({ launchOperation, binding, existing = null }) {
  const intent = {
    demandKey: launchOperation.demandKey,
    podId: launchOperation.podId,
    host: launchOperation.host,
    launchCorrelationId: launchOperation.operationId,
    bindingId: binding?.bindingId ?? null,
    windowName: launchOperation.windowName,
    role: launchOperation.role,
    sessionIntent: binding ? "archive-or-close" : "discover-and-close-or-confirm-absent",
    worktreeIntent: launchOperation.role === "product" ? "host-decides" : "not-applicable",
  };
  const operationId = correlationId("pod-close", intent);
  if (existing) {
    if (
      existing.kind !== POD_OPERATION_KIND
      || existing.operationType !== "close"
      || existing.operationId !== operationId
      || !isDeepStrictEqual(existing.intent, intent)
    ) {
      fail(`Close operation ${operationId} conflicts with its persisted host operation.`);
    }
    return existing;
  }
  const createdAt = nowIso();
  return {
    kind: POD_OPERATION_KIND,
    version: 1,
    operationType: "close",
    operationId,
    demandKey: launchOperation.demandKey,
    podId: launchOperation.podId,
    host: launchOperation.host,
    windowName: launchOperation.windowName,
    role: launchOperation.role,
    intentDigest: contentDigest(intent),
    intent,
    status: "planned",
    createdAt,
    updatedAt: createdAt,
  };
}

function commandClose() {
  const demandKey = requireValue("--demand-key");
  const config = readConfig();
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  return accessDemandState(demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    const authority = assertPodAuthority(state, demandKey);
    if (!TERMINAL_DEMAND_STATES.has(state.state) && state.podProvisioning?.phase !== "cancelling") {
      fail(`Close requires demand state completed, archived, or cancelled (current: ${state.state}); complete/cancel through the state reducer first.`);
    }
    const manifest = runtime.readManifest(authority.podId);
    if (!manifest) {
      const orphanOperations = runtime.listOperations()
        .filter(({ value }) => (
          value?.demandKey === demandKey
          || value?.podId === authority.podId
        ));
      const plannedWindows = state.podProvisioning?.windows ?? [];
      if (
        state.state !== "cancelled"
        || plannedWindows.length > 0
        || orphanOperations.length > 0
      ) {
        fail(`Pod ${authority.podId} has no launch manifest to close, but its state does not prove a zero-resource cancelled lifecycle.`);
      }
      const nextProvisioning = {
        ...(state.podProvisioning ?? {}),
        phase: "closed",
        podId: authority.podId,
        host: state.podProvisioning?.host ?? currentHost,
        authorizationRef: state.podProvisioning?.authorizationRef ?? authority.authorizationRef,
        windows: [],
        updatedAt: nowIso(),
      };
      const committedState = state.podProvisioning?.phase === "closed"
        ? state
        : commitPodState({
            stateRoot,
            state,
            stateFile,
            eventsFile,
            nextState: { ...state, podProvisioning: nextProvisioning },
            eventType: "pod.closed",
            reason: "cancelled Pod closed before any host launch operation was planned",
          });
      output({
        kind: "WakeflowPodClosePlan",
        demandKey,
        podId: authority.podId,
        host: currentHost,
        phase: write
          ? (committedState.podProvisioning?.phase ?? "closed")
          : "closed",
        stateRevision: committedState.revision,
        operations: [],
        remainingWindowNames: [],
        agentNext: "No host resources were planned. The cancelled Pod is logically closed and may now be archived.",
      });
      return;
    }
    const records = manifest.operationIds.map((operationId) => {
      const launchOperation = runtime.readOperation(operationId);
      if (!launchOperation || launchOperation.operationType !== "launch") {
        fail(`Pod launch operation is missing during close: ${operationId}`);
      }
      const binding = runtime.readBinding(authority.podId, launchOperation.windowName);
      const closeId = correlationId("pod-close", {
        demandKey: launchOperation.demandKey,
        podId: launchOperation.podId,
        host: launchOperation.host,
        launchCorrelationId: launchOperation.operationId,
        bindingId: binding?.bindingId ?? null,
        windowName: launchOperation.windowName,
        role: launchOperation.role,
        sessionIntent: binding ? "archive-or-close" : "discover-and-close-or-confirm-absent",
        worktreeIntent: launchOperation.role === "product" ? "host-decides" : "not-applicable",
      });
      return closeOperationRecord({
        launchOperation,
        binding,
        existing: runtime.readOperation(closeId),
      });
    });
    if (write) {
      for (const record of records) runtime.writeOperation(record);
    }
    const nextProvisioning = {
      ...state.podProvisioning,
      phase: records.every((item) => item.status === "closed") ? "closed" : "closing",
      updatedAt: nowIso(),
    };
    const stateChanged = state.podProvisioning?.phase !== nextProvisioning.phase;
    const committedState = stateChanged
      ? commitPodState({
          stateRoot,
          state,
          stateFile,
          eventsFile,
          nextState: { ...state, podProvisioning: nextProvisioning },
          eventType: nextProvisioning.phase === "closed" ? "pod.closed" : "pod.close-planned",
          reason: "host close operations planned without physical resource mutation",
        })
      : state;
    if (write) {
      runtime.writeManifest({
        ...manifest,
        closeOperationIds: records.map((item) => item.operationId),
        lastKnownPhase: committedState.podProvisioning?.phase ?? nextProvisioning.phase,
        updatedAt: nowIso(),
      });
    }
    output({
      kind: "WakeflowPodClosePlan",
      demandKey,
      podId: authority.podId,
      host: currentHost,
      phase: write
        ? (committedState.podProvisioning?.phase ?? nextProvisioning.phase)
        : nextProvisioning.phase,
      stateRevision: committedState.revision,
      operations: records.map((record) => ({
        closeCorrelationId: record.operationId,
        ...record.intent,
      })),
      remainingWindowNames: records
        .filter((item) => item.status !== "closed")
        .map((item) => item.windowName),
      agentNext: "Ask the host to archive/close each listed session and apply its own worktree policy. Record one close receipt per operation; Wakeflow will not delete or claim physical cleanup.",
    });
  });
}

function closeOperationFor(runtime, closeCorrelationId) {
  const matches = runtime.listOperations().filter(({ value }) => (
    value.operationType === "close" && value.operationId === closeCorrelationId
  ));
  if (matches.length === 0) fail(`Unknown closeCorrelationId: ${closeCorrelationId}`);
  if (matches.length > 1) fail(`Close correlation ${closeCorrelationId} is duplicated.`);
  return matches[0].value;
}

function commandRecordCloseReceipt() {
  const receipt = structuredInput({
    jsonFlag: "--receipt-json",
    fileFlag: "--receipt-file",
    label: "Pod close receipt",
  });
  const closeCorrelationId = requireString(receipt.closeCorrelationId, "closeCorrelationId");
  assertRequestHost(receipt.host);
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write,
  });
  const closeOperation = closeOperationFor(runtime, closeCorrelationId);
  const config = readConfig();
  return accessDemandState(closeOperation.demandKey, config, ({
    stateRoot,
    state,
    stateFile,
    eventsFile,
  }) => {
    const authority = assertPodAuthority(state, closeOperation.demandKey);
    if (authority.podId !== closeOperation.podId) {
      fail("Close receipt Pod identity does not match canonical state.");
    }
    if (!["closing", "cancelling", "closed"].includes(state.podProvisioning?.phase)) {
      fail(`Close receipt is not valid in phase ${state.podProvisioning?.phase ?? "(missing)"}.`);
    }
    if (
      receipt.windowName !== closeOperation.windowName
      || receipt.bindingId !== closeOperation.intent.bindingId
    ) {
      fail("Close receipt window/binding identity does not match the close operation.");
    }
    if (!SESSION_CLOSE_STATUSES.has(receipt.sessionStatus)) {
      fail(`Unsupported sessionStatus: ${receipt.sessionStatus ?? "(missing)"}.`);
    }
    if (!WORKTREE_CLOSE_STATUSES.has(receipt.worktreeStatus)) {
      fail(`Unsupported worktreeStatus: ${receipt.worktreeStatus ?? "(missing)"}.`);
    }
    if (!Number.isFinite(Date.parse(receipt.confirmedAt))) {
      fail("Close receipt confirmedAt must be an ISO timestamp.");
    }
    if (closeOperation.intent.bindingId && receipt.sessionStatus === "not-found") {
      fail(`Bound window ${receipt.windowName} cannot be logically closed from a not-found receipt.`);
    }
    if (closeOperation.role !== "product" && receipt.worktreeStatus !== "not-applicable") {
      fail(`Control window ${receipt.windowName} must report worktreeStatus=not-applicable.`);
    }
    if (closeOperation.role === "product" && receipt.worktreeStatus === "not-applicable") {
      fail(`Product window ${receipt.windowName} must report removed, retained, or unknown worktreeStatus.`);
    }
    const receiptDigest = contentDigest(receipt);
    if (
      closeOperation.receiptDigest
      && closeOperation.receiptDigest !== receiptDigest
    ) {
      fail(`Close operation ${closeCorrelationId} already has a different receipt.`);
    }
    const manifest = runtime.readManifest(authority.podId);
    if (!manifest?.closeOperationIds?.includes(closeCorrelationId)) {
      fail(`Close correlation ${closeCorrelationId} is not part of Pod ${authority.podId}'s close plan.`);
    }
    const binding = runtime.readBinding(authority.podId, closeOperation.windowName);
    if (closeOperation.intent.bindingId && (!binding || binding.bindingId !== receipt.bindingId)) {
      fail(`Active binding for ${receipt.windowName} does not match the close receipt.`);
    }
    const nextCloseOperation = {
      ...closeOperation,
      status: "closed",
      receiptDigest,
      receipt,
      updatedAt: nowIso(),
    };
    if (write) {
      runtime.writeOperation(nextCloseOperation);
      if (binding) {
        runtime.writeBinding({
          ...binding,
          status: "closed",
          closeReceipt: receipt,
          updatedAt: nowIso(),
        });
      }
    }
    const windows = state.podProvisioning.windows.map((item) => (
      item.windowName === closeOperation.windowName
        ? { ...item, status: "closed" }
        : item
    ));
    const allClosed = manifest.closeOperationIds.every((operationId) => (
      operationId === closeCorrelationId
        ? true
        : runtime.readOperation(operationId)?.status === "closed"
    ));
    const nextProvisioning = {
      ...state.podProvisioning,
      phase: allClosed ? "closed" : state.podProvisioning.phase === "cancelling"
        ? "cancelling"
        : "closing",
      windows,
      updatedAt: nowIso(),
    };
    const alreadyClosed = (
      closeOperation.status === "closed"
      && state.podProvisioning.windows.some((item) => (
        item.windowName === closeOperation.windowName && item.status === "closed"
      ))
    );
    const committedState = alreadyClosed
      ? state
      : commitPodState({
          stateRoot,
          state,
          stateFile,
          eventsFile,
          nextState: { ...state, podProvisioning: nextProvisioning },
          eventType: allClosed ? "pod.closed" : "pod.window-logically-closed",
          reason: `host close receipt recorded for ${closeOperation.windowName}`,
        });
    if (write) {
      runtime.writeManifest({
        ...manifest,
        lastKnownPhase: committedState.podProvisioning?.phase ?? nextProvisioning.phase,
        updatedAt: nowIso(),
      });
    }
    const remainingWindowNames = manifest.closeOperationIds
      .map((operationId) => (
        operationId === closeCorrelationId
          ? nextCloseOperation
          : runtime.readOperation(operationId)
      ))
      .filter((item) => item?.status !== "closed")
      .map((item) => item.windowName);
    output({
      kind: "WakeflowPodCloseReceiptResult",
      demandKey: closeOperation.demandKey,
      podId: closeOperation.podId,
      windowName: closeOperation.windowName,
      status: "logically-closed",
      phase: write
        ? (committedState.podProvisioning?.phase ?? nextProvisioning.phase)
        : nextProvisioning.phase,
      stateRevision: committedState.revision,
      remainingWindowNames,
      worktreeStatus: receipt.worktreeStatus,
      idempotent: alreadyClosed,
      agentNext: allClosed
        ? "Pod logical close is complete. Physical worktree retention/removal remains a host fact; archive the demand according to the existing state lifecycle."
        : "Record the remaining host close receipts. Do not infer physical cleanup from logical close.",
    });
  });
}

function commandList() {
  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host: currentHost,
    write: false,
  });
  const config = readConfig();
  const pods = runtime.listManifests().map(({ value: manifest }) => {
    let state = null;
    try {
      const stateRoot = stateRootForDemand(manifest.demandKey, config);
      state = readStateAuthority(stateRoot, { recover: false }).state;
    } catch (error) {
      if (!(error instanceof CliExit)) throw error;
      process.exitCode = 0;
    }
    const operations = manifest.operationIds.map((operationId) => runtime.readOperation(operationId));
    return {
      demandKey: manifest.demandKey,
      podId: manifest.podId,
      host: manifest.host,
      demandState: state?.state ?? null,
      phase: state?.podProvisioning?.phase ?? manifest.lastKnownPhase ?? null,
      testAccess: state?.podProvisioning?.testAccess
        ? {
            probeId: state.podProvisioning.testAccess.probeId,
            status: state.podProvisioning.testAccess.status,
            capability: state.podProvisioning.testAccess.capability,
            productBindingCount:
              state.podProvisioning.testAccess.productBindingCount,
            ...(state.podProvisioning.testAccess.reasonCode
              ? { reasonCode: state.podProvisioning.testAccess.reasonCode }
              : {}),
          }
        : null,
      windows: operations.filter(Boolean).map((operation) => ({
        windowName: operation.windowName,
        role: operation.role,
        ...(operation.intent.repositoryWindow
          ? { repositoryWindow: operation.intent.repositoryWindow }
          : {}),
        status: runtime.readBinding(manifest.podId, operation.windowName)?.status
          ?? operation.status,
        ...(operation.materialization?.status
          ? { materializationStatus: operation.materialization.status }
          : {}),
        launchCorrelationId: operation.operationId,
      })),
    };
  });
  output({
    kind: "WakeflowPodInventory",
    host: currentHost,
    pods,
    agentNext: pods.length
      ? "Use canonical phase plus host-local binding status to resume only missing operations."
      : "No host-managed Pod manifests exist for this host.",
  });
}

function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(helpText);
    return;
  }
  if (command === "open") return commandOpen();
  if (command === "record-materialization") return commandRecordMaterialization();
  if (command === "bind") return commandBind();
  if (command === "prepare-design-request") return commandPrepareDesignRequest();
  if (command === "record-design-handoff") return commandRecordDesignHandoff();
  if (command === "prepare-test-access") return commandPrepareTestAccess();
  if (command === "record-test-access") return commandRecordTestAccess();
  if (command === "close") return commandClose();
  if (command === "record-close-receipt") return commandRecordCloseReceipt();
  if (command === "list") return commandList();
  fail(`Unknown wakeflow-pod command: ${command}\n\n${helpText}`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof CliExit)) throw error;
}
