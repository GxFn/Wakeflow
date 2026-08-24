import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";
import { createWakeflowLayoutDescriptor } from "./wakeflow-layout-descriptor.mjs";
import { renderSupportRoleMemoryCandidate } from "./wakeflow-rule-model.mjs";

/**
 * Design/Test support surface的纯语义候选构建器。
 *
 * 职责导航：
 * 1. 关联strict config、host profile与同源layout descriptor。
 * 2. 为wakeflow-managed surface生成memory whole-file与能力目录候选。
 * 3. 为external managed-block surface只生成可交给外层merge owner的component候选。
 * 4. owner-managed surface明确零操作；本模块不读取或修改filesystem。
 *
 * 物理root准入、existing footprint分类、M3 step、CAS/recovery与managed-block合并均归外层owner。
 */

export class WakeflowSupportMaterializationError extends Error {
  constructor(code, message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowSupportMaterializationError";
    this.code = code;
    this.path = path;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, at, message, details = {}) {
  throw new WakeflowSupportMaterializationError(code, `${message} at ${at}`, {
    path: at,
    details,
  });
}

function exactObject(value, at, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-support-materialization-type", at, "expected a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-support-materialization-type", at, "expected a plain object");
  }
  const allowedSet = new Set(allowed);
  const keys = Reflect.ownKeys(value);
  const unknown = keys.find((key) => typeof key !== "string" || !allowedSet.has(key));
  if (unknown) {
    fail("wakeflow-support-materialization-unknown", `${at}/${String(unknown)}`, `unknown field ${String(unknown)}`, { allowed });
  }
  for (const key of required) {
    if (!keys.includes(key)) {
      fail("wakeflow-support-materialization-missing", `${at}/${key}`, `missing required field ${key}`);
    }
  }
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) {
      fail("wakeflow-support-materialization-unknown", `${at}/${key}`, `non-enumerable field ${key} is not allowed`, { allowed });
    }
    if (!Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-support-materialization-type", `${at}/${key}`, `accessor field ${key} is not allowed`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalSnapshot(value, at, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-support-materialization-type",
      at,
      `${label} must be canonical plain data without accessors, symbols, or hidden fields`,
      { causeCode: cause?.code ?? null },
    );
  }
  return null;
}

// 完整 host profile 是宿主扩展 facade；这里只被动读取本领域拥有的展示名称。
// 其他静态能力字段继续交给 host-capability 的窄投影处理，不能把宿主函数误当 JSON。
function hostPresentationName(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-support-materialization-host", "$/hostProfile", "host profile must be an object facade");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "hostName");
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail(
      "wakeflow-support-materialization-host",
      "$/hostProfile/hostName",
      "host presentation name must be an enumerable data property",
    );
  }
  const hostName = descriptor.value;
  if (
    typeof hostName !== "string"
    || !hostName.trim()
    || hostName !== hostName.trim()
    || /[\r\n\0]/u.test(hostName)
  ) {
    fail(
      "wakeflow-support-materialization-host",
      "$/hostProfile/hostName",
      "host profile requires a canonical single-line presentation name",
    );
  }
  return hostName;
}

function descriptorEntry(descriptor, key, {
  pathKind,
  owner = null,
  lifecycle = null,
  required = true,
} = {}) {
  const matches = descriptor.entries.filter((entry) => entry.key === key);
  if (matches.length === 0 && !required) return null;
  if (matches.length !== 1) {
    fail(
      "wakeflow-support-materialization-layout",
      `$/layoutDescriptor/entries/${key}`,
      `expected exactly one layout entry for ${key}`,
      { count: matches.length },
    );
  }
  const entry = matches[0];
  if (pathKind && entry.pathKind !== pathKind) {
    fail("wakeflow-support-materialization-layout", `$/layoutDescriptor/entries/${key}`, `${key} has the wrong path kind`, {
      expected: pathKind,
      actual: entry.pathKind,
    });
  }
  if (owner && entry.owner !== owner) {
    fail("wakeflow-support-materialization-layout", `$/layoutDescriptor/entries/${key}`, `${key} has the wrong owner`, {
      expected: owner,
      actual: entry.owner,
    });
  }
  if (lifecycle && entry.lifecycle !== lifecycle) {
    fail("wakeflow-support-materialization-layout", `$/layoutDescriptor/entries/${key}`, `${key} has the wrong lifecycle`, {
      expected: lifecycle,
      actual: entry.lifecycle,
    });
  }
  return entry;
}

function assertDescriptorMatches({ model, layoutDescriptor, hostProfile }) {
  if (!layoutDescriptor || layoutDescriptor.kind !== "WakeflowLayoutDescriptor" || !Array.isArray(layoutDescriptor.entries)) {
    fail("wakeflow-support-materialization-layout", "$/layoutDescriptor", "expected a WakeflowLayoutDescriptor");
  }
  const expected = createWakeflowLayoutDescriptor({ model, hostProfile });
  if (layoutDescriptor.configDigest !== wakeflowConfigV3Digest(model)) {
    fail(
      "wakeflow-support-materialization-layout",
      "$/layoutDescriptor/configDigest",
      "layout descriptor belongs to a different config",
      { expected: wakeflowConfigV3Digest(model), actual: layoutDescriptor.configDigest ?? null },
    );
  }
  let actualDigest;
  let expectedDigest;
  try {
    actualDigest = canonicalJsonDigest(layoutDescriptor);
    expectedDigest = canonicalJsonDigest(expected);
  } catch (cause) {
    fail(
      "wakeflow-support-materialization-layout",
      "$/layoutDescriptor",
      "layout descriptor must be canonical plain data",
      { causeCode: cause?.code ?? null },
    );
  }
  if (
    layoutDescriptor.layoutDigest !== expected.layoutDigest
    || actualDigest !== expectedDigest
  ) {
    fail(
      "wakeflow-support-materialization-layout",
      "$/layoutDescriptor/layoutDigest",
      "layout descriptor does not match the config and host profile",
      { expected: expected.layoutDigest, actual: layoutDescriptor.layoutDigest ?? null },
    );
  }
  return expected;
}

function commonMemoryPaths(descriptor, surfaceId) {
  return {
    supportRoot: descriptorEntry(descriptor, `support.${surfaceId}.root`, { pathKind: "directory" }).path,
    memory: descriptorEntry(descriptor, `support.${surfaceId}.memory`, {
      pathKind: "file",
      owner: "instruction-renderer",
    }).path,
    programMemory: descriptorEntry(descriptor, "workspace.memory", {
      pathKind: "file",
      owner: "instruction-renderer",
      lifecycle: "managed-whole-file",
    }).path,
    activeIndex: descriptorEntry(descriptor, "active.index", { pathKind: "file", owner: "active-projector" }).path,
    activeStatus: descriptorEntry(descriptor, "active.current.status", { pathKind: "file", owner: "active-projector" }).path,
    activeCurrent: descriptorEntry(descriptor, "active.current", { pathKind: "directory" }).path,
    requirements: descriptorEntry(descriptor, "ledger.requirements", {
      pathKind: "directory",
      owner: "requirement-promotion-service",
    }).path,
  };
}

function memoryCandidate({ model, descriptor, profile, hostProfile, role, surface, window }) {
  const internal = surface.ownership === "wakeflow-managed";
  const prefix = `support.${surface.surfaceId}`;
  const paths = {
    ...commonMemoryPaths(descriptor, surface.surfaceId),
    drafts: role === "design" && internal
      ? descriptorEntry(descriptor, `${prefix}.drafts`, { pathKind: "directory", owner: "design-surface" }).path
      : null,
    harnesses: role === "test" && internal
      ? descriptorEntry(descriptor, `${prefix}.harnesses`, { pathKind: "directory", owner: "test-surface" }).path
      : null,
    fixtures: role === "test" && internal
      ? descriptorEntry(descriptor, `${prefix}.fixtures`, { pathKind: "directory", owner: "test-surface" }).path
      : null,
  };
  return {
    paths,
    artifact: renderSupportRoleMemoryCandidate({
      programId: model.program.programId,
      surfaceId: surface.surfaceId,
      windowId: window.windowId,
      role,
      surfaceOwnership: surface.ownership,
      instructionManagement: internal ? null : surface.instructionManagement,
      host: {
        hostId: profile.hostId,
        hostName: hostProfile.hostName,
        memoryFile: profile.memoryFile,
      },
      paths,
    }),
  };
}

function internalOperations({ role, surface, window, paths, artifact }) {
  const prefix = `support.${surface.surfaceId}`;
  const directories = role === "design"
    ? [{ key: `${prefix}.drafts`, path: paths.drafts, owner: "design-surface" }]
    : [
        { key: `${prefix}.harnesses`, path: paths.harnesses, owner: "test-surface" },
        { key: `${prefix}.fixtures`, path: paths.fixtures, owner: "test-surface" },
      ];
  return [
    {
      kind: "write-managed-file",
      path: paths.memory,
      owner: "instruction-renderer",
      lifecycle: "managed-whole-file",
      role,
      surfaceId: surface.surfaceId,
      windowId: window.windowId,
      artifact,
    },
    ...directories.map((directory) => ({
      kind: "ensure-directory",
      path: directory.path,
      owner: directory.owner,
      lifecycle: "static-capability-root",
      role,
      surfaceId: surface.surfaceId,
      preserveContents: true,
    })),
  ];
}

function managedBlockOperation({ model, role, surface, window, paths, artifact }) {
  return {
    kind: "provide-managed-component",
    path: paths.memory,
    owner: "instruction-renderer",
    lifecycle: "mixed-owned-managed-block",
    role,
    surfaceId: surface.surfaceId,
    windowId: window.windowId,
    marker: {
      schemaVersion: 1,
      kind: "WakeflowSupportRoleMemoryBlock",
      programId: model.program.programId,
      surfaceId: surface.surfaceId,
    },
    artifact,
  };
}

/** 构建support surface纯候选计划；merge、物理准入、CAS、授权和commit均由外层owner负责。 */
export function planWakeflowSupportMaterialization(value) {
  const input = exactObject(value, "$", ["model", "layoutDescriptor", "hostProfile"]);
  const modelInput = canonicalSnapshot(input.model, "$/model", "config model");
  const layoutDescriptor = canonicalSnapshot(
    input.layoutDescriptor,
    "$/layoutDescriptor",
    "layout descriptor",
  );
  const hostProfile = input.hostProfile;
  const model = parseWakeflowConfigV3(modelInput);
  const indexes = buildWakeflowConfigV3Indexes(model);
  const profile = normalizeWakeflowHostCapabilityProfile(hostProfile);
  const hostName = hostPresentationName(hostProfile);
  const descriptor = assertDescriptorMatches({
    model,
    layoutDescriptor,
    hostProfile,
  });
  const operations = [];
  const surfaces = [];
  for (const [role, window] of [
    ["design", indexes.designWindow],
    ["test", indexes.testWindow],
  ]) {
    const surface = indexes.surfaceById[window.root.surfaceId];
    if (!surface || surface.capability !== role) {
      fail("wakeflow-support-materialization-model", `$/topology/windows/${window.windowId}`, `${role} window has no matching support surface`);
    }
    const operationStart = operations.length;
    if (surface.ownership === "wakeflow-managed") {
      const candidate = memoryCandidate({
        model,
        descriptor,
        profile,
        hostProfile: { hostName },
        role,
        surface,
        window,
      });
      operations.push(...internalOperations({ role, surface, window, ...candidate }));
    } else if (surface.instructionManagement === "managed-block") {
      const candidate = memoryCandidate({
        model,
        descriptor,
        profile,
        hostProfile: { hostName },
        role,
        surface,
        window,
      });
      operations.push(managedBlockOperation({ model, role, surface, window, ...candidate }));
    } else if (surface.instructionManagement !== "owner-managed") {
      fail(
        "wakeflow-support-materialization-model",
        `$/topology/supportSurfaces/${surface.surfaceId}/instructionManagement`,
        "external support surface has an unknown instruction management policy",
      );
    }
    surfaces.push({
      role,
      surfaceId: surface.surfaceId,
      windowId: window.windowId,
      ownership: surface.ownership,
      instructionManagement: surface.ownership === "external-owned" ? surface.instructionManagement : null,
      operationCount: operations.length - operationStart,
    });
  }
  const plan = {
    kind: "WakeflowSupportMaterializationPlan",
    schemaVersion: 1,
    programId: model.program.programId,
    configDigest: descriptor.configDigest,
    layoutDigest: descriptor.layoutDigest,
    host: {
      hostId: profile.hostId,
      hostName,
      memoryFile: profile.memoryFile,
    },
    surfaces,
    operations,
  };
  return deepFreeze({ ...plan, planDigest: canonicalJsonDigest(plan) });
}
