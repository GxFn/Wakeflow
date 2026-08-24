import path from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import {
  HOST_CAPABILITY_NAMES,
  normalizeWakeflowHostCapabilityProfile,
} from "./wakeflow-host-capability.mjs";
import { createWakeflowLayoutDescriptor } from "./wakeflow-layout-descriptor.mjs";

/**
 * `.wakeflow-local` 的纯结构分区器。
 *
 * 职责导航：
 * 1. 校验 strict config、host capability 与 layout descriptor 来自同一事实源。
 * 2. 把 descriptor 中的 local 条目完整分为静态目录、owner 委托文件和事件投影。
 * 3. 补出必要的结构父目录，并保证路径唯一、文件不成为其他条目的祖先。
 * 4. 输出可冻结、可摘要、无机器路径和无私有 handle 的确定性计划。
 *
 * 本模块不观察 filesystem、不判断已有 footprint，也不 mkdir/write；这些职责分别属于
 * local-layout-inspection、local-layout-realization 与最终领域 owner。
 */

const LOCAL_ROOT = ".wakeflow-local";
const PLAN_KIND = "WakeflowLocalLayoutPlan";
const PLAN_SCHEMA_VERSION = 1;
const STATIC_DIRECTORY_LIFECYCLES = new Set([
  "managed-static",
  "static-capability-root",
  "static-hold-root",
  "static-recovery-root",
  "static-secure-fallback-root",
]);

export class WakeflowLocalLayoutError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLocalLayoutError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}, cause) {
  throw new WakeflowLocalLayoutError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathCompare(left, right) {
  const depth = left.path.split("/").length - right.path.split("/").length;
  return depth || lexicalCompare(left.path, right.path) || lexicalCompare(left.key ?? "", right.key ?? "");
}

function exactInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("wakeflow-local-layout-type", "$", "local layout planner input must be a plain object");
  }
  const allowed = new Set(["model", "layoutDescriptor", "hostProfile"]);
  const properties = new Map();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("wakeflow-local-layout-unknown", `$/${String(key)}`, "local layout planner input contains an unknown field", {
        allowed: [...allowed],
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-local-layout-type", `$/${key}`, "local layout planner input fields must be enumerable data properties");
    }
    properties.set(key, descriptor.value);
  }
  for (const key of allowed) {
    if (!properties.has(key)) {
      fail("wakeflow-local-layout-missing", `$/${key}`, "local layout planner input is missing a required field");
    }
  }
  return Object.fromEntries(properties);
}

function canonicalSnapshot(value, errorPath, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-local-layout-type",
      errorPath,
      `${label} must be canonical plain data without accessors, symbols, or hidden fields`,
      {},
      cause,
    );
  }
}

function dataProperty(value, key, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-local-layout-type", errorPath, "host profile selection must be an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("wakeflow-local-layout-type", `${errorPath}/${key}`, "host profile fields must be enumerable data properties");
  }
  return descriptor.value;
}

function hostProfileSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("wakeflow-local-layout-type", "$/hostProfile", "host profile must be a plain object facade");
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable) {
      fail("wakeflow-local-layout-type", `$/hostProfile/${String(key)}`, "host profile facade cannot hide symbol or non-enumerable fields");
    }
  }
  const runtime = canonicalSnapshot(
    dataProperty(value, "runtime", "$/hostProfile"),
    "$/hostProfile/runtime",
    "host runtime profile",
  );
  const capabilities = canonicalSnapshot(
    dataProperty(value, "capabilities", "$/hostProfile"),
    "$/hostProfile/capabilities",
    "host capability profile",
  );
  return {
    hostId: dataProperty(value, "hostId", "$/hostProfile"),
    memoryFile: dataProperty(value, "memoryFile", "$/hostProfile"),
    runtime: { hostDirName: dataProperty(runtime, "hostDirName", "$/hostProfile/runtime") },
    capabilities,
  };
}

function assertMatchingDescriptor({ model, descriptor, hostProfile }) {
  if (!descriptor || descriptor.kind !== "WakeflowLayoutDescriptor" || !Array.isArray(descriptor.entries)) {
    fail("wakeflow-local-layout-descriptor", "$/layoutDescriptor", "expected a WakeflowLayoutDescriptor");
  }
  const expected = createWakeflowLayoutDescriptor({ model, hostProfile });
  const configDigest = wakeflowConfigV3Digest(model);
  let providedDigest;
  let expectedDigest;
  try {
    providedDigest = canonicalJsonDigest(descriptor);
    expectedDigest = canonicalJsonDigest(expected);
  } catch (cause) {
    fail(
      "wakeflow-local-layout-descriptor",
      "$/layoutDescriptor",
      "layout descriptor must be canonical plain data",
      {},
      cause,
    );
  }
  if (
    descriptor.configDigest !== configDigest
    || descriptor.layoutDigest !== expected.layoutDigest
    || providedDigest !== expectedDigest
  ) {
    fail(
      "wakeflow-local-layout-descriptor",
      "$/layoutDescriptor/layoutDigest",
      "layout descriptor does not match the config and host profile",
      {
        expectedConfigDigest: configDigest,
        actualConfigDigest: descriptor.configDigest ?? null,
        expectedLayoutDigest: expected.layoutDigest,
        actualLayoutDigest: descriptor.layoutDigest ?? null,
      },
    );
  }
  return expected;
}

function assertLocalPathGraph(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    const existing = byPath.get(entry.path);
    if (existing) {
      fail(
        "wakeflow-local-layout-ambiguous",
        `$/layoutDescriptor/entries/${entry.key}/path`,
        "local layout entries must have globally unique exact paths",
        { path: entry.path, existingKey: existing.key, duplicateKey: entry.key },
      );
    }
    byPath.set(entry.path, entry);
  }
  const files = entries.filter((entry) => entry.pathKind === "file");
  for (const file of files) {
    const child = entries.find((entry) => entry !== file && entry.path.startsWith(`${file.path}/`));
    if (child) {
      fail(
        "wakeflow-local-layout-ambiguous",
        `$/layoutDescriptor/entries/${file.key}/path`,
        "a local file cannot be another local path's ancestor",
        { fileKey: file.key, filePath: file.path, childKey: child.key, childPath: child.path },
      );
    }
  }
}

function classifyFreshEntry(entry) {
  if (entry.createTiming !== "fresh") {
    fail(
      "wakeflow-local-layout-timing",
      `$/layoutDescriptor/entries/${entry.key}/createTiming`,
      "non-event local layout entries must use fresh creation timing",
      { createTiming: entry.createTiming },
    );
  }
  if (entry.pathKind === "directory") {
    if (!STATIC_DIRECTORY_LIFECYCLES.has(entry.lifecycle) || entry.mode !== "0700") {
      fail(
        "wakeflow-local-layout-classification",
        `$/layoutDescriptor/entries/${entry.key}`,
        "fresh local directory uses an unsupported lifecycle or mode",
        { lifecycle: entry.lifecycle, mode: entry.mode },
      );
    }
    if (
      (entry.capability === null && entry.condition !== null)
      || (entry.capability !== null && entry.condition !== "host-capability-applicable")
    ) {
      fail(
        "wakeflow-local-layout-classification",
        `$/layoutDescriptor/entries/${entry.key}/condition`,
        "fresh local directory capability and condition must agree",
        { capability: entry.capability, condition: entry.condition },
      );
    }
    return "static-directory";
  }
  if (entry.pathKind !== "file" || entry.mode !== "0600") {
    fail(
      "wakeflow-local-layout-classification",
      `$/layoutDescriptor/entries/${entry.key}`,
      "fresh local non-directory must be one private delegated file",
      { pathKind: entry.pathKind, mode: entry.mode },
    );
  }
  if (
    entry.lifecycle === "deterministic-projection"
    && entry.owner === "runtime-projection-builder"
    && entry.capability === null
    && entry.condition === null
  ) {
    return "initial-projection";
  }
  if (
    entry.lifecycle === "deterministic-managed-asset"
    && entry.owner === "host-settings-assets-owner"
    && entry.capability === "assets"
    && entry.condition === "host-capability-applicable"
  ) {
    return "managed-file";
  }
  fail(
    "wakeflow-local-layout-classification",
    `$/layoutDescriptor/entries/${entry.key}`,
    "fresh local file does not match a closed projection or managed-asset contract",
    {
      lifecycle: entry.lifecycle,
      owner: entry.owner,
      capability: entry.capability,
      condition: entry.condition,
    },
  );
}

function assertEventEntry(entry) {
  if (
    entry.createTiming !== "event-only"
    || !["event-fact", "transaction-staging-residue"].includes(entry.lifecycle)
    || !["directory", "file"].includes(entry.pathKind)
    || entry.mode !== (entry.pathKind === "directory" ? "0700" : "0600")
  ) {
    fail(
      "wakeflow-local-layout-classification",
      `$/layoutDescriptor/entries/${entry.key}`,
      "deferred local event uses an unsupported timing, lifecycle, kind, or mode",
      {
        createTiming: entry.createTiming,
        lifecycle: entry.lifecycle,
        pathKind: entry.pathKind,
        mode: entry.mode,
      },
    );
  }
}

function assertLocalPath(entry) {
  const candidate = entry.path;
  if (
    typeof candidate !== "string"
    || candidate.includes("\\")
    || candidate.includes("\0")
    || /[\r\n]/u.test(candidate)
    || path.posix.isAbsolute(candidate)
    || path.posix.normalize(candidate) !== candidate
    || (candidate !== LOCAL_ROOT && !candidate.startsWith(`${LOCAL_ROOT}/`))
  ) {
    fail(
      "wakeflow-local-layout-path",
      `$/layoutDescriptor/entries/${entry.key}/path`,
      "local layout entry must stay below the fixed canonical protocol root",
      { value: candidate },
    );
  }
  if (entry.createTiming !== "event-only" && /\{[^{}]+\}/u.test(candidate)) {
    fail(
      "wakeflow-local-layout-path",
      `$/layoutDescriptor/entries/${entry.key}/path`,
      "fresh local layout entries must not contain event placeholders",
      { value: candidate },
    );
  }
  return candidate;
}

function capabilityApplicable(entry, profile) {
  if (entry.capability === null) return true;
  const capability = profile.capabilities[entry.capability];
  if (!capability) {
    fail(
      "wakeflow-local-layout-capability",
      `$/layoutDescriptor/entries/${entry.key}/capability`,
      "local layout entry references an unknown host capability",
      { capability: entry.capability },
    );
  }
  return capability.applicable;
}

function hostApplicability(entry, profile) {
  return entry.scope === "current-host" ? profile.hostId : "host-neutral";
}

function explicitItem(entry, profile, { trigger, status }) {
  return {
    key: entry.key,
    path: entry.path,
    pathKind: entry.pathKind,
    scope: entry.scope,
    owner: entry.owner,
    authority: entry.authority,
    lifecycle: entry.lifecycle,
    tracking: entry.tracking,
    mode: entry.mode,
    createTiming: entry.createTiming,
    condition: entry.condition,
    capability: entry.capability,
    allowDescendants: entry.allowDescendants,
    trigger,
    hostApplicability: hostApplicability(entry, profile),
    status,
    derived: false,
    sourceKeys: [entry.key],
  };
}

function directoryAncestors(entryPath) {
  const directories = [];
  let current = entryPath;
  while (current === LOCAL_ROOT || current.startsWith(`${LOCAL_ROOT}/`)) {
    directories.push(current);
    if (current === LOCAL_ROOT) break;
    current = path.posix.dirname(current);
  }
  return directories;
}

function buildStaticDirectories(freshEntries, profile) {
  const explicitByPath = new Map();
  for (const entry of freshEntries.filter((candidate) => candidate.pathKind === "directory")) {
    if (explicitByPath.has(entry.path)) {
      fail(
        "wakeflow-local-layout-ambiguous",
        `$/layoutDescriptor/entries/${entry.key}/path`,
        "multiple fresh local directory entries resolve to the same path",
        { path: entry.path, existingKey: explicitByPath.get(entry.path).key, duplicateKey: entry.key },
      );
    }
    explicitByPath.set(entry.path, entry);
  }

  const sourcesByDirectory = new Map();
  for (const entry of freshEntries) {
    const leaf = entry.pathKind === "directory" ? entry.path : path.posix.dirname(entry.path);
    for (const directory of directoryAncestors(leaf)) {
      const sources = sourcesByDirectory.get(directory) ?? new Set();
      sources.add(entry.key);
      sourcesByDirectory.set(directory, sources);
    }
  }

  return [...sourcesByDirectory.entries()].map(([directory, sourceSet]) => {
    const explicit = explicitByPath.get(directory) ?? null;
    if (explicit) {
      return explicitItem(explicit, profile, {
        trigger: "fresh-or-host-surface-reconcile",
        status: "required",
      });
    }
    const hostRoot = `${LOCAL_ROOT}/runtime/hosts/${profile.hostDirName}`;
    const currentHost = directory === hostRoot || directory.startsWith(`${hostRoot}/`);
    return {
      key: null,
      path: directory,
      pathKind: "directory",
      scope: currentHost ? "current-host" : "host-neutral",
      owner: "layout-manager",
      authority: "none",
      lifecycle: "structural-parent",
      tracking: "ignored-local",
      mode: "0700",
      createTiming: "fresh",
      condition: null,
      capability: null,
      allowDescendants: false,
      trigger: "fresh-or-host-surface-reconcile",
      hostApplicability: currentHost ? profile.hostId : "host-neutral",
      status: "required",
      derived: true,
      sourceKeys: [...sourceSet].sort(lexicalCompare),
    };
  }).sort(pathCompare);
}

function sortExplicitItems(entries) {
  return entries.sort(pathCompare);
}

/**
 * 把当前 config、host capability 与 descriptor 编译为确定性的 local 结构计划。
 * 这里只完成纯分区；T01b 必须结合只读 inventory，T02 才能准入任何实际物化。
 */
export function planWakeflowLocalLayout(value) {
  const input = exactInput(value);
  const modelInput = canonicalSnapshot(input.model, "$/model", "config model");
  const descriptorInput = canonicalSnapshot(input.layoutDescriptor, "$/layoutDescriptor", "layout descriptor");
  const hostInput = hostProfileSnapshot(input.hostProfile);
  const model = parseWakeflowConfigV3(modelInput);
  const profile = normalizeWakeflowHostCapabilityProfile(hostInput);
  const descriptor = assertMatchingDescriptor({
    model,
    descriptor: descriptorInput,
    hostProfile: hostInput,
  });
  const localEntries = descriptor.entries.filter((entry) => {
    if (entry.path !== LOCAL_ROOT && !entry.path.startsWith(`${LOCAL_ROOT}/`)) return false;
    assertLocalPath(entry);
    return capabilityApplicable(entry, profile);
  });
  assertLocalPathGraph(localEntries);
  const freshEntries = localEntries.filter((entry) => entry.createTiming !== "event-only");
  const classifications = new Map(freshEntries.map((entry) => [entry.key, classifyFreshEntry(entry)]));
  const initialProjectionEntries = freshEntries.filter((entry) => classifications.get(entry.key) === "initial-projection");
  const managedFileEntries = freshEntries.filter((entry) => classifications.get(entry.key) === "managed-file");
  for (const entry of localEntries.filter((candidate) => candidate.createTiming === "event-only")) assertEventEntry(entry);

  const staticDirectories = buildStaticDirectories(freshEntries, profile);
  const managedFiles = sortExplicitItems(managedFileEntries.map((entry) => explicitItem(entry, profile, {
    trigger: "managed-owner-reconcile",
    status: "delegated",
  })));
  const initialProjections = sortExplicitItems(initialProjectionEntries.map((entry) => explicitItem(entry, profile, {
    trigger: "projection-builder-initialize",
    status: "delegated",
  })));
  const deferredEventPatterns = sortExplicitItems(
    localEntries
      .filter((entry) => entry.createTiming === "event-only")
      .map((entry) => explicitItem(entry, profile, {
        trigger: "owner-event",
        status: "deferred",
      })),
  );
  const plan = {
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    protocolRoot: LOCAL_ROOT,
    programId: model.program.programId,
    configDigest: descriptor.configDigest,
    layoutDigest: descriptor.layoutDigest,
    host: {
      hostId: profile.hostId,
      hostDirName: profile.hostDirName,
      capabilities: HOST_CAPABILITY_NAMES.map((name) => ({
        name,
        applicable: profile.capabilities[name].applicable,
        realization: profile.capabilities[name].realization,
      })),
    },
    staticDirectories,
    managedFiles,
    initialProjections,
    deferredEventPatterns,
  };
  return deepFreeze({ ...plan, planDigest: canonicalJsonDigest(plan) });
}
