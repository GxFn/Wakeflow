// 本模块是baseline window-runtime的唯一projection owner与物理维护适配器。
// 普通链路从strict v3 config、window binding inventory和根目录观察重建投影；
// maintenance链路把同一派生结果冻结成portable owner plan，再交给M3 tracked materialization执行。
// 两条链共享同一record codec与source digest，不形成第二份config、identity或host liveness authority。
// 阅读顺序：输入/来源准入 → desired plan → 安全inventory → 普通T02 rebuild → maintenance plan/participant。
import fs from "node:fs";
import path from "node:path";

import {
  atomicWriteFile,
  sha256Bytes,
} from "./wakeflow-atomic-write.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { loadWakeflowConfigV3Snapshot } from "./wakeflow-config-v3-snapshot.mjs";
import { assertWakeflowConfigV3TransitionAuthority } from "./wakeflow-config-v3-transition-authority.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { hostProfile as installedHostProfile } from "./wakeflow-host-profile.mjs";
import { createWakeflowLayoutDescriptor } from "./wakeflow-layout-descriptor.mjs";
import {
  inspectWindowBindingInventory,
  inspectWindowBindingInventoryForLayout,
} from "./wakeflow-window-binding-service.mjs";
import {
  createWindowRuntimeProjection,
  validateWindowRuntimeProjection,
  windowRuntimeProjectionCanonicalBytes,
  windowRuntimeProjectionRef,
} from "./wakeflow-window-runtime-records.mjs";
import {
  assertWakeflowMutationContext,
  withWakeflowRuntimeMutation,
} from "./wakeflow-workspace-mutation.mjs";
import { createWakeflowTrackedMaterializationParticipant } from "./wakeflow-tracked-materialization.mjs";

export const WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_ID =
  "urn:wakeflow:internal:window-runtime-maintenance-plan:v1";
export const WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_KIND =
  "WakeflowWindowRuntimeMaintenancePlan";
export const WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_VERSION = 1;

const INVENTORY_KIND = "WakeflowWindowRuntimeProjectionInventory";
const INVENTORY_SCHEMA_VERSION = 1;
const PROJECTION_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const MAX_PROJECTION_BYTES = 256 * 1024;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOW_FILE_RE = /^(window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const ATOMIC_CODE_RE = /^[a-z][a-z0-9-]{0,127}$/u;
const SAFE_PRECOMMIT_ATOMIC_CODES = new Set([
  "expectation-mismatch",
  "parent-missing",
  "predecessor-capture-failed",
  "source-identity-changed",
  "source-identity-mismatch",
  "source-read-failed",
  "source-type-changed",
  "stage-create-failed",
  "stage-write-failed",
]);

export class WakeflowWindowRuntimeProjectionError extends Error {
  constructor(code, message, { details = {} } = {}) {
    super(message);
    this.name = "WakeflowWindowRuntimeProjectionError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

// ---------- 公共输入与本机执行前提 ----------

function fail(code, message, details = {}) {
  throw new WakeflowWindowRuntimeProjectionError(code, message, { details });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataObject(value, required, optional, label) {
  if (!plainObject(value)) {
    fail("wakeflow-window-runtime-projector-input", `${label} must be one plain data object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("wakeflow-window-runtime-projector-input", `${label} has the wrong field set`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-window-runtime-projector-input",
        `${label} fields must be enumerable data properties`,
      );
    }
    result[key] = descriptor.value;
  }
  return result;
}

function normalizeWorkspaceRoot(value) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || CONTROL_RE.test(value)
  ) {
    fail(
      "wakeflow-window-runtime-projector-input",
      "workspaceRoot must be one trimmed control-free path",
    );
  }
  return path.resolve(value);
}

function normalizeAcquireTimeout(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 300_000) {
    fail(
      "wakeflow-window-runtime-projector-input",
      "acquireTimeoutMs must be an integer from 0 through 300000",
    );
  }
  return value;
}

function normalizeInspectInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot"],
    [],
    "window runtime projection inspection input",
  );
  return Object.freeze({ workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot) });
}

function normalizeRebuildInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot"],
    ["acquireTimeoutMs"],
    "window runtime projection rebuild input",
  );
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(values.workspaceRoot),
    acquireTimeoutMs: normalizeAcquireTimeout(values.acquireTimeoutMs),
  });
}

function normalizeLayoutInput(input) {
  const values = exactDataObject(
    input,
    ["workspaceRoot", "model", "configDigest", "hostProfile"],
    [],
    "layout window runtime projection inspection input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(values.workspaceRoot);
  if (typeof values.configDigest !== "string" || !DIGEST_RE.test(values.configDigest)) {
    fail(
      "wakeflow-window-runtime-projector-input",
      "layout configDigest must be one lowercase sha256 digest",
    );
  }
  let model;
  let profile;
  let descriptor;
  try {
    descriptor = createWakeflowLayoutDescriptor({
      model: values.model,
      hostProfile: values.hostProfile,
    });
    model = JSON.parse(canonicalJson(values.model));
    profile = descriptor.host;
  } catch {
    fail(
      "wakeflow-window-runtime-projector-input",
      "layout model or host profile is not a valid Wakeflow authority input",
    );
  }
  if (descriptor.configDigest !== values.configDigest) {
    fail(
      "wakeflow-window-runtime-projector-input",
      "layout configDigest does not match the supplied strict v3 model",
    );
  }
  inspectWorkspaceRoot(workspaceRoot);
  return Object.freeze({
    workspaceRoot,
    model,
    configDigest: values.configDigest,
    rawHostProfile: values.hostProfile,
    profile,
  });
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail(
      "wakeflow-window-runtime-projector-platform",
      "window runtime projections require POSIX ownership semantics",
    );
  }
  return BigInt(process.geteuid());
}

function inspectWorkspaceRoot(workspaceRoot) {
  let stat;
  try {
    stat = fs.lstatSync(workspaceRoot, { bigint: true });
  } catch {
    fail(
      "wakeflow-window-runtime-projector-workspace",
      "window runtime projection workspace is unavailable",
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(
      "wakeflow-window-runtime-projector-workspace",
      "window runtime projection workspace must be one real directory",
    );
  }
}

// ---------- Durable topology、binding 与根目录观察 ----------

function modeOf(stat) {
  return Number(stat.mode & 0o777n);
}

function sameStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid;
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function sourceIdentity(stat) {
  return Object.freeze({
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
    mode: String(stat.mode),
    uid: String(stat.uid),
    gid: String(stat.gid),
    linkCount: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  });
}

function commitIdentityMatches(stat, identity) {
  return identity !== null
    && String(stat.dev) === identity.deviceId
    && String(stat.ino) === identity.inodeId
    && String(stat.mode) === identity.mode
    && String(stat.uid) === identity.uid
    && String(stat.gid) === identity.gid
    && String(stat.nlink) === identity.linkCount
    && String(stat.size) === identity.size;
}

function projectionRootRef(profile) {
  return `.wakeflow-local/runtime/hosts/${profile.hostDirName}/projections/window-runtime`;
}

function rootDescriptor(context, window) {
  if (window.root.kind === "program") {
    return Object.freeze({
      rootRef: Object.freeze({ kind: "program", programId: context.model.program.programId }),
      configuredRoot: ".",
    });
  }
  if (window.root.kind === "support-surface") {
    const surface = context.indexes.surfaceById[window.root.surfaceId];
    if (!surface) {
      fail(
        "wakeflow-window-runtime-projector-source",
        "window runtime projection topology contains an unresolved support surface",
      );
    }
    return Object.freeze({
      rootRef: Object.freeze({ kind: "support-surface", surfaceId: surface.surfaceId }),
      configuredRoot: surface.path,
    });
  }
  const repository = context.indexes.repositoryById[window.root.repositoryId];
  if (!repository) {
    fail(
      "wakeflow-window-runtime-projector-source",
      "window runtime projection topology contains an unresolved repository",
    );
  }
  return Object.freeze({
    rootRef: Object.freeze({ kind: "repository", repositoryId: repository.repositoryId }),
    configuredRoot: repository.path,
  });
}

// 按每个portable segment观察真实目录，拒绝symlink/wrong type；这里证明root可观察，不证明session cwd。
function configuredRootTraversal(workspaceRoot, configuredRoot) {
  const paths = [workspaceRoot];
  let current = workspaceRoot;
  if (configuredRoot !== ".") {
    for (const segment of configuredRoot.split("/")) {
      current = path.resolve(current, segment);
      if (current !== paths.at(-1)) paths.push(current);
    }
  }
  return Object.freeze({
    absolute: path.resolve(workspaceRoot, configuredRoot),
    paths: Object.freeze(paths),
  });
}

function probeConfiguredRoot(workspaceRoot, descriptor) {
  const traversal = configuredRootTraversal(workspaceRoot, descriptor.configuredRoot);
  const snapshots = [];
  let missingPath = null;
  for (let index = 0; index < traversal.paths.length; index += 1) {
    const candidate = traversal.paths[index];
    let stat;
    try {
      stat = fs.lstatSync(candidate, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT" && index > 0) {
        missingPath = candidate;
        break;
      }
      fail(
        "wakeflow-window-runtime-projector-root-source",
        "configured window root cannot be inspected safely",
      );
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(
        "wakeflow-window-runtime-projector-root-source",
        "configured window root and its existing traversal must be real directories",
      );
    }
    let realPath;
    try {
      realPath = fs.realpathSync(candidate);
    } catch {
      fail(
        "wakeflow-window-runtime-projector-root-source",
        "configured window root cannot be resolved safely",
      );
    }
    snapshots.push(Object.freeze({ path: candidate, stat, realPath }));
  }

  if (missingPath !== null) {
    const observationDigest = canonicalJsonDigest({
      kind: "WakeflowWindowRootObservation",
      schemaVersion: 1,
      rootRef: descriptor.rootRef,
      configuredRoot: descriptor.configuredRoot,
      status: "missing",
    });
    return Object.freeze({
      absolute: traversal.absolute,
      status: "missing",
      stat: null,
      snapshots: Object.freeze(snapshots),
      missingPath,
      observationDigest,
    });
  }
  const stat = snapshots.at(-1).stat;
  const observationDigest = canonicalJsonDigest({
    kind: "WakeflowWindowRootObservation",
    schemaVersion: 1,
    rootRef: descriptor.rootRef,
    configuredRoot: descriptor.configuredRoot,
    status: "available",
    deviceId: String(stat.dev),
    inodeId: String(stat.ino),
  });
  return Object.freeze({
    absolute: traversal.absolute,
    status: "available",
    stat,
    snapshots: Object.freeze(snapshots),
    missingPath: null,
    observationDigest,
  });
}

function unobservedConfiguredRoot(descriptor) {
  return Object.freeze({
    status: "unobserved",
    observationDigest: canonicalJsonDigest({
      kind: "WakeflowWindowRootObservation",
      schemaVersion: 1,
      rootRef: descriptor.rootRef,
      configuredRoot: descriptor.configuredRoot,
      status: "unobserved",
    }),
  });
}

// 在计划释放给后续扫描前复验同一目录代际，关闭root观察期间的TOCTOU。
function assertRootObservationCurrent(observation) {
  for (const snapshot of observation.snapshots) {
    let current;
    let realPath;
    try {
      current = fs.lstatSync(snapshot.path, { bigint: true });
      realPath = fs.realpathSync(snapshot.path);
    } catch {
      fail(
        "wakeflow-window-runtime-projector-root-source",
        "configured window root changed during observation",
      );
    }
    if (
      current.isSymbolicLink()
      || !current.isDirectory()
      || !sameDirectoryIdentity(snapshot.stat, current)
      || realPath !== snapshot.realPath
    ) {
      fail(
        "wakeflow-window-runtime-projector-root-source",
        "configured window root changed during observation",
      );
    }
  }
  if (observation.status === "missing") {
    try {
      fs.lstatSync(observation.missingPath, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") return;
      fail(
        "wakeflow-window-runtime-projector-root-source",
        "configured window root changed during observation",
      );
    }
    fail(
      "wakeflow-window-runtime-projector-root-source",
      "configured window root changed during observation",
    );
  }
}

function validateBindingInventory(context, inventory) {
  if (
    inventory.programId !== context.model.program.programId
    || inventory.hostId !== context.profile.hostId
    || inventory.configDigest !== context.configDigest
    || typeof inventory.inventoryDigest !== "string"
    || !DIGEST_RE.test(inventory.inventoryDigest)
    || !Array.isArray(inventory.bindings)
  ) {
    fail(
      "wakeflow-window-runtime-projector-identity-source",
      "window identity inventory does not match the projection source authority",
    );
  }
  return inventory;
}

function durableBindingInventory(context, inventory) {
  validateBindingInventory(context, inventory);
  const bindings = inventory.bindings.filter((binding) => (
    Object.hasOwn(context.indexes.windowById, binding.windowId)
  ));
  const unsigned = {
    kind: inventory.kind,
    schemaVersion: inventory.schemaVersion,
    programId: inventory.programId,
    hostId: inventory.hostId,
    identityRootRef: inventory.identityRootRef,
    configDigest: inventory.configDigest,
    status: inventory.status === "missing"
      ? "missing"
      : bindings.length === 0 ? "empty" : "current",
    bindings,
  };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

function normalSourceContext(workspaceRoot) {
  let initialSnapshot;
  let confirmedSnapshot;
  let profile;
  let inventory;
  try {
    initialSnapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
    profile = normalizeWakeflowHostCapabilityProfile(installedHostProfile);
  } catch {
    fail(
      "wakeflow-window-runtime-projector-config-source",
      "strict v3 config authority is unavailable to the window runtime projector",
    );
  }
  try {
    inventory = inspectWindowBindingInventory({ workspaceRoot });
  } catch {
    fail(
      "wakeflow-window-runtime-projector-identity-source",
      "strict window identity source is unavailable to the runtime projector",
    );
  }
  try {
    confirmedSnapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  } catch {
    fail(
      "wakeflow-window-runtime-projector-config-source",
      "strict v3 config authority cannot be confirmed after identity inspection",
    );
  }
  if (
    initialSnapshot.configDigest !== confirmedSnapshot.configDigest
    || inventory.configDigest !== confirmedSnapshot.configDigest
  ) {
    fail(
      "wakeflow-window-runtime-projector-source-race",
      "window runtime projection config changed across identity inventory inspection",
    );
  }
  const context = {
    workspaceRoot,
    model: confirmedSnapshot.model,
    indexes: confirmedSnapshot.indexes,
    configDigest: confirmedSnapshot.configDigest,
    profile,
    inventory: null,
  };
  context.inventory = durableBindingInventory(context, inventory);
  return Object.freeze(context);
}

// candidate layout尚未落盘config时，使用调用方已验证model和host profile，但仍读取真实binding inventory。
function layoutSourceContext(input) {
  const indexes = indexesForValidatedModel(input.model);
  let inventory;
  try {
    inventory = inspectWindowBindingInventoryForLayout({
      workspaceRoot: input.workspaceRoot,
      programId: input.model.program.programId,
      hostId: input.profile.hostId,
      configDigest: input.configDigest,
      windowIds: input.model.topology.windows.map((window) => window.windowId),
      hostProfile: input.rawHostProfile,
    });
  } catch {
    fail(
      "wakeflow-window-runtime-projector-identity-source",
      "strict layout window identity source is unavailable to the runtime projector",
    );
  }
  const context = {
    workspaceRoot: input.workspaceRoot,
    model: input.model,
    indexes,
    configDigest: input.configDigest,
    profile: input.profile,
    inventory: null,
  };
  context.inventory = durableBindingInventory(context, inventory);
  return Object.freeze(context);
}

function indexesForValidatedModel(model) {
  return Object.freeze({
    repositoryById: Object.freeze(Object.fromEntries(
      model.topology.repositories.map((entry) => [entry.repositoryId, entry]),
    )),
    surfaceById: Object.freeze(Object.fromEntries(
      model.topology.supportSurfaces.map((entry) => [entry.surfaceId, entry]),
    )),
    windowById: Object.freeze(Object.fromEntries(
      model.topology.windows.map((entry) => [entry.windowId, entry]),
    )),
  });
}

function buildDesiredPlan(context) {
  const bindings = new Map(context.inventory.bindings.map((binding) => [binding.windowId, binding]));
  const topologyDigest = canonicalJsonDigest(context.model.topology);
  const observationByRoot = new Map();
  const observations = [];
  const entries = [...context.model.topology.windows]
    .sort((left, right) => lexicalCompare(left.windowId, right.windowId))
    .map((window) => {
      const descriptor = rootDescriptor(context, window);
      const binding = bindings.get(window.windowId) ?? null;
      const identity = binding === null
        ? Object.freeze({ status: "unregistered" })
        : Object.freeze({
          status: "valid",
          identityRef: binding.identityRef,
          bindingId: binding.bindingId,
          identityBindingDigest: binding.identityBindingDigest,
        });
      let observation;
      if (binding === null) {
        observation = unobservedConfiguredRoot(descriptor);
      } else {
        const observationKey = canonicalJsonDigest(descriptor);
        observation = observationByRoot.get(observationKey);
        if (!observation) {
          observation = probeConfiguredRoot(context.workspaceRoot, descriptor);
          observationByRoot.set(observationKey, observation);
          observations.push(observation);
        }
      }
      const dispatchEligibility = window.role === "design" ? "ineligible" : "eligible";
      const blockingReasons = Object.freeze([
        ...(identity.status === "unregistered"
          ? [Object.freeze({ code: "identity-unregistered", source: "identity" })]
          : []),
        ...(observation.status === "missing"
          ? [Object.freeze({ code: "root-unavailable", source: "root" })]
          : []),
      ]);
      let record;
      try {
        record = createWindowRuntimeProjection({
          programId: context.model.program.programId,
          hostId: context.profile.hostId,
          windowId: window.windowId,
          role: window.role,
          rootRef: descriptor.rootRef,
          configuredRoot: descriptor.configuredRoot,
          resolvedRoot: {
            status: observation.status,
            observationDigest: observation.observationDigest,
          },
          identity,
          dispatchEligibility,
          preflightStatus: blockingReasons.length === 0 ? "ready" : "blocked",
          blockingReasons,
          hostAvailability: { status: "unobserved" },
          sourceFingerprints: {
            configDigest: context.configDigest,
            topologyDigest,
            windowDigest: canonicalJsonDigest(window),
            rootObservationDigest: observation.observationDigest,
            identityInventoryDigest: context.inventory.inventoryDigest,
            ...(identity.status === "valid"
              ? { identityBindingDigest: identity.identityBindingDigest }
              : {}),
          },
        });
      } catch {
        fail(
          "wakeflow-window-runtime-projector-record",
          "derived window runtime projection failed its owner codec",
          { windowId: window.windowId },
        );
      }
      const ref = windowRuntimeProjectionRef({
        hostDirName: context.profile.hostDirName,
        windowId: window.windowId,
      });
      return Object.freeze({
        windowId: window.windowId,
        ref,
        file: path.resolve(context.workspaceRoot, ...ref.split("/")),
        record,
        bytes: windowRuntimeProjectionCanonicalBytes(record),
        expectedDigest: record.projectionDigest,
      });
    });
  for (const observation of observations) assertRootObservationCurrent(observation);
  const sourcePlanDigest = canonicalJsonDigest({
    programId: context.model.program.programId,
    hostId: context.profile.hostId,
    configDigest: context.configDigest,
    topologyDigest,
    identityInventoryDigest: context.inventory.inventoryDigest,
    projections: entries.map((entry) => ({
      windowId: entry.windowId,
      projectionDigest: entry.expectedDigest,
    })),
  });
  return Object.freeze({
    workspaceRoot: context.workspaceRoot,
    programId: context.model.program.programId,
    hostId: context.profile.hostId,
    hostDirName: context.profile.hostDirName,
    configDigest: context.configDigest,
    projectionRootRef: projectionRootRef(context.profile),
    sourcePlanDigest,
    entries: Object.freeze(entries),
  });
}

// ---------- Projection namespace 安全inventory ----------

function inspectPrivateDirectoryChain(workspaceRoot, relativeRef, modePolicy) {
  inspectWorkspaceRoot(workspaceRoot);
  const euid = currentEuid();
  const components = relativeRef.split("/");
  let realRoot;
  try {
    realRoot = fs.realpathSync(workspaceRoot);
  } catch {
    fail(
      "wakeflow-window-runtime-projector-workspace",
      "window runtime projection workspace cannot be resolved safely",
    );
  }
  const snapshots = [];
  let current = workspaceRoot;
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let stat;
    try {
      stat = fs.lstatSync(current, { bigint: true });
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        return Object.freeze({ state: "missing", root: current, snapshots });
      }
      return Object.freeze({ state: "unsafe", root: current, snapshots });
    }
    const mode = modeOf(stat);
    const modeAccepted = modePolicy === "layout-repairable"
      ? (mode & 0o700) === 0o700 && (mode & 0o022) === 0
      : mode === PRIVATE_DIRECTORY_MODE;
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.uid !== euid
      || !modeAccepted
    ) {
      return Object.freeze({ state: "unsafe", root: current, snapshots });
    }
    let real;
    try {
      real = fs.realpathSync(current);
    } catch {
      return Object.freeze({ state: "unsafe", root: current, snapshots });
    }
    if (!pathInside(realRoot, real) || real === realRoot) {
      return Object.freeze({ state: "unsafe", root: current, snapshots });
    }
    snapshots.push(Object.freeze({ path: current, stat }));
  }
  return Object.freeze({ state: "current", root: current, snapshots });
}

function chainStillCurrent(chain) {
  for (const source of chain.snapshots) {
    let current;
    try {
      current = fs.lstatSync(source.path, { bigint: true });
    } catch {
      return false;
    }
    if (!sameStat(source.stat, current)) return false;
  }
  return true;
}

// 只接受current-owner、0600、single-link、no-follow且前后stat稳定的projection source。
function readProjectionSource(file) {
  const euid = currentEuid();
  let before;
  try {
    before = fs.lstatSync(file, { bigint: true });
  } catch {
    return Object.freeze({ safety: "unsafe" });
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.uid !== euid
    || modeOf(before) !== PROJECTION_FILE_MODE
    || before.size <= 0n
    || before.size > BigInt(MAX_PROJECTION_BYTES)
  ) {
    return Object.freeze({ safety: "unsafe" });
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameStat(before, opened)) return Object.freeze({ safety: "unsafe" });
    const bytes = fs.readFileSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (
      bytes.length !== Number(opened.size)
      || !sameStat(opened, afterDescriptor)
      || !sameStat(opened, afterPath)
    ) {
      return Object.freeze({ safety: "unsafe" });
    }
    let record = null;
    let canonical = false;
    try {
      record = validateWindowRuntimeProjection(JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ));
      canonical = bytes.equals(windowRuntimeProjectionCanonicalBytes(record));
    } catch {
      // Preserve the stable bytes so the inventory scanner can classify the
      // owner-invalid entry as unsafe without treating it as replaceable.
    }
    return Object.freeze({
      safety: "safe",
      bytes,
      fileSha256: sha256Bytes(bytes),
      atomicSourceIdentity: sourceIdentity(opened),
      record,
      canonical,
    });
  } catch {
    return Object.freeze({ safety: "unsafe" });
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The stable source classification above is already conservative.
      }
    }
  }
}

function scanProjectionInventory(plan, modePolicy = "strict") {
  const chain = inspectPrivateDirectoryChain(
    plan.workspaceRoot,
    plan.projectionRootRef,
    modePolicy,
  );
  if (chain.state !== "current") {
    const status = chain.state === "missing" ? "missing" : "unsafe";
    return Object.freeze({
      projectionStatus: status,
      unsafeEntryCount: chain.state === "unsafe" ? 1 : 0,
      windows: Object.freeze(plan.entries.map((entry) => Object.freeze({
        windowId: entry.windowId,
        status,
        currentDigest: null,
        expectedDigest: entry.expectedDigest,
        source: null,
      }))),
    });
  }

  let beforeRoot;
  let names;
  try {
    beforeRoot = fs.lstatSync(chain.root, { bigint: true });
    names = fs.readdirSync(chain.root).sort(lexicalCompare);
  } catch {
    return unsafeInventory(plan);
  }
  const expectedNames = new Set(plan.entries.map((entry) => `${entry.windowId}.json`));
  let unsafeEntryCount = names.filter((name) => (
    !WINDOW_FILE_RE.test(name) || !expectedNames.has(name)
  )).length;
  const present = new Set(names);
  const windows = plan.entries.map((entry) => {
    const name = `${entry.windowId}.json`;
    if (!present.has(name)) {
      return Object.freeze({
        windowId: entry.windowId,
        status: "missing",
        currentDigest: null,
        expectedDigest: entry.expectedDigest,
        source: null,
      });
    }
    const source = readProjectionSource(entry.file);
    if (source.safety !== "safe") {
      unsafeEntryCount += 1;
      return Object.freeze({
        windowId: entry.windowId,
        status: "unsafe",
        currentDigest: null,
        expectedDigest: entry.expectedDigest,
        source: null,
      });
    }
    if (
      !source.canonical
      || source.record === null
      || source.record.programId !== plan.programId
      || source.record.hostId !== plan.hostId
      || source.record.windowId !== entry.windowId
    ) {
      unsafeEntryCount += 1;
      return Object.freeze({
        windowId: entry.windowId,
        status: "unsafe",
        currentDigest: source.record?.projectionDigest ?? null,
        expectedDigest: entry.expectedDigest,
        source: null,
      });
    }
    const current = source.canonical
      && source.bytes.equals(entry.bytes);
    return Object.freeze({
      windowId: entry.windowId,
      status: current ? "current" : "stale",
      currentDigest: source.record?.projectionDigest ?? null,
      expectedDigest: entry.expectedDigest,
      source,
    });
  });
  let afterNames;
  let afterRoot;
  try {
    afterNames = fs.readdirSync(chain.root).sort(lexicalCompare);
    afterRoot = fs.lstatSync(chain.root, { bigint: true });
  } catch {
    return unsafeInventory(plan);
  }
  if (
    canonicalJsonDigest(names) !== canonicalJsonDigest(afterNames)
    || !sameStat(beforeRoot, afterRoot)
    || !chainStillCurrent(chain)
  ) {
    return unsafeInventory(plan);
  }
  const projectionStatus = unsafeEntryCount > 0 || windows.some((entry) => entry.status === "unsafe")
    ? "unsafe"
    : windows.every((entry) => entry.status === "current")
      ? "current"
      : windows.every((entry) => entry.status === "missing")
        ? "missing"
        : "stale";
  return Object.freeze({
    projectionStatus,
    unsafeEntryCount,
    windows: Object.freeze(windows),
  });
}

function unsafeInventory(plan) {
  return Object.freeze({
    projectionStatus: "unsafe",
    unsafeEntryCount: 1,
    windows: Object.freeze(plan.entries.map((entry) => Object.freeze({
      windowId: entry.windowId,
      status: "unsafe",
      currentDigest: null,
      expectedDigest: entry.expectedDigest,
      source: null,
    }))),
  });
}

function publicInventory(plan, scan, operation, extras = {}) {
  const windows = scan.windows.map((entry) => Object.freeze({
    windowId: entry.windowId,
    status: entry.status,
    currentDigest: entry.currentDigest,
    expectedDigest: entry.expectedDigest,
  }));
  const inventory = {
    kind: INVENTORY_KIND,
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    operation,
    programId: plan.programId,
    hostId: plan.hostId,
    projectionRootRef: plan.projectionRootRef,
    configDigest: plan.configDigest,
    projectionStatus: scan.projectionStatus,
    windows,
    unsafeEntryCount: scan.unsafeEntryCount,
  };
  const inventoryDigest = canonicalJsonDigest({
    programId: inventory.programId,
    hostId: inventory.hostId,
    projectionRootRef: inventory.projectionRootRef,
    configDigest: inventory.configDigest,
    projectionStatus: inventory.projectionStatus,
    windows,
    unsafeEntryCount: inventory.unsafeEntryCount,
  });
  return deepFreeze({ ...inventory, inventoryDigest, ...extras });
}

// ---------- 普通rebuild的exact CAS与durability closure ----------

function syncCommittedProjectionAttempt(file, expectedBytes, expectedIdentity) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const beforePath = fs.lstatSync(file, { bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || opened.uid !== currentEuid()
      || modeOf(opened) !== PROJECTION_FILE_MODE
      || !commitIdentityMatches(opened, expectedIdentity)
      || !commitIdentityMatches(beforePath, expectedIdentity)
    ) {
      fail(
        "wakeflow-window-runtime-projector-durability",
        "committed window runtime projection changed before durability confirmation",
      );
    }
    const bytes = fs.readFileSync(descriptor);
    if (!bytes.equals(expectedBytes)) {
      fail(
        "wakeflow-window-runtime-projector-durability",
        "committed window runtime projection bytes differ before durability confirmation",
      );
    }
    fs.fsyncSync(descriptor);
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (
      !commitIdentityMatches(afterDescriptor, expectedIdentity)
      || !commitIdentityMatches(afterPath, expectedIdentity)
    ) {
      fail(
        "wakeflow-window-runtime-projector-durability",
        "committed window runtime projection changed during durability confirmation",
      );
    }
  } catch (cause) {
    if (cause instanceof WakeflowWindowRuntimeProjectionError) throw cause;
    fail(
      "wakeflow-window-runtime-projector-durability",
      "window runtime projection target durability could not be confirmed",
    );
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // A later path and parent verification still decides release safety.
      }
    }
  }

  let parentDescriptor = null;
  try {
    parentDescriptor = fs.openSync(
      path.dirname(file),
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0),
    );
    const parent = fs.fstatSync(parentDescriptor, { bigint: true });
    if (!parent.isDirectory()) {
      fail(
        "wakeflow-window-runtime-projector-durability",
        "window runtime projection parent changed before durability confirmation",
      );
    }
    fs.fsyncSync(parentDescriptor);
    const target = fs.lstatSync(file, { bigint: true });
    if (!commitIdentityMatches(target, expectedIdentity)) {
      fail(
        "wakeflow-window-runtime-projector-durability",
        "window runtime projection target changed after parent durability confirmation",
      );
    }
  } catch (cause) {
    if (cause instanceof WakeflowWindowRuntimeProjectionError) throw cause;
    fail(
      "wakeflow-window-runtime-projector-durability",
      "window runtime projection parent durability could not be confirmed",
    );
  } finally {
    if (parentDescriptor !== null) {
      try {
        fs.closeSync(parentDescriptor);
      } catch {
        // The completed fsync and final target check remain the authority.
      }
    }
  }
}

function syncCommittedProjection(file, expectedBytes, expectedIdentity) {
  try {
    syncCommittedProjectionAttempt(file, expectedBytes, expectedIdentity);
    return;
  } catch (cause) {
    if (!(cause instanceof WakeflowWindowRuntimeProjectionError)) throw cause;
  }
  try {
    // The retry is intentionally bounded and uses the exact identity returned
    // by the original commit. It can close a one-shot fsync failure, but it
    // cannot bless an inode replacement or a persistently uncertain target.
    syncCommittedProjectionAttempt(file, expectedBytes, expectedIdentity);
  } catch {
    fail(
      "wakeflow-window-runtime-projector-durability",
      "window runtime projection durability remains unconfirmed after one exact-identity retry",
    );
  }
}

function writeProjection(planEntry, inspectedWindow, workspaceRoot) {
  let result;
  try {
    result = atomicWriteFile({
      root: workspaceRoot,
      target: planEntry.file,
      content: planEntry.bytes,
      expectation: inspectedWindow.status === "missing"
        ? { type: "absent" }
        : { type: "file", sha256: inspectedWindow.source.fileSha256 },
      mode: PROJECTION_FILE_MODE,
      ownership: "whole-file",
      sourceIdentity: inspectedWindow.status === "missing"
        ? null
        : inspectedWindow.source.atomicSourceIdentity,
      captureCommitIdentity: true,
      label: "window runtime projection",
    });
  } catch (cause) {
    const atomicCode = typeof cause?.code === "string" && ATOMIC_CODE_RE.test(cause.code)
      ? cause.code
      : "unknown";
    const cleanupCode = typeof cause?.cleanupError?.code === "string"
      && ATOMIC_CODE_RE.test(cause.cleanupError.code)
      ? cause.cleanupError.code
      : null;
    fail(
      "wakeflow-window-runtime-projector-commit",
      "window runtime projection exact-source commit is ambiguous and requires recovery",
      { windowId: planEntry.windowId, atomicCode, cleanupCode },
    );
  }
  if (!result?.commitIdentity) {
    fail(
      "wakeflow-window-runtime-projector-commit",
      "window runtime projection commit did not return an exact target identity",
      { windowId: planEntry.windowId },
    );
  }
  syncCommittedProjection(planEntry.file, planEntry.bytes, result.commitIdentity);
}

function rebuildOutcome(plan, scan, written) {
  const writeStatus = scan.projectionStatus === "current"
    ? (written.length === 0 ? "current" : "rebuilt")
    : scan.projectionStatus === "unsafe"
      ? "preserved"
      : "stale";
  return publicInventory(plan, scan, "rebuild", {
    writeStatus,
    written: Object.freeze([...written].sort(lexicalCompare)),
  });
}

function buildNormalPlan(workspaceRoot) {
  return buildDesiredPlan(normalSourceContext(workspaceRoot));
}

function inspectCoherently(loadPlan, modePolicy = "strict") {
  let lastPlan = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sourceBefore = loadPlan();
    const scan = scanProjectionInventory(sourceBefore, modePolicy);
    const sourceAfter = loadPlan();
    if (sourceBefore.sourcePlanDigest === sourceAfter.sourcePlanDigest) {
      return Object.freeze({ coherent: true, plan: sourceAfter, scan });
    }
    lastPlan = sourceAfter;
  }
  return Object.freeze({
    coherent: false,
    plan: lastPlan,
    // This final scan is safety evidence only. It must never be exposed as a
    // current result because no matching source-after observation follows it.
    scan: scanProjectionInventory(lastPlan, modePolicy),
  });
}

function coherentNormalInspection(workspaceRoot) {
  return inspectCoherently(() => buildNormalPlan(workspaceRoot));
}

function requireCoherentInspection(inspection) {
  if (!inspection.coherent) {
    fail(
      "wakeflow-window-runtime-projector-source-race",
      "window runtime projection sources did not stabilize across a bounded inspection",
    );
  }
  return inspection;
}

// source race只在namespace仍安全时释放T02 gate；任何unsafe residue升级为显式recovery-required。
function safeSourceRaceClosure(inspection, written) {
  if (inspection.scan.projectionStatus === "unsafe") {
    fail(
      "wakeflow-window-runtime-projector-recovery-required",
      "window runtime projection namespace became unsafe while sources were changing",
    );
  }
  return deepFreeze({
    internalOutcome: "safe-source-race",
    written: [...written].sort(lexicalCompare),
  });
}

function sourceFailureCanRelease(cause) {
  return cause instanceof WakeflowWindowRuntimeProjectionError
    && new Set([
      "wakeflow-window-runtime-projector-config-source",
      "wakeflow-window-runtime-projector-identity-source",
      "wakeflow-window-runtime-projector-root-source",
      "wakeflow-window-runtime-projector-source-race",
    ]).has(cause.code);
}

function safeSourceFailureClosure(plan, written, cause, { exactWindow = null } = {}) {
  if (!sourceFailureCanRelease(cause)) throw cause;
  const scan = scanProjectionInventory(plan);
  if (scan.projectionStatus === "unsafe") {
    fail(
      "wakeflow-window-runtime-projector-recovery-required",
      "window runtime projection namespace is unsafe after a gated source failure",
    );
  }
  if (exactWindow !== null) {
    const currentWindow = scan.windows.find((entry) => entry.windowId === exactWindow.windowId);
    if (!sameObservedProjectionSource(exactWindow, currentWindow)) {
      fail(
        "wakeflow-window-runtime-projector-recovery-required",
        "window runtime projection predecessor capture did not preserve the exact old target",
      );
    }
  }
  return deepFreeze({
    internalOutcome: "safe-source-failure",
    written: [...written].sort(lexicalCompare),
  });
}

function gatedSourceAttempt(loader, plan, written) {
  try {
    return Object.freeze({ status: "loaded", value: loader() });
  } catch (cause) {
    return Object.freeze({
      status: "safe-source-failure",
      value: safeSourceFailureClosure(plan, written, cause),
    });
  }
}

function safePrecommitAtomicFailure(cause) {
  return cause instanceof WakeflowWindowRuntimeProjectionError
    && cause.code === "wakeflow-window-runtime-projector-commit"
    && SAFE_PRECOMMIT_ATOMIC_CODES.has(cause.details.atomicCode)
    && cause.details.cleanupCode === null;
}

function sameObservedProjectionSource(left, right) {
  if (!left?.source || !right?.source || !left.source.bytes.equals(right.source.bytes)) return false;
  return Object.keys(left.source.atomicSourceIdentity).every((field) => (
    left.source.atomicSourceIdentity[field] === right.source.atomicSourceIdentity[field]
  ));
}

function closeSafePrecommitFailure({
  workspaceRoot,
  plan,
  written,
  cause,
  attemptedWindow,
}) {
  if (!safePrecommitAtomicFailure(cause)) throw cause;
  const sourceBefore = buildNormalPlan(workspaceRoot);
  if (sourceBefore.sourcePlanDigest !== plan.sourcePlanDigest) throw cause;
  const scan = scanProjectionInventory(sourceBefore);
  if (scan.projectionStatus === "unsafe") throw cause;
  if (cause.details.atomicCode === "predecessor-capture-failed") {
    const currentWindow = scan.windows.find((entry) => (
      entry.windowId === attemptedWindow.windowId
    ));
    if (!sameObservedProjectionSource(attemptedWindow, currentWindow)) throw cause;
  }
  const sourceAfter = buildNormalPlan(workspaceRoot);
  if (sourceAfter.sourcePlanDigest !== plan.sourcePlanDigest) throw cause;
  return rebuildOutcome(sourceAfter, scan, written);
}

/**
 * 从已落盘strict config和当前宿主binding authority只读检查全部baseline投影。
 * 返回stale/current/unsafe inventory，不刷新文件，也不推断host可发送性。
 */
export function inspectWindowRuntimeProjections(input = {}) {
  const normalized = normalizeInspectInput(input);
  const inspection = requireCoherentInspection(
    coherentNormalInspection(normalized.workspaceRoot),
  );
  return publicInventory(inspection.plan, inspection.scan, "inspect");
}

/**
 * 为初始化、reconfigure、reconcile的candidate model执行只读检查。
 * model/profile由layout descriptor准入，结果仍只描述projection namespace。
 */
export function inspectWindowRuntimeProjectionsForLayout(input = {}) {
  const normalized = normalizeLayoutInput(input);
  const inspection = requireCoherentInspection(inspectCoherently(
    () => buildDesiredPlan(layoutSourceContext(normalized)),
    "layout-repairable",
  ));
  return publicInventory(
    inspection.plan,
    inspection.scan,
    "inspect",
  );
}

// ---------- Maintenance owner plan、aggregate projection 与participant ----------

function normalizeMaintenanceInput(value, { participant = false } = {}) {
  const expected = [
    "workspaceRoot",
    "action",
    "sourceModel",
    "desiredModel",
    "hostProfile",
    ...(participant ? ["confirmedPlan"] : []),
  ];
  const values = exactDataObject(
    value,
    expected,
    [],
    participant
      ? "window runtime maintenance participant input"
      : "window runtime maintenance planning input",
  );
  const workspaceRoot = normalizeWorkspaceRoot(values.workspaceRoot);
  if (!new Set(["fresh-initialize", "reconfigure", "reconcile"]).has(values.action)) {
    fail("wakeflow-window-runtime-maintenance-input", "window runtime maintenance action is invalid");
  }
  let sourceModel;
  let desiredModel;
  let descriptor;
  try {
    sourceModel = values.sourceModel === null
      ? null
      : parseWakeflowConfigV3(values.sourceModel);
    desiredModel = parseWakeflowConfigV3(values.desiredModel);
    descriptor = createWakeflowLayoutDescriptor({
      model: desiredModel,
      hostProfile: values.hostProfile,
    });
  } catch {
    fail("wakeflow-window-runtime-maintenance-input", "maintenance config or host profile is invalid");
  }
  if (values.action === "fresh-initialize" && sourceModel !== null) {
    fail("wakeflow-window-runtime-maintenance-input", "fresh-initialize requires sourceModel=null");
  }
  if (values.action !== "fresh-initialize" && sourceModel === null) {
    fail("wakeflow-window-runtime-maintenance-input", `${values.action} requires a strict source model`);
  }
  if (sourceModel !== null && sourceModel.program.programId !== desiredModel.program.programId) {
    fail("wakeflow-window-runtime-maintenance-input", "source and desired program identities differ");
  }
  if (
    values.action === "reconcile"
    && wakeflowConfigV3Digest(sourceModel) !== wakeflowConfigV3Digest(desiredModel)
  ) {
    fail("wakeflow-window-runtime-maintenance-input", "reconcile cannot change config semantics");
  }
  inspectWorkspaceRoot(workspaceRoot);
  return {
    workspaceRoot,
    action: values.action,
    sourceModel,
    desiredModel,
    configDigest: wakeflowConfigV3Digest(desiredModel),
    rawHostProfile: values.hostProfile,
    profile: descriptor.host,
    ...(participant ? { confirmedPlan: values.confirmedPlan } : {}),
  };
}

function emptyMaintenanceBindingInventory(normalized) {
  const unsigned = {
    kind: "WakeflowWindowBindingInventory",
    schemaVersion: 1,
    programId: normalized.desiredModel.program.programId,
    hostId: normalized.profile.hostId,
    identityRootRef: `.wakeflow-local/runtime/hosts/${normalized.profile.hostDirName}/identity/window-bindings`,
    configDigest: normalized.configDigest,
    status: "empty",
    bindings: [],
  };
  return deepFreeze({ ...unsigned, inventoryDigest: canonicalJsonDigest(unsigned) });
}

function maintenanceSourceContext(normalized) {
  if (normalized.action !== "fresh-initialize") {
    return layoutSourceContext({
      workspaceRoot: normalized.workspaceRoot,
      model: normalized.desiredModel,
      configDigest: normalized.configDigest,
      rawHostProfile: normalized.rawHostProfile,
      profile: normalized.profile,
    });
  }
  const context = {
    workspaceRoot: normalized.workspaceRoot,
    model: normalized.desiredModel,
    indexes: indexesForValidatedModel(normalized.desiredModel),
    configDigest: normalized.configDigest,
    profile: normalized.profile,
    inventory: null,
  };
  context.inventory = durableBindingInventory(context, emptyMaintenanceBindingInventory(normalized));
  return Object.freeze(context);
}

function windowMaintenanceSource(normalized) {
  const context = maintenanceSourceContext(normalized);
  const desired = buildDesiredPlan(context);
  const scan = scanProjectionInventory(desired, "layout-repairable");
  return { context, desired, scan };
}

function windowMaintenanceOperationId(windowId) {
  return `window-runtime-${windowId.slice("window_".length)}`;
}

function windowMaintenanceResourceRef(programId, ref) {
  return `targets/program/${programId}/${ref}`;
}

function windowMaintenanceStageRef(ref, operationId) {
  const directory = path.posix.dirname(ref);
  const basename = path.posix.basename(ref);
  const suffix = canonicalJsonDigest({ operationId, ref }).slice("sha256:".length, "sha256:".length + 16);
  return `${directory}/.${basename}.wakeflow-maintenance-${suffix}`;
}

function windowMaintenanceNode(digest) {
  return { type: "file", mode: "0600", digest };
}

function windowMaintenanceStep(operation, ordinal) {
  const stageRef = windowMaintenanceStageRef(operation.ref, operation.operationId);
  return {
    stepId: operation.operationId,
    ordinal,
    stepKind: "create-or-update",
    source: { ref: operation.resourceRef, ...operation.source },
    staging: {
      ref: windowMaintenanceResourceRef(operation.root.rootId, stageRef),
      ...operation.target,
    },
    final: { ref: operation.resourceRef, ...operation.target },
  };
}

function deriveWindowMaintenancePlan(normalized) {
  const { context, desired, scan } = windowMaintenanceSource(normalized);
  const entryByWindow = new Map(desired.entries.map((entry) => [entry.windowId, entry]));
  const programId = normalized.desiredModel.program.programId;
  const operations = scan.windows.map((window) => {
    const entry = entryByWindow.get(window.windowId);
    const targetDigest = `sha256:${sha256Bytes(entry.bytes)}`;
    const base = {
      operationId: windowMaintenanceOperationId(window.windowId),
      componentId: "window-runtime-projection",
      owner: "runtime-projection-builder",
      windowId: window.windowId,
      ref: windowRuntimeProjectionRef({
        hostDirName: normalized.profile.hostDirName,
        windowId: window.windowId,
      }),
      resourceRef: null,
      root: { kind: "program", rootId: programId, basis: "target", configuredPath: "." },
      projectionDigest: entry.expectedDigest,
    };
    base.resourceRef = windowMaintenanceResourceRef(programId, base.ref);
    if (window.status === "current") {
      const node = windowMaintenanceNode(targetDigest);
      return {
        ...base,
        classification: "managed-current",
        source: node,
        target: node,
        action: "current",
        reasonCode: "window-runtime-current",
      };
    }
    if (window.status === "missing") {
      return {
        ...base,
        classification: "managed-missing",
        source: { type: "absent" },
        target: windowMaintenanceNode(targetDigest),
        action: "create-managed",
        reasonCode: "window-runtime-create",
      };
    }
    if (window.status === "stale" && window.source?.fileSha256) {
      return {
        ...base,
        classification: "managed-stale-known",
        source: windowMaintenanceNode(`sha256:${window.source.fileSha256}`),
        target: windowMaintenanceNode(targetDigest),
        action: "update-managed",
        reasonCode: "window-runtime-refresh",
      };
    }
    return {
      ...base,
      classification: "conflict",
      source: { type: "unsafe", mode: null, digest: null },
      target: null,
      action: "blocked",
      reasonCode: "window-runtime-target-unsafe",
    };
  });
  const blockers = operations
    .filter((entry) => entry.action === "blocked")
    .map((entry) => ({
      blockerId: entry.operationId,
      operationId: entry.operationId,
      resourceRef: entry.resourceRef,
      code: entry.reasonCode,
    }));
  if (scan.projectionStatus === "unsafe" && blockers.length === 0) {
    blockers.push({
      blockerId: "window-runtime-inventory-unsafe",
      operationId: null,
      resourceRef: desired.projectionRootRef,
      code: "window-runtime-inventory-unsafe",
    });
  }
  const steps = operations
    .filter((entry) => new Set(["create-managed", "update-managed"]).has(entry.action))
    .map(windowMaintenanceStep);
  const payload = {
    kind: WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_KIND,
    schemaVersion: WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_VERSION,
    action: normalized.action,
    status: blockers.length === 0 ? "ready" : "blocked",
    programId,
    hostId: normalized.profile.hostId,
    hostDirName: normalized.profile.hostDirName,
    sourceModelDigest: normalized.sourceModel === null
      ? null
      : wakeflowConfigV3Digest(normalized.sourceModel),
    desiredModelDigest: wakeflowConfigV3Digest(normalized.desiredModel),
    identityInventoryDigest: context.inventory.inventoryDigest,
    sourcePlanDigest: desired.sourcePlanDigest,
    operations,
    blockers,
    steps,
  };
  return {
    plan: validateWindowRuntimeMaintenancePlanInternal({
      schemaId: WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_ID,
      payload,
    }),
    desired,
  };
}

function validateWindowMaintenanceNode(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!plainObject(value) || typeof value.type !== "string") {
    fail("wakeflow-window-runtime-maintenance-plan", `${label} must be one resource node`);
  }
  if (value.type === "absent") {
    exactDataObject(value, ["type"], [], label);
    return value;
  }
  if (value.type === "unsafe") {
    exactDataObject(value, ["type", "mode", "digest"], [], label);
    if (value.mode !== null || value.digest !== null) {
      fail("wakeflow-window-runtime-maintenance-plan", `${label} unsafe node must be redacted`);
    }
    return value;
  }
  exactDataObject(value, ["type", "mode", "digest"], [], label);
  if (value.type !== "file" || value.mode !== "0600" || !DIGEST_RE.test(value.digest)) {
    fail("wakeflow-window-runtime-maintenance-plan", `${label} file node is invalid`);
  }
  return value;
}

function assertWindowMaintenanceOperationSemantics(operation, payload) {
  const expectedOperationId = windowMaintenanceOperationId(operation.windowId);
  const expectedRoot = {
    kind: "program",
    rootId: payload.programId,
    basis: "target",
    configuredPath: ".",
  };
  const semantics = {
    current: {
      classification: "managed-current",
      reasonCode: "window-runtime-current",
      sourceType: "file",
      targetType: "file",
    },
    "create-managed": {
      classification: "managed-missing",
      reasonCode: "window-runtime-create",
      sourceType: "absent",
      targetType: "file",
    },
    "update-managed": {
      classification: "managed-stale-known",
      reasonCode: "window-runtime-refresh",
      sourceType: "file",
      targetType: "file",
    },
    blocked: {
      classification: "conflict",
      reasonCode: "window-runtime-target-unsafe",
      sourceType: "unsafe",
      targetType: null,
    },
  }[operation.action];
  if (
    !semantics
    || operation.operationId !== expectedOperationId
    || canonicalJson(operation.root) !== canonicalJson(expectedRoot)
    || operation.classification !== semantics.classification
    || operation.reasonCode !== semantics.reasonCode
    || operation.source.type !== semantics.sourceType
    || (operation.target?.type ?? null) !== semantics.targetType
    || (
      operation.action === "current"
      && canonicalJson(operation.source) !== canonicalJson(operation.target)
    )
    || (
      operation.action === "update-managed"
      && operation.source.digest === operation.target.digest
    )
  ) {
    fail(
      "wakeflow-window-runtime-maintenance-plan",
      "maintenance operation semantics are not derived from its action",
    );
  }
}

// codec不仅校验shape，还重建action→classification/source/target/step/blocker关系，防止确认伪造语义。
function validateWindowRuntimeMaintenancePlanInternal(value) {
  let plan;
  try {
    plan = JSON.parse(canonicalJson(value));
  } catch {
    fail("wakeflow-window-runtime-maintenance-plan", "maintenance plan must be canonical JSON data");
  }
  exactDataObject(plan, ["schemaId", "payload"], [], "window runtime maintenance plan");
  if (plan.schemaId !== WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_ID) {
    fail("wakeflow-window-runtime-maintenance-plan", "maintenance schema identity is invalid");
  }
  const payloadKeys = [
    "kind", "schemaVersion", "action", "status", "programId", "hostId", "hostDirName",
    "sourceModelDigest", "desiredModelDigest", "identityInventoryDigest", "sourcePlanDigest",
    "operations", "blockers", "steps",
  ];
  exactDataObject(plan.payload, payloadKeys, [], "window runtime maintenance payload");
  const payload = plan.payload;
  if (
    payload.kind !== WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_KIND
    || payload.schemaVersion !== WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_VERSION
    || !new Set(["fresh-initialize", "reconfigure", "reconcile"]).has(payload.action)
    || !DIGEST_RE.test(payload.desiredModelDigest)
    || !DIGEST_RE.test(payload.identityInventoryDigest)
    || !DIGEST_RE.test(payload.sourcePlanDigest)
    || (payload.sourceModelDigest !== null && !DIGEST_RE.test(payload.sourceModelDigest))
    || !Array.isArray(payload.operations)
    || !Array.isArray(payload.blockers)
    || !Array.isArray(payload.steps)
  ) {
    fail("wakeflow-window-runtime-maintenance-plan", "maintenance metadata is invalid");
  }
  const operationIds = new Set();
  let previousWindowId = null;
  for (const operation of payload.operations) {
    const keys = [
      "operationId", "componentId", "owner", "windowId", "ref", "resourceRef", "root",
      "projectionDigest", "classification", "source", "target", "action", "reasonCode",
    ];
    exactDataObject(operation, keys, [], "window runtime maintenance operation");
    if (
      typeof operation.operationId !== "string"
      || operationIds.has(operation.operationId)
      || operation.componentId !== "window-runtime-projection"
      || operation.owner !== "runtime-projection-builder"
      || (previousWindowId !== null && lexicalCompare(previousWindowId, operation.windowId) >= 0)
      || operation.ref !== windowRuntimeProjectionRef({
        hostDirName: payload.hostDirName,
        windowId: operation.windowId,
      })
      || operation.resourceRef !== windowMaintenanceResourceRef(payload.programId, operation.ref)
      || !DIGEST_RE.test(operation.projectionDigest)
      || !new Set(["current", "create-managed", "update-managed", "blocked"]).has(operation.action)
    ) {
      fail("wakeflow-window-runtime-maintenance-plan", "maintenance operation is invalid");
    }
    operationIds.add(operation.operationId);
    previousWindowId = operation.windowId;
    validateWindowMaintenanceNode(operation.source, "window runtime source");
    validateWindowMaintenanceNode(operation.target, "window runtime target", { nullable: true });
    exactDataObject(
      operation.root,
      ["kind", "rootId", "basis", "configuredPath"],
      [],
      "window runtime maintenance root",
    );
    assertWindowMaintenanceOperationSemantics(operation, payload);
  }
  const expectedSteps = payload.operations
    .filter((entry) => new Set(["create-managed", "update-managed"]).has(entry.action))
    .map(windowMaintenanceStep);
  if (canonicalJson(payload.steps) !== canonicalJson(expectedSteps)) {
    fail("wakeflow-window-runtime-maintenance-plan", "maintenance steps are not derived");
  }
  for (const blocker of payload.blockers) {
    exactDataObject(
      blocker,
      ["blockerId", "operationId", "resourceRef", "code"],
      [],
      "window runtime maintenance blocker",
    );
  }
  const blockedOperations = payload.operations.filter((entry) => entry.action === "blocked");
  const expectedBlockers = blockedOperations.length > 0
    ? blockedOperations.map((entry) => ({
      blockerId: entry.operationId,
      operationId: entry.operationId,
      resourceRef: entry.resourceRef,
      code: entry.reasonCode,
    }))
    : payload.blockers.length === 0
      ? []
      : [{
        blockerId: "window-runtime-inventory-unsafe",
        operationId: null,
        resourceRef: `.wakeflow-local/runtime/hosts/${payload.hostDirName}/projections/window-runtime`,
        code: "window-runtime-inventory-unsafe",
      }];
  if (canonicalJson(payload.blockers) !== canonicalJson(expectedBlockers)) {
    fail("wakeflow-window-runtime-maintenance-plan", "maintenance blockers are not derived");
  }
  if (payload.status !== (payload.blockers.length === 0 ? "ready" : "blocked")) {
    fail("wakeflow-window-runtime-maintenance-plan", "maintenance status is not derived");
  }
  return deepFreeze(plan);
}

/**
 * 冻结window-runtime owner的portable、无绝对路径维护计划；preview阶段只读。
 */
export function planWindowRuntimeProjectionMaintenance(value) {
  const normalized = normalizeMaintenanceInput(value);
  const plan = deriveWindowMaintenancePlan(normalized).plan;
  if (canonicalJson(plan).includes(normalized.workspaceRoot)) {
    fail("wakeflow-window-runtime-maintenance-private", "maintenance plan leaked its workspace root");
  }
  return plan;
}

/** 校验外部回传的owner plan及全部派生关系，不执行workspace effect。 */
export function validateWindowRuntimeProjectionMaintenancePlan(value) {
  return validateWindowRuntimeMaintenancePlanInternal(value);
}

/**
 * 把owner plan映射为aggregate maintenance的component/action/check/step视图；
 * 它不执行文件写入，也不改变owner plan中的领域判断。
 */
export function projectWindowRuntimeProjectionMaintenance(value) {
  const input = exactDataObject(
    value,
    ["plan", "transactionOffset"],
    [],
    "window runtime maintenance aggregate input",
  );
  const plan = validateWindowRuntimeMaintenancePlanInternal(input.plan);
  if (!Number.isSafeInteger(input.transactionOffset) || input.transactionOffset < 0) {
    fail("wakeflow-window-runtime-maintenance-input", "transactionOffset must be a non-negative safe integer");
  }
  const planDigest = canonicalJsonDigest(plan);
  const stepIndex = new Map(plan.payload.steps.map((entry, index) => [entry.stepId, index]));
  const dependencyChecks = plan.payload.blockers.map((entry) => ({
    checkId: `window-runtime-blocked-${entry.blockerId}`,
    componentId: "window-runtime-projection",
    owner: "runtime-projection-builder",
    subject: { kind: "resource", value: entry.resourceRef },
    status: "blocked",
    code: entry.code,
    evidence: [{ kind: "owner-plan", ref: entry.resourceRef, digest: planDigest }],
  }));
  return deepFreeze({
    components: [{
      componentId: "window-runtime-projection",
      owner: "runtime-projection-builder",
      ownerPlanDigest: planDigest,
    }],
    filesystemActions: plan.payload.operations
      .filter((entry) => entry.action !== "blocked")
      .map((entry) => {
        const index = stepIndex.get(entry.operationId);
        return {
          actionId: entry.operationId,
          componentId: entry.componentId,
          owner: entry.owner,
          root: entry.root,
          ref: entry.ref,
          resourceRef: entry.resourceRef,
          classification: entry.classification,
          source: entry.source,
          target: entry.target,
          action: entry.action,
          authorization: { kind: entry.action === "current" ? "none" : "wakeflow-owned" },
          reasonCode: entry.reasonCode,
          stepId: index === undefined ? null : entry.operationId,
          commitOrder: index === undefined ? null : input.transactionOffset + index,
        };
      }),
    dependencyChecks,
    preserved: [],
    deferredOwnerActions: dependencyChecks.map((entry) => ({
      deferredId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      action: "repair-window-runtime-projection",
      subject: entry.subject,
      prerequisiteCheckIds: [entry.checkId],
      reasonCode: entry.code,
    })),
    blockers: dependencyChecks.map((entry) => ({
      blockerId: entry.checkId,
      componentId: entry.componentId,
      owner: entry.owner,
      subject: entry.subject,
      code: entry.code,
      dependencyCheckId: entry.checkId,
    })),
    steps: plan.payload.steps.map((step, index) => ({
      ...step,
      ordinal: input.transactionOffset + index,
    })),
  });
}

function assertWindowMaintenanceConfigAuthority(normalized, context = null) {
  try {
    assertWakeflowConfigV3TransitionAuthority({
      workspaceRoot: normalized.workspaceRoot,
      action: normalized.action,
      sourceModel: normalized.sourceModel,
      desiredModel: normalized.desiredModel,
      context,
    });
  } catch (cause) {
    fail("wakeflow-window-runtime-maintenance-config", "strict config authority is unavailable", { cause });
  }
}

function assertWindowMaintenanceNamespace(normalized, confirmedPlan) {
  const projectionRoot = path.join(
    normalized.workspaceRoot,
    ...`.wakeflow-local/runtime/hosts/${normalized.profile.hostDirName}/projections/window-runtime`.split("/"),
  );
  let names;
  try {
    const stat = fs.lstatSync(projectionRoot, { bigint: true });
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.uid !== currentEuid()
      || modeOf(stat) !== PRIVATE_DIRECTORY_MODE
    ) fail("wakeflow-window-runtime-maintenance-stale", "projection namespace is unsafe");
    names = fs.readdirSync(projectionRoot);
  } catch (cause) {
    if (cause?.code === "ENOENT") return;
    if (cause instanceof WakeflowWindowRuntimeProjectionError) throw cause;
    fail("wakeflow-window-runtime-maintenance-stale", "projection namespace cannot be inspected");
  }
  const allowed = new Set();
  for (const operation of confirmedPlan.payload.operations) {
    allowed.add(path.posix.basename(operation.ref));
    allowed.add(path.posix.basename(windowMaintenanceStageRef(operation.ref, operation.operationId)));
  }
  if (names.some((name) => !allowed.has(name))) {
    fail("wakeflow-window-runtime-maintenance-stale", "projection namespace contains unknown residue");
  }
}

function assertFreshWindowIdentity(normalized) {
  if (normalized.action !== "fresh-initialize") return;
  let inventory;
  try {
    inventory = inspectWindowBindingInventoryForLayout({
      workspaceRoot: normalized.workspaceRoot,
      programId: normalized.desiredModel.program.programId,
      hostId: normalized.profile.hostId,
      configDigest: normalized.configDigest,
      windowIds: normalized.desiredModel.topology.windows.map((entry) => entry.windowId),
      hostProfile: normalized.rawHostProfile,
    });
  } catch {
    fail("wakeflow-window-runtime-maintenance-stale", "fresh identity namespace is unavailable");
  }
  if (inventory.bindings.length !== 0 || !new Set(["missing", "empty"]).has(inventory.status)) {
    fail("wakeflow-window-runtime-maintenance-stale", "fresh identity namespace is no longer empty");
  }
}

function assertWindowMaintenanceSource(normalized, confirmedPlan, context = null) {
  assertWindowMaintenanceConfigAuthority(normalized, context);
  assertFreshWindowIdentity(normalized);
  assertWindowMaintenanceNamespace(normalized, confirmedPlan);
  const current = deriveWindowMaintenancePlan(normalized).plan;
  if (
    current.payload.sourcePlanDigest !== confirmedPlan.payload.sourcePlanDigest
    || current.payload.identityInventoryDigest !== confirmedPlan.payload.identityInventoryDigest
  ) {
    fail("wakeflow-window-runtime-maintenance-stale", "window runtime source changed since confirmation");
  }
}

/**
 * 为已确认且ready的owner plan构造M3物理participant。
 * participant在gate内重验config、identity、namespace和sourcePlanDigest，再物化exact bytes。
 */
export function createWindowRuntimeProjectionMutationParticipant(value) {
  const normalized = normalizeMaintenanceInput(value, { participant: true });
  const confirmedPlan = validateWindowRuntimeMaintenancePlanInternal(normalized.confirmedPlan);
  if (confirmedPlan.payload.status !== "ready") {
    fail("wakeflow-window-runtime-maintenance-blocked", "a blocked runtime plan cannot create a participant");
  }
  const derived = deriveWindowMaintenancePlan(normalized);
  const entryByWindow = new Map(derived.desired.entries.map((entry) => [entry.windowId, entry]));
  const operationById = new Map(confirmedPlan.payload.operations.map((entry) => [entry.operationId, entry]));
  const privateOperations = confirmedPlan.payload.steps.map((step) => {
    const operation = operationById.get(step.stepId);
    const entry = entryByWindow.get(operation.windowId);
    if (!entry || `sha256:${sha256Bytes(entry.bytes)}` !== operation.target.digest) {
      fail("wakeflow-window-runtime-maintenance-stale", "runtime target bytes cannot be reconstructed");
    }
    const stageRef = windowMaintenanceStageRef(operation.ref, operation.operationId);
    return {
      stepId: step.stepId,
      kind: "file",
      targetPath: path.join(normalized.workspaceRoot, ...operation.ref.split("/")),
      stagePath: path.join(normalized.workspaceRoot, ...stageRef.split("/")),
      targetBytes: Buffer.from(entry.bytes),
      maxFileBytes: MAX_PROJECTION_BYTES,
    };
  });
  return createWakeflowTrackedMaterializationParticipant({
    workspaceRoot: normalized.workspaceRoot,
    confirmedPlan,
    validatePlan: validateWindowRuntimeMaintenancePlanInternal,
    deriveCurrentPlan({ context }) {
      assertWindowMaintenanceSource(normalized, confirmedPlan, context);
      return deriveWindowMaintenancePlan(normalized).plan;
    },
    validateAuthority({ context }) {
      assertWindowMaintenanceSource(normalized, confirmedPlan, context);
      return { valid: true };
    },
    privateOperations,
    closureName: "window-runtime-projection-closure",
  });
}

/**
 * 在普通T02 runtime mutation中把missing/stale baseline投影收敛到当前派生结果。
 * unsafe目标原样保留；部分提交后的source变化只在可证明安全时释放，否则要求恢复。
 */
export async function rebuildWindowRuntimeProjections(input = {}) {
  const normalized = normalizeRebuildInput(input);
  const before = requireCoherentInspection(coherentNormalInspection(normalized.workspaceRoot));
  const beforePlan = before.plan;
  const beforeScan = before.scan;
  if (beforeScan.projectionStatus === "unsafe") {
    return rebuildOutcome(beforePlan, beforeScan, []);
  }
  if (beforeScan.projectionStatus === "current") {
    return rebuildOutcome(beforePlan, beforeScan, []);
  }

  let result;
  try {
    result = await withWakeflowRuntimeMutation({
      workspaceRoot: normalized.workspaceRoot,
      operationKind: "window-runtime-projection-rebuild",
      domainOwner: "runtime-projection-builder",
      ...(normalized.acquireTimeoutMs === undefined
        ? {}
        : { acquireTimeoutMs: normalized.acquireTimeoutMs }),
    }, async (context) => {
      assertWakeflowMutationContext({
        workspaceRoot: normalized.workspaceRoot,
        context,
        mode: "runtime-mutation",
      });
      const admittedAttempt = gatedSourceAttempt(
        () => coherentNormalInspection(normalized.workspaceRoot),
        beforePlan,
        [],
      );
      if (admittedAttempt.status !== "loaded") return admittedAttempt.value;
      const admitted = admittedAttempt.value;
      if (!admitted.coherent) return safeSourceRaceClosure(admitted, []);
      let { plan, scan } = admitted;
      if (scan.projectionStatus === "unsafe" || scan.projectionStatus === "current") {
        return rebuildOutcome(plan, scan, []);
      }

      const written = [];
      for (const entry of plan.entries) {
        const current = scan.windows.find((window) => window.windowId === entry.windowId);
        if (current.status === "current") continue;
        if (current.status === "unsafe") return rebuildOutcome(plan, scan, written);

        const checkpointAttempt = gatedSourceAttempt(
          () => buildNormalPlan(normalized.workspaceRoot),
          plan,
          written,
        );
        if (checkpointAttempt.status !== "loaded") return checkpointAttempt.value;
        const checkpointPlan = checkpointAttempt.value;
        if (checkpointPlan.sourcePlanDigest !== plan.sourcePlanDigest) {
          const changedAttempt = gatedSourceAttempt(
            () => coherentNormalInspection(normalized.workspaceRoot),
            plan,
            written,
          );
          if (changedAttempt.status !== "loaded") return changedAttempt.value;
          const changed = changedAttempt.value;
          if (!changed.coherent) return safeSourceRaceClosure(changed, written);
          if (changed.scan.projectionStatus === "unsafe") {
            fail(
              "wakeflow-window-runtime-projector-recovery-required",
              "window runtime projection inventory became unsafe during a gated rebuild",
            );
          }
          return rebuildOutcome(changed.plan, changed.scan, written);
        }
        try {
          writeProjection(entry, current, normalized.workspaceRoot);
        } catch (cause) {
          try {
            return closeSafePrecommitFailure({
              workspaceRoot: normalized.workspaceRoot,
              plan,
              written,
              cause,
              attemptedWindow: current,
            });
          } catch (closureCause) {
            if (safePrecommitAtomicFailure(cause) && sourceFailureCanRelease(closureCause)) {
              return safeSourceFailureClosure(plan, written, closureCause, {
                exactWindow: cause.details.atomicCode === "predecessor-capture-failed"
                  ? current
                  : null,
              });
            }
            throw closureCause;
          }
        }
        written.push(entry.windowId);
        scan = scanProjectionInventory(plan);
        if (scan.projectionStatus === "unsafe") {
          fail(
            "wakeflow-window-runtime-projector-recovery-required",
            "window runtime projection inventory became unsafe after a gated commit",
          );
        }
      }

      const completedAttempt = gatedSourceAttempt(
        () => coherentNormalInspection(normalized.workspaceRoot),
        plan,
        written,
      );
      if (completedAttempt.status !== "loaded") return completedAttempt.value;
      const completed = completedAttempt.value;
      if (!completed.coherent) return safeSourceRaceClosure(completed, written);
      if (completed.scan.projectionStatus === "unsafe") {
        fail(
          "wakeflow-window-runtime-projector-recovery-required",
          "window runtime projection inventory is unsafe after its gated rebuild",
        );
      }
      return rebuildOutcome(completed.plan, completed.scan, written);
    });
    if (result?.internalOutcome === "safe-source-race") {
      fail(
        "wakeflow-window-runtime-projector-source-race",
        "window runtime projection sources did not stabilize after a safely closed rebuild",
        { writtenCount: result.written.length },
      );
    }
    if (result?.internalOutcome === "safe-source-failure") {
      fail(
        "wakeflow-window-runtime-projector-source-failure",
        "window runtime projection source became unavailable after a safely closed rebuild",
        { writtenCount: result.written.length },
      );
    }
  } catch (cause) {
    if (cause instanceof WakeflowWindowRuntimeProjectionError) throw cause;
    const category = /reentrant|nested/iu.test(`${cause?.code ?? ""} ${cause?.message ?? ""}`)
      ? "reentrant"
      : /busy|lock|admission/iu.test(`${cause?.code ?? ""} ${cause?.message ?? ""}`)
        ? "busy"
        : /recovery/iu.test(`${cause?.code ?? ""} ${cause?.message ?? ""}`)
          ? "recovery-required"
          : "failed";
    fail(
      `wakeflow-window-runtime-projector-mutation-${category}`,
      `window runtime projection mutation ${category}`,
    );
  }
  return result;
}
