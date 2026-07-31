import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { stableArtifactPart } from "./wakeflow-artifact-identity.mjs";

export const POD_MANIFEST_KIND = "WakeflowHostManagedPodManifest";
export const POD_OPERATION_KIND = "WakeflowHostPodOperation";
export const POD_BINDING_KIND = "WakeflowHostPodBinding";
export const POD_TEST_ACCESS_PLAN_KIND = "WakeflowPodTestAccessProbePlan";
export const POD_TEST_ACCESS_RECEIPT_KIND = "WakeflowPodTestAccessProbeReceipt";

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(normalized(value));
}

export function contentDigest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function correlationId(prefix, value) {
  return `${prefix}-${contentDigest(value).slice(0, 32)}`;
}

function pathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function assertRuntimePathChain(workspaceRoot, directory) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(directory);
  if (!pathInside(root, target) || root === target) {
    throw new Error(`Pod runtime directory must stay below the workspace root: ${target}`);
  }
  const rootReal = realpathSync(root);
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) return target;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Pod runtime directory cannot cross a symbolic link: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Pod runtime path component is not a directory: ${current}`);
    }
    const currentReal = realpathSync(current);
    if (!pathInside(rootReal, currentReal)) {
      throw new Error(`Pod runtime directory resolves outside the workspace root: ${current}`);
    }
  }
  return target;
}

function assertRuntimeDirectory(workspaceRoot, directory) {
  const root = path.resolve(workspaceRoot);
  const target = assertRuntimePathChain(root, directory);
  mkdirSync(target, { recursive: true });
  assertRuntimePathChain(root, target);
  return target;
}

function readJsonFile(file, label) {
  if (!existsSync(file)) return null;
  if (lstatSync(file).isSymbolicLink()) {
    throw new Error(`${label} cannot be a symbolic link: ${file}`);
  }
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value;
  } catch (error) {
    throw new Error(`Invalid ${label} ${file}: ${error.message}`);
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

function jsonFiles(directory) {
  if (!existsSync(directory)) return [];
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Pod runtime directory cannot be a symbolic link: ${directory}`);
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

export function createPodRuntime({
  workspaceRoot,
  stateDir,
  host,
  write = false,
}) {
  const root = path.resolve(workspaceRoot);
  const deliveryRoot = path.resolve(stateDir);
  const hostRoot = path.join(deliveryRoot, "hosts", stableArtifactPart(host, { fallback: "host" }));
  const dirs = {
    hostRoot,
    manifests: path.join(hostRoot, "pod-manifests"),
    operations: path.join(hostRoot, "pod-operations"),
    bindings: path.join(hostRoot, "pod-bindings"),
    testAccessPlans: path.join(hostRoot, "pod-test-access-plans"),
    testAccessReceipts: path.join(hostRoot, "pod-test-access-receipts"),
  };

  if (!pathInside(root, deliveryRoot) || root === deliveryRoot) {
    throw new Error(`Wakeflow delivery state directory must stay below the workspace root: ${deliveryRoot}`);
  }
  for (const directory of [
    hostRoot,
    dirs.manifests,
    dirs.operations,
    dirs.bindings,
    dirs.testAccessPlans,
    dirs.testAccessReceipts,
  ]) {
    assertRuntimePathChain(root, directory);
  }
  if (write) {
    assertRuntimeDirectory(root, dirs.manifests);
    assertRuntimeDirectory(root, dirs.operations);
    assertRuntimeDirectory(root, dirs.bindings);
    assertRuntimeDirectory(root, dirs.testAccessPlans);
    assertRuntimeDirectory(root, dirs.testAccessReceipts);
  }

  function manifestFile(podId) {
    return path.join(dirs.manifests, `${stableArtifactPart(podId, { fallback: "pod" })}.json`);
  }

  function operationFile(operationId) {
    return path.join(dirs.operations, `${stableArtifactPart(operationId, { fallback: "operation" })}.json`);
  }

  function bindingDir(podId) {
    return path.join(dirs.bindings, stableArtifactPart(podId, { fallback: "pod" }));
  }

  function bindingFile(podId, windowName) {
    return path.join(
      bindingDir(podId),
      `${stableArtifactPart(windowName, { fallback: "window" })}.json`,
    );
  }

  function testAccessPlanFile(probeId) {
    return path.join(
      dirs.testAccessPlans,
      `${stableArtifactPart(probeId, { fallback: "test-access-probe" })}.json`,
    );
  }

  function testAccessReceiptFile(probeId) {
    return path.join(
      dirs.testAccessReceipts,
      `${stableArtifactPart(probeId, { fallback: "test-access-probe" })}.json`,
    );
  }

  function readManifest(podId) {
    return readJsonFile(manifestFile(podId), "Pod manifest");
  }

  function writeManifest(value) {
    if (!write) return;
    assertRuntimeDirectory(root, dirs.manifests);
    writeJsonAtomic(manifestFile(value.podId), value);
  }

  function readOperation(operationId) {
    return readJsonFile(operationFile(operationId), "Pod operation");
  }

  function writeOperation(value) {
    if (!write) return;
    assertRuntimeDirectory(root, dirs.operations);
    writeJsonAtomic(operationFile(value.operationId), value);
  }

  function readBinding(podId, windowName) {
    return readJsonFile(bindingFile(podId, windowName), "Pod binding");
  }

  function writeBinding(value) {
    if (!write) return;
    const directory = bindingDir(value.podId);
    assertRuntimeDirectory(root, directory);
    writeJsonAtomic(bindingFile(value.podId, value.windowName), value);
  }

  function readTestAccessPlan(probeId) {
    return readJsonFile(testAccessPlanFile(probeId), "Pod Test access probe plan");
  }

  function writeTestAccessPlan(value) {
    if (!write) return;
    assertRuntimeDirectory(root, dirs.testAccessPlans);
    writeJsonAtomic(testAccessPlanFile(value.probeId), value);
  }

  function readTestAccessReceipt(probeId) {
    return readJsonFile(
      testAccessReceiptFile(probeId),
      "Pod Test access probe receipt",
    );
  }

  function writeTestAccessReceipt(value) {
    if (!write) return;
    assertRuntimeDirectory(root, dirs.testAccessReceipts);
    writeJsonAtomic(testAccessReceiptFile(value.probeId), value);
  }

  function listManifests() {
    return jsonFiles(dirs.manifests).map((file) => ({
      file,
      value: readJsonFile(file, "Pod manifest"),
    }));
  }

  function listOperations() {
    return jsonFiles(dirs.operations).map((file) => ({
      file,
      value: readJsonFile(file, "Pod operation"),
    }));
  }

  function listBindings(podId = null) {
    const podDirs = podId
      ? [bindingDir(podId)]
      : existsSync(dirs.bindings)
        ? readdirSync(dirs.bindings, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
            .map((entry) => path.join(dirs.bindings, entry.name))
        : [];
    return podDirs.flatMap((directory) => jsonFiles(directory).map((file) => ({
      file,
      value: readJsonFile(file, "Pod binding"),
    })));
  }

  return {
    dirs,
    manifestFile,
    operationFile,
    bindingFile,
    testAccessPlanFile,
    testAccessReceiptFile,
    readManifest,
    writeManifest,
    readOperation,
    writeOperation,
    readBinding,
    writeBinding,
    readTestAccessPlan,
    writeTestAccessPlan,
    readTestAccessReceipt,
    writeTestAccessReceipt,
    listManifests,
    listOperations,
    listBindings,
  };
}

function podStateRootRelative(workspaceRoot, stateRoot) {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(stateRoot));
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Pod state root must stay below the workspace root: ${stateRoot}`);
  }
  return relative.split(path.sep).join("/");
}

function canonicalExistingDirectory(value, label) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path from the verified host receipt.`);
  }
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symbolic link: ${resolved}`);
  }
  const real = realpathSync(resolved);
  if (real !== resolved) {
    throw new Error(`${label} must already be the stable realpath recorded by the host: ${resolved}`);
  }
  return real;
}

function isExplicitPodPlacement(state) {
  return state?.executionPlacement?.mode === "isolated"
    && state?.executionPlacement?.selection === "explicit-user-pod";
}

/**
 * Resolve the only repository/evidence working root an active Pod target may use.
 *
 * This is intentionally read-only. It validates the complete
 * state -> manifest -> launch operation -> binding -> receipt chain before
 * returning receipt.actualCwd. A Pod target never falls back to the configured
 * main checkout when this authority is absent or corrupt.
 */
export function resolvePodTargetWorkRoot({
  workspaceRoot,
  stateDir,
  host,
  stateRoot,
  state,
  targetWindow,
}) {
  if (!isExplicitPodPlacement(state)) {
    return {
      isPod: false,
      active: false,
      actualCwd: null,
      binding: null,
    };
  }

  const podId = state.executionPlacement?.podId;
  if (typeof podId !== "string" || !podId) {
    throw new Error("Explicit Pod placement is missing executionPlacement.podId.");
  }
  const provisioning = state.podProvisioning;
  if (!provisioning || provisioning.podId !== podId) {
    throw new Error(`Active Pod ${podId} is missing matching podProvisioning authority.`);
  }
  if (provisioning.host !== host) {
    throw new Error(
      `Active Pod ${podId} belongs to host ${provisioning.host ?? "(missing)"}, not ${host}.`,
    );
  }
  if (typeof provisioning.phase !== "string" || !provisioning.phase) {
    throw new Error(`Active Pod ${podId} is missing podProvisioning.phase.`);
  }

  // A logically closed Pod may still be inspected from immutable state-root
  // evidence, but its retired host cwd is no longer an active execution root.
  if (provisioning.phase === "closed") {
    return {
      isPod: true,
      active: false,
      actualCwd: null,
      binding: null,
    };
  }

  const plannedWindows = Array.isArray(provisioning.windows)
    ? provisioning.windows.filter((item) => item?.windowName === targetWindow)
    : [];
  if (plannedWindows.length !== 1) {
    throw new Error(
      `Active Pod target ${targetWindow} must have exactly one canonical planned window; found ${plannedWindows.length}.`,
    );
  }
  const plannedWindow = plannedWindows[0];
  if (
    plannedWindow.status !== "bound"
    || !plannedWindow.launchCorrelationId
  ) {
    throw new Error(
      `Active Pod target ${targetWindow} has no verified bound window in canonical state.`,
    );
  }

  const runtime = createPodRuntime({
    workspaceRoot,
    stateDir,
    host,
    write: false,
  });
  const matchingBindings = runtime.listBindings(podId)
    .map((entry) => entry.value)
    .filter((binding) => (
      binding?.windowName === targetWindow
      && binding?.status === "active"
    ));
  if (matchingBindings.length !== 1) {
    throw new Error(
      `Active Pod target ${targetWindow} must have exactly one active host binding; found ${matchingBindings.length}.`,
    );
  }
  const binding = matchingBindings[0];
  if (
    binding.kind !== POD_BINDING_KIND
    || binding.host !== host
    || binding.demandKey !== state.demandKey
    || binding.podId !== podId
    || binding.launchCorrelationId !== plannedWindow.launchCorrelationId
    || !binding.bindingId
    || !binding.receipt
    || binding.receiptDigest !== contentDigest(binding.receipt)
  ) {
    throw new Error(
      `Active Pod binding for ${targetWindow} is incomplete or does not match canonical state.`,
    );
  }

  const manifest = runtime.readManifest(podId);
  const operation = runtime.readOperation(binding.launchCorrelationId);
  const expectedStateRoot = podStateRootRelative(workspaceRoot, stateRoot);
  if (
    !manifest
    || manifest.kind !== POD_MANIFEST_KIND
    || manifest.host !== host
    || manifest.demandKey !== state.demandKey
    || manifest.podId !== podId
    || manifest.stateRootRelative !== expectedStateRoot
    || !manifest.operationIds?.includes(binding.launchCorrelationId)
    || !operation
    || operation.kind !== POD_OPERATION_KIND
    || operation.operationType !== "launch"
    || operation.status !== "bound"
    || operation.host !== host
    || operation.demandKey !== state.demandKey
    || operation.podId !== podId
    || operation.windowName !== targetWindow
    || operation.role !== binding.role
    || operation.bindingId !== binding.bindingId
    || operation.receiptDigest !== binding.receiptDigest
    || operation.intent?.registrationBindingId !== binding.bindingId
    || operation.intent?.stateRootRelative !== expectedStateRoot
  ) {
    throw new Error(
      `Active Pod binding for ${targetWindow} does not match its manifest and launch operation.`,
    );
  }
  if (
    binding.receipt.windowName !== targetWindow
    || binding.receipt.host !== host
    || binding.receipt.bindingId !== binding.bindingId
    || binding.receipt.launchCorrelationId !== binding.launchCorrelationId
    || binding.receipt.stateRootRelative !== expectedStateRoot
    || binding.receipt.handleRegistered !== true
    || binding.receipt.handleKind !== "final"
  ) {
    throw new Error(
      `Active Pod binding receipt for ${targetWindow} does not match its canonical identity.`,
    );
  }
  const registryDir = path.join(runtime.dirs.hostRoot, "thread-registry");
  const registrations = jsonFiles(registryDir)
    .map((file) => readJsonFile(file, "Pod thread registration"))
    .filter((registration) => registration?.windowName === targetWindow);
  if (
    registrations.length !== 1
    || registrations[0].bindingId !== binding.bindingId
    || !registrations[0].threadId
    || contentDigest({ host, handle: registrations[0].threadId }) !== binding.handleDigest
  ) {
    throw new Error(
      `Active Pod binding for ${targetWindow} does not match exactly one registered final host session.`,
    );
  }

  const actualCwd = canonicalExistingDirectory(
    binding.receipt.actualCwd,
    `Active Pod binding actualCwd for ${targetWindow}`,
  );
  if (binding.role === "product") {
    const gitTopLevel = canonicalExistingDirectory(
      binding.receipt.gitTopLevel,
      `Active Pod binding gitTopLevel for ${targetWindow}`,
    );
    if (gitTopLevel !== actualCwd || binding.receipt.mainCheckout !== false) {
      throw new Error(
        `Active Pod product binding for ${targetWindow} is not a verified host worktree.`,
      );
    }
  }

  return {
    isPod: true,
    active: true,
    actualCwd,
    binding,
  };
}
