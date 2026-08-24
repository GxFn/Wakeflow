import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readlinkSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { classifyWakeflowLegacySource } from "./wakeflow-legacy-classifier.mjs";

export const WAKEFLOW_MIGRATION_INVENTORY_KIND = "WakeflowMigrationInventory";
export const WAKEFLOW_MIGRATION_INVENTORY_SCHEMA_VERSION = 1;

const FIXED_ROOTS = Object.freeze([
  ["fixed-current-active", ".wakeflow-active", "current-active-root"],
  ["fixed-current-local", ".wakeflow-local", "current-local-root"],
  ["fixed-old-active", ".workspace-active", "old-active-root"],
  ["fixed-old-local", ".workspace-local", "old-local-root"],
]);
const CONFIG_CANDIDATES = Object.freeze([
  ["durable-canonical", "wakeflow.config.json", "durable"],
  ["durable-legacy", "workspace.config.json", "durable"],
  ["local-current-canonical", ".wakeflow-local/wakeflow.config.json", "local-overlay"],
  ["local-current-legacy", ".wakeflow-local/workspace.config.json", "local-overlay"],
  ["local-old-canonical", ".workspace-local/wakeflow.config.json", "local-overlay"],
  ["local-old-legacy", ".workspace-local/workspace.config.json", "local-overlay"],
]);
const MEMORY_FILES = Object.freeze(["AGENTS.md", "CLAUDE.md"]);
const CONTROLLER_MIXED_FILES = Object.freeze([
  ".gitignore",
  ".claude/settings.json",
  ".claude/settings.local.json",
]);
const SUPPORT_MIXED_FILES = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  ".gitignore",
  ".claude/settings.json",
  ".claude/settings.local.json",
]);
const MAX_DEPTH = 128;
const MAX_ENTRIES = 100_000;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_CLASSIFIER_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const READ_BUFFER_BYTES = 64 * 1024;
const MAX_CONFIGURED_PATH_BYTES = 4096;
const SAFE_COMPONENT = /^[A-Za-z0-9._-]{1,160}$/u;
const UNSAFE_REF_CHARACTER = /[\\\u0000-\u001f\u007f\ufffd]/u;
const PRIVATE_SOURCE_PATTERN = /(?:^|\/)(?:handles?|thread-registry|window-config|window-host|runtime-meta|activity|paste|prompts?|pids?|process|tmux)(?:\/|\.|$)/iu;

// 本文件只冻结legacy source-set与物理/领域观察，不生成迁移动作、目标字节或apply资格。
// T03 classifier解释单个source；T05 plan选择处置；owner drain、host decommission与mutation各自持有后续证明。

export class WakeflowMigrationInventoryError extends Error {
  constructor(code, message, { errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowMigrationInventoryError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, { errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowMigrationInventoryError(code, message, { errorPath, details, cause });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ==================== 一、入口与物理身份原语 ====================

function exactInput(input) {
  if (!isPlainObject(input)) {
    fail("wakeflow-migration-inventory-input", "inventory input must be a plain object");
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 1 || keys[0] !== "workspaceRoot") {
    fail("wakeflow-migration-inventory-input", "inventory input must contain only workspaceRoot", {
      details: { actual: keys.map(String).sort(compareText), expected: ["workspaceRoot"] },
    });
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, "workspaceRoot");
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("wakeflow-migration-inventory-input", "workspaceRoot must be an enumerable data property");
  }
  if (typeof descriptor.value !== "string" || !descriptor.value.trim()) {
    fail("wakeflow-migration-inventory-input", "workspaceRoot must be a non-empty string");
  }
  return descriptor.value;
}

function inspectWorkspaceRoot(value) {
  const lexical = path.resolve(value);
  let before;
  try {
    before = lstatSync(lexical, { bigint: true });
  } catch (cause) {
    fail("wakeflow-migration-inventory-workspace", "cannot inspect the workspace root", { cause });
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail("wakeflow-migration-inventory-workspace", "workspaceRoot must be a real directory");
  }
  let real;
  let after;
  let resolved;
  try {
    real = realpathSync(lexical);
    after = lstatSync(lexical, { bigint: true });
    resolved = lstatSync(real, { bigint: true });
  } catch (cause) {
    fail("wakeflow-migration-inventory-workspace", "cannot resolve the workspace root", { cause });
  }
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || !resolved.isDirectory()
    || !sameNodeSnapshot(before, after)
    || !sameNodeSnapshot(after, resolved)
  ) {
    fail("wakeflow-migration-inventory-workspace", "workspaceRoot changed while it was resolved");
  }
  return { root: real, stat: resolved };
}

function statType(stat) {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isSocket()) return "socket";
  if (stat.isFIFO()) return "fifo";
  if (stat.isCharacterDevice()) return "character-device";
  if (stat.isBlockDevice()) return "block-device";
  return "special";
}

function modeString(stat) {
  const permissionBits = typeof stat.mode === "bigint"
    ? Number(stat.mode & 0o777n)
    : stat.mode & 0o777;
  return `0${permissionBits.toString(8).padStart(3, "0")}`;
}

function sameNodeSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function currentEffectiveUid() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") return null;
  return BigInt(process.geteuid());
}

function nodeOwnedByCurrentUser(stat) {
  const expected = currentEffectiveUid();
  return expected === null || stat.uid === expected;
}

function safeNumber(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/") || ".";
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safePortableRef(ref) {
  if (
    typeof ref !== "string"
    || !ref
    || ref !== ref.normalize("NFC")
    || path.posix.isAbsolute(ref)
    || path.win32.isAbsolute(ref)
    || UNSAFE_REF_CHARACTER.test(ref)
  ) return false;
  const components = ref.split("/");
  return components.every((component) => component === "." || (component !== ".." && SAFE_COMPONENT.test(component)));
}

function validConfiguredPathValue(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.normalize("NFC")
    && Buffer.byteLength(value, "utf8") <= MAX_CONFIGURED_PATH_BYTES
    && !UNSAFE_REF_CHARACTER.test(value);
}

function inspectNoFollowAncestors(base, target) {
  if (!isWithin(base, target) || base === target) return [];
  const segments = path.relative(base, target).split(path.sep);
  const ancestors = [base];
  let current = base;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    ancestors.push(current);
  }
  for (const ancestor of ancestors) {
    let stat;
    try {
      stat = lstatSync(ancestor);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      return ["migration-source-unreadable"];
    }
    if (stat.isSymbolicLink()) return ["migration-source-symlink-ancestor"];
    if (!stat.isDirectory()) return ["migration-source-type-mismatch"];
  }
  return [];
}

function publicLocation(workspaceRoot, absolutePath, claimKey) {
  if (isWithin(workspaceRoot, absolutePath)) {
    const ref = relativePosix(workspaceRoot, absolutePath);
    if (safePortableRef(ref)) return { kind: "workspace-relative", path: ref, pathDigest: null };
    return { kind: "workspace-relative", path: null, pathDigest: sha256(Buffer.from(ref, "utf8")) };
  }
  return {
    kind: "configured-private",
    path: null,
    pathDigest: sha256(Buffer.from(`configured-root:${claimKey}`, "utf8")),
  };
}

function physicalIdentityBlockers(stat, type) {
  const blockers = [];
  if (!nodeOwnedByCurrentUser(stat)) blockers.push("migration-source-owner-mismatch");
  if (type !== "directory" && stat.nlink !== 1n) blockers.push("migration-source-multiple-links");
  if (safeNumber(stat.size) === null) blockers.push("migration-source-size-unrepresentable");
  return blockers;
}

// regular file始终通过同一descriptor读取，并在返回前证明路径仍指向该节点。
function readExactRegularFile(file, before, scanState) {
  const blockers = physicalIdentityBlockers(before, "file");
  const observedSize = safeNumber(before.size);
  if (
    observedSize === null
    || before.size > BigInt(MAX_FILE_BYTES)
    || scanState.totalBytes + observedSize > MAX_TOTAL_BYTES
  ) {
    return {
      bytes: null,
      digest: null,
      blockerCodes: sortedUnique([
        ...blockers,
        observedSize === null
          ? "migration-source-size-unrepresentable"
          : before.size > BigInt(MAX_FILE_BYTES)
            ? "migration-source-file-limit"
            : "migration-source-total-byte-limit",
      ]),
    };
  }
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    return {
      bytes: null,
      digest: null,
      blockerCodes: [cause?.code === "ELOOP" ? "migration-source-symlink" : "migration-source-unreadable"],
    };
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) {
      return { bytes: null, digest: null, blockerCodes: sortedUnique([...blockers, "migration-source-special-node"]) };
    }
    if (!sameNodeSnapshot(before, opened)) {
      return { bytes: null, digest: null, blockerCodes: sortedUnique([...blockers, "migration-source-unstable"]) };
    }
    const hash = createHash("sha256");
    const expectedSize = Number(opened.size);
    const retainBytes = expectedSize <= MAX_CLASSIFIER_BYTES;
    const retained = [];
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    let position = 0;
    while (position < expectedSize) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, expectedSize - position), position);
      if (count === 0) break;
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      if (retainBytes) retained.push(Buffer.from(chunk));
      position += count;
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      position !== expectedSize
      || afterPath.isSymbolicLink()
      || !afterPath.isFile()
      || !sameNodeSnapshot(opened, afterDescriptor)
      || !sameNodeSnapshot(afterDescriptor, afterPath)
    ) {
      return { bytes: null, digest: null, blockerCodes: sortedUnique([...blockers, "migration-source-unstable"]) };
    }
    scanState.totalBytes += position;
    return {
      bytes: retainBytes ? Buffer.concat(retained, position) : null,
      digest: `sha256:${hash.digest("hex")}`,
      blockerCodes: sortedUnique([
        ...blockers,
        ...(retainBytes ? [] : ["migration-source-classifier-byte-limit"]),
      ]),
    };
  } catch {
    return { bytes: null, digest: null, blockerCodes: sortedUnique([...blockers, "migration-source-unreadable"]) };
  } finally {
    closeSync(descriptor);
  }
}

function readStableSymlink(file, before) {
  const blockerCodes = new Set(physicalIdentityBlockers(before, "symlink"));
  try {
    const target = readlinkSync(file, { encoding: "buffer" });
    const after = lstatSync(file, { bigint: true });
    if (!after.isSymbolicLink() || !sameNodeSnapshot(before, after)) {
      blockerCodes.add("migration-source-unstable");
      return { blockerCodes: sortedUnique(blockerCodes), digest: null };
    }
    return { blockerCodes: sortedUnique(blockerCodes), digest: sha256(target) };
  } catch {
    blockerCodes.add("migration-source-unreadable");
    return { blockerCodes: sortedUnique(blockerCodes), digest: null };
  }
}

// 目录名最多缓存剩余entry预算加一项；一旦超限，整棵目录保持blocked而不选择不稳定的任意子集。
function openBoundedDirectorySnapshot(file, before, remainingEntries) {
  let descriptor;
  let directory;
  try {
    descriptor = openSync(
      file,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isDirectory() || !sameNodeSnapshot(before, opened)) {
      closeSync(descriptor);
      return { blockerCode: "migration-source-unstable", descriptor: null, names: [], opened: null, truncated: false };
    }
    directory = opendirSync(file, { encoding: "utf8" });
    const names = [];
    let truncated = false;
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (names.length >= remainingEntries) {
        truncated = true;
        break;
      }
      names.push(entry.name);
    }
    directory.closeSync();
    directory = null;
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isDirectory()
      || !sameNodeSnapshot(opened, afterDescriptor)
      || !sameNodeSnapshot(afterDescriptor, afterPath)
    ) {
      closeSync(descriptor);
      return { blockerCode: "migration-source-unstable", descriptor: null, names: [], opened: null, truncated: false };
    }
    return {
      blockerCode: null,
      descriptor,
      names: truncated ? [] : names.sort(compareText),
      opened,
      truncated,
    };
  } catch {
    try {
      directory?.closeSync();
    } catch {
      // 读取失败已由统一blocker表达；close错误不能把路径信息带入输出。
    }
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch {
      // 同上。
    }
    return { blockerCode: "migration-source-unreadable", descriptor: null, names: [], opened: null, truncated: false };
  }
}

function scanNode(file, depth, state, { recursive = true } = {}) {
  if (state.nodes.has(file)) return state.nodes.get(file);
  if (state.entryCount >= MAX_ENTRIES) {
    const limited = {
      absolutePath: file,
      blockerCodes: new Set(["migration-source-entry-limit"]),
      bytes: null,
      digest: null,
      mode: null,
      size: null,
      type: "unreadable",
    };
    state.nodes.set(file, limited);
    return limited;
  }
  state.entryCount += 1;
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch {
    const unreadable = {
      absolutePath: file,
      blockerCodes: new Set(["migration-source-unreadable"]),
      bytes: null,
      digest: null,
      mode: null,
      size: null,
      type: "unreadable",
    };
    state.nodes.set(file, unreadable);
    return unreadable;
  }
  const type = statType(before);
  const observedSize = safeNumber(before.size);
  const node = {
    absolutePath: file,
    blockerCodes: new Set(physicalIdentityBlockers(before, type)),
    bytes: null,
    digest: null,
    mode: modeString(before),
    size: observedSize ?? 0,
    type,
  };
  state.nodes.set(file, node);

  if (type === "symlink") {
    const observed = readStableSymlink(file, before);
    node.digest = observed.digest;
    for (const code of observed.blockerCodes) node.blockerCodes.add(code);
    node.blockerCodes.add("migration-source-symlink");
    return node;
  }
  if (type === "file") {
    const read = readExactRegularFile(file, before, state);
    node.bytes = read.bytes;
    node.digest = read.digest;
    for (const code of read.blockerCodes) node.blockerCodes.add(code);
    return node;
  }
  if (type !== "directory") {
    node.blockerCodes.add("migration-source-special-node");
    return node;
  }
  if (!recursive) {
    node.blockerCodes.add("migration-source-type-mismatch");
    node.digest = canonicalJsonDigest({ children: [], type: "unexpected-exact-directory" });
    return node;
  }
  if (depth >= MAX_DEPTH) {
    node.blockerCodes.add("migration-source-depth-limit");
    return node;
  }

  const snapshot = openBoundedDirectorySnapshot(file, before, MAX_ENTRIES - state.entryCount);
  if (snapshot.blockerCode !== null) {
    node.blockerCodes.add(snapshot.blockerCode);
    return node;
  }
  const { descriptor, names, opened, truncated: entryLimitReached } = snapshot;
  const collisionGroups = new Map();
  const children = [];
  if (entryLimitReached) node.blockerCodes.add("migration-source-entry-limit");
  try {
    for (const name of names) {
      const collisionKey = name.normalize("NFC").toLowerCase();
      const group = collisionGroups.get(collisionKey) ?? [];
      group.push(name);
      collisionGroups.set(collisionKey, group);
      const child = scanNode(path.join(file, name), depth + 1, state, { recursive: true });
      if (!SAFE_COMPONENT.test(name) || name !== name.normalize("NFC")) {
        child.blockerCodes.add("migration-source-unsafe-ref");
      }
      children.push({ name, node: child });
    }
    for (const group of collisionGroups.values()) {
      if (group.length <= 1) continue;
      node.blockerCodes.add("migration-source-portable-collision");
      for (const name of group) state.nodes.get(path.join(file, name))?.blockerCodes.add("migration-source-portable-collision");
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isDirectory()
      || !sameNodeSnapshot(opened, afterDescriptor)
      || !sameNodeSnapshot(afterDescriptor, afterPath)
    ) node.blockerCodes.add("migration-source-unstable");
  } catch {
    node.blockerCodes.add("migration-source-unstable");
  } finally {
    closeSync(descriptor);
  }
  node.digest = canonicalJsonDigest({
    children: children.map(({ name, node: child }) => ({
      digest: child.digest,
      nameDigest: sha256(Buffer.from(name, "utf8")),
      size: child.size,
      type: child.type,
    })),
    truncated: entryLimitReached,
    type: "directory",
  });
  return node;
}

function gitRootObservation(root) {
  try {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return "unknown";
  } catch {
    return "unknown";
  }
  let stat;
  try {
    stat = lstatSync(path.join(root, ".git"));
    if (stat.isSymbolicLink()) return "unknown";
    if (stat.isDirectory() || stat.isFile()) return true;
    return "unknown";
  } catch (error) {
    if (error?.code !== "ENOENT") return "unknown";
  }
  let current = path.dirname(root);
  while (current !== path.dirname(current)) {
    try {
      const ancestor = lstatSync(path.join(current, ".git"));
      if (!ancestor.isSymbolicLink() && (ancestor.isDirectory() || ancestor.isFile())) return false;
      if (ancestor.isSymbolicLink()) return "unknown";
    } catch (error) {
      if (error?.code !== "ENOENT") return "unknown";
    }
    current = path.dirname(current);
  }
  return "unknown";
}

// ==================== 二、legacy config source-set与拓扑声明 ====================

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, child]) => [key, stripUndefined(child)]),
  );
}

function normalizedConfigIntent(value, { omitDerivedRepositories = false } = {}) {
  const repositories = (Array.isArray(value.repositories) ? value.repositories : [])
    .filter((repository) => !omitDerivedRepositories || repository?.stream === undefined);
  if (value.schemaVersion === 2) {
    return stripUndefined({
      hosts: value.hosts,
      policy: value.policy,
      repositories,
      roles: value.roles,
      storage: {
        activeRoot: value.storage?.activeRoot,
        ledgerRoot: value.storage?.ledgerRoot,
        paths: value.storage?.paths,
        windowLedgerDirs: value.storage?.windowLedgerDirs,
        windowLedgerRoot: value.storage?.windowLedgerRoot,
      },
      workspace: value.workspace,
    });
  }
  const flatPaths = Object.fromEntries([
    "globalTodoPath",
    "goalStageConfirmationDir",
    "requirementDesignsDir",
    "testExchangePath",
    "workspaceArchiveDir",
    "workspaceCurrentDir",
    "workspaceCurrentIndexPath",
    "workspaceCurrentStatusPath",
    "workspaceDocsDir",
    "workspaceIndexPath",
    "workspaceRecordMapPath",
  ].filter((field) => value[field] !== undefined).map((field) => [field, value[field]]));
  return stripUndefined({
    hosts: value.hosts ?? {},
    policy: {
      allowMissingRepos: value.allowMissingRepos,
      allowedRepositoryResiduePaths: value.allowedRepositoryResiduePaths,
      disallowedTrackedPaths: value.disallowedTrackedPaths,
      preservedRetentionDays: value.preservedRetentionDays,
      runtimeProcessLabel: value.runtimeProcessLabel,
      runtimeProcessMatchers: value.runtimeProcessMatchers,
    },
    repositories,
    roles: {
      base: value.baseWindow,
      controller: value.controllerWindow,
      design: value.designWindow,
      realProject: value.realProjectWindow,
      test: value.testWindow,
    },
    storage: {
      activeRoot: value.activeLedgerRoot,
      ledgerRoot: value.projectLedgerRoot,
      paths: Object.keys(flatPaths).length > 0 ? flatPaths : undefined,
      windowLedgerDirs: value.windowLedgerDirs,
      windowLedgerRoot: value.windowLedgerRoot,
    },
    workspace: {
      language: value.interfaceLanguage,
      name: value.workspaceName,
      root: value.workspaceRoot,
      runtimeMode: value.runtimeMode,
      wakeflowRepoDir: value.wakeflowRepoDir,
    },
  });
}

function configTopology(value) {
  const nested = value.schemaVersion === 2;
  const storage = nested ? value.storage ?? {} : value;
  const workspace = nested ? value.workspace ?? {} : value;
  const roles = nested ? value.roles ?? {} : {
    design: value.designWindow,
    test: value.testWindow,
  };
  const paths = nested ? storage.paths ?? {} : value;
  const repositories = Array.isArray(value.repositories) ? value.repositories : [];
  return stripUndefined({
    activeRoot: nested ? storage.activeRoot : value.activeLedgerRoot,
    internalDesignPath: value.internalDesignPath,
    internalTestPath: value.internalTestPath,
    ledgerRoot: nested ? storage.ledgerRoot : value.projectLedgerRoot,
    paths: Object.fromEntries([
      "globalTodoPath",
      "goalStageConfirmationDir",
      "requirementDesignsDir",
      "testExchangePath",
      "workspaceArchiveDir",
      "workspaceCurrentDir",
      "workspaceCurrentIndexPath",
      "workspaceCurrentStatusPath",
      "workspaceDocsDir",
      "workspaceIndexPath",
      "workspaceRecordMapPath",
    ].filter((field) => typeof paths[field] === "string").map((field) => [field, paths[field]])),
    repositories: repositories.map((repository, index) => ({
      index,
      mode: repository.mode ?? "external",
      path: repository.path,
      windowName: repository.windowName,
    })),
    roles: {
      design: roles.design,
      test: roles.test,
    },
    windowLedgerDirs: storage.windowLedgerDirs ?? {},
    windowLedgerRoot: storage.windowLedgerRoot,
    workspaceRoot: nested ? workspace.root : value.workspaceRoot,
  });
}

function topologyPathValues(topology) {
  if (!topology) return [];
  return [
    topology.activeRoot,
    topology.internalDesignPath,
    topology.internalTestPath,
    topology.ledgerRoot,
    topology.windowLedgerRoot,
    topology.workspaceRoot,
    ...Object.values(topology.paths ?? {}),
    ...Object.values(topology.windowLedgerDirs ?? {}),
    ...(topology.repositories ?? []).map((repository) => repository.path),
  ].filter((value) => value !== undefined);
}

function publicClassification(classification) {
  if (!classification) return null;
  return {
    artifact: classification.artifact,
    blockerCodes: classification.blockerCodes,
    canonicalClassifierDigest: classification.canonicalClassifierDigest,
    components: classification.components,
    confidence: classification.confidence,
    defaultDisposition: classification.defaultDisposition,
    lifecycleConclusion: classification.lifecycleConclusion,
    originCandidates: classification.originCandidates,
    producerRoutes: classification.producerRoutes,
    rawDigest: classification.rawDigest,
    typedSlots: classification.typedSlots,
  };
}

function inspectConfigCandidate(workspaceRoot, relativePath, scope) {
  const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
  const ancestorBlockers = inspectNoFollowAncestors(workspaceRoot, absolutePath);
  if (ancestorBlockers.length > 0) {
    return {
      absolutePath,
      blockerCodes: sortedUnique([...ancestorBlockers, "migration-config-unrecognized"]),
      classification: null,
      digest: null,
      intentDigest: null,
      relativePath,
      scope,
      topology: null,
      value: null,
    };
  }
  let stat;
  try {
    stat = lstatSync(absolutePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return {
      absolutePath,
      blockerCodes: ["migration-source-unreadable", "migration-config-unrecognized"],
      classification: null,
      digest: null,
      intentDigest: null,
      relativePath,
      scope,
      topology: null,
      value: null,
    };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const link = stat.isSymbolicLink() ? readStableSymlink(absolutePath, stat) : null;
    return {
      absolutePath,
      blockerCodes: sortedUnique([
        ...(link?.blockerCodes ?? []),
        stat.isSymbolicLink() ? "migration-source-symlink" : "migration-source-special-node",
        "migration-config-unrecognized",
      ]),
      classification: null,
      digest: link?.digest ?? null,
      intentDigest: null,
      relativePath,
      scope,
      topology: null,
      value: null,
    };
  }
  const scanState = { totalBytes: 0 };
  const read = readExactRegularFile(absolutePath, stat, scanState);
  if (!read.bytes || !read.digest) {
    return {
      absolutePath,
      blockerCodes: sortedUnique([...read.blockerCodes, "migration-config-unrecognized"]),
      classification: null,
      digest: read.digest,
      intentDigest: null,
      relativePath,
      scope,
      topology: null,
      value: null,
    };
  }
  let classification;
  try {
    classification = classifyWakeflowLegacySource({
      gitIgnoreRoot: gitRootObservation(workspaceRoot),
      ownership: "wakeflow-managed",
      relativePath,
      sourceBytes: read.bytes,
      surfaceKind: "controller",
    });
  } catch {
    classification = null;
  }
  const knownConfig = classification
    && classification.confidence !== "unknown"
    && ["wakeflow-config-flat-v1", "wakeflow-config-v2"].includes(classification.artifact.kind);
  if (!knownConfig) {
    return {
      absolutePath,
      blockerCodes: sortedUnique([
        ...read.blockerCodes,
        ...(classification?.blockerCodes ?? []),
        "migration-config-unrecognized",
      ]),
      classification,
      digest: read.digest,
      intentDigest: null,
      relativePath,
      scope,
      topology: null,
      value: null,
    };
  }
  let value;
  try {
    value = JSON.parse(read.bytes.toString("utf8"));
  } catch {
    value = null;
  }
  const intent = value ? normalizedConfigIntent(value) : null;
  const topology = value ? configTopology(value) : null;
  const topologyBlockers = topologyPathValues(topology).some((pathValue) => !validConfiguredPathValue(pathValue))
    ? ["migration-config-path-invalid"]
    : [];
  return {
    absolutePath,
    blockerCodes: sortedUnique([
      ...read.blockerCodes,
      ...classification.blockerCodes,
      ...topologyBlockers,
    ]),
    classification,
    digest: read.digest,
    intentDigest: intent ? canonicalJsonDigest(intent) : null,
    relativePath,
    scope,
    topology,
    value,
  };
}

function createClaim({
  absolutePath,
  claimKey,
  descriptorBasePath,
  safetyBasePath = descriptorBasePath,
  kind,
  ownership,
  recursive,
  scanAllowed = true,
  surfaceKind,
  workspaceRoot,
  blockerCodes = [],
}) {
  const effectiveBlockers = new Set(blockerCodes);
  let effectiveScanAllowed = scanAllowed;
  if (effectiveScanAllowed && isWithin(safetyBasePath, absolutePath)) {
    for (const code of inspectNoFollowAncestors(safetyBasePath, absolutePath)) {
      effectiveBlockers.add(code);
      effectiveScanAllowed = false;
    }
  }
  return {
    absolutePath,
    blockerCodes: effectiveBlockers,
    claimKey,
    descriptorBasePath,
    gitIgnoreRoot: gitRootObservation(descriptorBasePath),
    kind,
    location: publicLocation(workspaceRoot, absolutePath, claimKey),
    ownership,
    recursive,
    rootId: sha256(Buffer.from(`migration-root:${claimKey}`, "utf8")),
    scanAllowed: effectiveScanAllowed,
    surfaceKind,
  };
}

function addClaim(claims, input) {
  if (claims.some((claim) => claim.claimKey === input.claimKey)) return;
  claims.push(createClaim(input));
}

function configuredPath(workspaceRoot, value) {
  if (!validConfiguredPathValue(value)) return null;
  return path.resolve(workspaceRoot, value);
}

function addExactMixedClaims({
  claims,
  claimPrefix,
  root,
  surfaceKind,
  ownership,
  workspaceRoot,
  files,
  scanAllowed = true,
  safetyBasePath = root,
}) {
  for (const ref of files) {
    addClaim(claims, {
      absolutePath: path.join(root, ...ref.split("/")),
      claimKey: `${claimPrefix}:mixed:${ref}`,
      descriptorBasePath: root,
      safetyBasePath,
      kind: "mixed-owned-surface",
      ownership,
      recursive: false,
      scanAllowed,
      surfaceKind,
      workspaceRoot,
    });
  }
}

function discoverClaims(workspaceRoot, configs) {
  const claims = [];
  for (const [claimKey, ref, kind] of FIXED_ROOTS) {
    addClaim(claims, {
      absolutePath: path.join(workspaceRoot, ref),
      claimKey,
      descriptorBasePath: workspaceRoot,
      kind,
      ownership: "wakeflow-managed",
      recursive: true,
      surfaceKind: "controller",
      workspaceRoot,
    });
  }
  for (const [claimKey, ref] of CONFIG_CANDIDATES) {
    addClaim(claims, {
      absolutePath: path.join(workspaceRoot, ...ref.split("/")),
      claimKey: `config-source:${claimKey}`,
      descriptorBasePath: workspaceRoot,
      kind: "config-source",
      ownership: "wakeflow-managed",
      recursive: false,
      surfaceKind: "controller",
      workspaceRoot,
    });
  }
  addExactMixedClaims({
    claims,
    claimPrefix: "controller-root",
    files: CONTROLLER_MIXED_FILES,
    ownership: "managed-block",
    root: workspaceRoot,
    surfaceKind: "controller",
    workspaceRoot,
  });
  addExactMixedClaims({
    claims,
    claimPrefix: "workspace-root",
    files: MEMORY_FILES,
    ownership: "managed-block",
    root: workspaceRoot,
    surfaceKind: "workspace-parent",
    workspaceRoot,
  });

  for (const config of configs) {
    if (!config.topology) continue;
    const prefix = `configured:${config.relativePath}`;
    const recursiveValues = [
      ["active-root", config.topology.activeRoot],
      ["ledger-root", config.topology.ledgerRoot],
      ["window-ledger-root", config.topology.windowLedgerRoot],
      ...Object.entries(config.topology.windowLedgerDirs ?? {}).map(([key, value]) => [`window-ledger-dir:${key}`, value]),
    ];
    for (const [pointer, value] of recursiveValues) {
      const target = configuredPath(workspaceRoot, value);
      if (!target) continue;
      const contained = isWithin(workspaceRoot, target);
      addClaim(claims, {
        absolutePath: target,
        blockerCodes: contained ? [] : ["migration-config-root-escape"],
        claimKey: `${prefix}:${pointer}`,
        descriptorBasePath: workspaceRoot,
        kind: `configured-${pointer.split(":")[0]}`,
        ownership: "wakeflow-managed",
        recursive: true,
        scanAllowed: contained,
        surfaceKind: "controller",
        workspaceRoot,
      });
    }
    for (const [pointer, value] of Object.entries(config.topology.paths ?? {})) {
      const target = configuredPath(workspaceRoot, value);
      if (!target) continue;
      const contained = isWithin(workspaceRoot, target);
      addClaim(claims, {
        absolutePath: target,
        blockerCodes: contained ? [] : ["migration-config-root-escape"],
        claimKey: `${prefix}:storage-path:${pointer}`,
        descriptorBasePath: workspaceRoot,
        kind: "configured-storage-path",
        ownership: "wakeflow-managed",
        recursive: false,
        scanAllowed: contained,
        surfaceKind: "controller",
        workspaceRoot,
      });
    }

    const configuredWorkspaceRoot = configuredPath(workspaceRoot, config.topology.workspaceRoot);
    if (configuredWorkspaceRoot) {
      const bounded = configuredWorkspaceRoot === workspaceRoot
        || configuredWorkspaceRoot === path.dirname(workspaceRoot);
      addExactMixedClaims({
        claims,
        claimPrefix: `${prefix}:workspace-parent${bounded ? "" : ":unbounded"}`,
        files: MEMORY_FILES,
        ownership: "managed-block",
        root: configuredWorkspaceRoot,
        scanAllowed: bounded,
        surfaceKind: "workspace-parent",
        workspaceRoot,
      });
      addExactMixedClaims({
        claims,
        claimPrefix: `${prefix}:workspace-controller${bounded ? "" : ":unbounded"}`,
        files: CONTROLLER_MIXED_FILES,
        ownership: "managed-block",
        root: configuredWorkspaceRoot,
        scanAllowed: bounded,
        surfaceKind: "controller",
        workspaceRoot,
      });
      if (!bounded) {
        for (const claim of claims.filter((candidate) => candidate.claimKey.includes(`${prefix}:workspace-`))) {
          claim.blockerCodes.add("migration-config-workspace-root-unbounded");
        }
      }
    }

    const designName = config.topology.roles?.design;
    const testName = config.topology.roles?.test;
    const repositories = [...(config.topology.repositories ?? [])];
    for (const [windowName, repositoryPath, mode] of [
      [designName, config.topology.internalDesignPath, "internal"],
      [testName, config.topology.internalTestPath, "internal"],
    ]) {
      if (repositoryPath && !repositories.some((repository) => repository.windowName === windowName)) {
        repositories.push({ index: `legacy-${windowName}`, mode, path: repositoryPath, windowName });
      }
    }
    for (const repository of repositories) {
      const repositoryRoot = configuredPath(workspaceRoot, repository.path);
      if (!repositoryRoot) continue;
      const supportKind = repository.windowName === designName
        ? "design-support"
        : repository.windowName === testName
          ? "test-support"
          : null;
      const internalSupport = supportKind !== null
        && repository.mode === "internal"
        && isWithin(workspaceRoot, repositoryRoot);
      const surfaceKind = supportKind ?? "product-repository";
      const ownership = internalSupport
        ? "wakeflow-managed"
        : supportKind
          ? "owner-managed"
          : "managed-block";
      const repositoryPrefix = `${prefix}:repository:${repository.index}`;
      if (internalSupport) {
        addClaim(claims, {
          absolutePath: repositoryRoot,
          claimKey: `${repositoryPrefix}:internal-support`,
          descriptorBasePath: repositoryRoot,
          safetyBasePath: workspaceRoot,
          kind: "configured-internal-support",
          ownership,
          recursive: true,
          surfaceKind,
          workspaceRoot,
        });
      } else if (supportKind && repository.mode === "internal") {
        addClaim(claims, {
          absolutePath: repositoryRoot,
          blockerCodes: ["migration-internal-support-root-escape"],
          claimKey: `${repositoryPrefix}:escaped-internal-support`,
          descriptorBasePath: repositoryRoot,
          kind: "configured-external-support",
          ownership: "owner-managed",
          recursive: false,
          scanAllowed: false,
          surfaceKind,
          workspaceRoot,
        });
      }
      addExactMixedClaims({
        claims,
        claimPrefix: repositoryPrefix,
        files: SUPPORT_MIXED_FILES,
        ownership,
        root: repositoryRoot,
        safetyBasePath: internalSupport ? workspaceRoot : repositoryRoot,
        surfaceKind,
        workspaceRoot,
      });
    }
  }
  return claims.sort((left, right) => compareText(left.rootId, right.rootId));
}

// ==================== 三、claim上下文、隐私与领域保守归类 ====================

function claimCovers(claim, absolutePath) {
  return claim.recursive ? isWithin(claim.absolutePath, absolutePath) : claim.absolutePath === absolutePath;
}

function contextScore(claim) {
  let score = claim.recursive ? 0 : 100;
  if (["design-support", "test-support", "product-repository", "workspace-parent"].includes(claim.surfaceKind)) score += 50;
  if (claim.kind === "mixed-owned-surface") score += 25;
  return score;
}

function classificationContext(claims, absolutePath) {
  const matching = claims.filter((claim) => claimCovers(claim, absolutePath));
  matching.sort((left, right) => contextScore(right) - contextScore(left) || compareText(left.rootId, right.rootId));
  const contexts = new Set(matching.map((claim) => canonicalJson({
    descriptorBasePath: claim.descriptorBasePath,
    gitIgnoreRoot: claim.gitIgnoreRoot,
    ownership: claim.ownership,
    surfaceKind: claim.surfaceKind,
  })));
  return {
    claim: matching[0] ?? null,
    contextConflict: contexts.size > 1,
    matching,
  };
}

function sourcePrivacy(relativePath, classification) {
  if (PRIVATE_SOURCE_PATTERN.test(relativePath)) return "local-secret";
  if (/\.claude\/settings\.local\.json$/u.test(relativePath)) return "local-sensitive";
  if (/(?:wakeflow|workspace)\.config\.json$/u.test(relativePath)) return "local-sensitive";
  if (classification?.typedSlots.some((slot) => slot.sensitivity !== "portable")) return "local-sensitive";
  return "portable";
}

const LEGACY_HOST_IDENTITY_DIRECTORY_NAMES = new Set([
  "runtime-meta",
  "thread-registry",
  "window-config",
  "window-host",
]);
const LEGACY_HOST_RUNTIME_RESIDUE_FILE = /^(?:activity-monitor-[a-z0-9._-]+\.pid|deliver-[a-z0-9._-]+\.txt|entry-sync-[a-z0-9._-]+\.txt|paste-[a-z0-9._-]+\.lock|pod-entry-[a-z0-9._-]+\.txt)$/u;

function classificationRequiresHostDecommission(classification) {
  return classification?.blockerCodes.includes("legacy-host-decommission-required") === true
    || classification?.defaultDisposition?.prerequisites.includes("host-decommission") === true;
}

function isKnownLegacyHostIdentityResidue(normalized, type) {
  if (type === "directory") return false;
  const segments = normalized.toLowerCase().split("/");
  const deliveryIndex = segments.indexOf("wakeflow-delivery");
  if (deliveryIndex < 0) return false;
  const deliverySegments = segments.slice(deliveryIndex + 1);
  const identityIndex = deliverySegments.findIndex((segment) => LEGACY_HOST_IDENTITY_DIRECTORY_NAMES.has(segment));
  if (identityIndex >= 0 && identityIndex < deliverySegments.length - 1) return true;

  const hostsIndex = deliverySegments.indexOf("hosts");
  if (hostsIndex < 0 || deliverySegments.length !== hostsIndex + 3) return false;
  return LEGACY_HOST_RUNTIME_RESIDUE_FILE.test(deliverySegments.at(-1));
}

function isLegacyHostContainer(normalized, type) {
  if (type !== "directory") return false;
  const segments = normalized.toLowerCase().split("/");
  const deliveryIndex = segments.indexOf("wakeflow-delivery");
  return deliveryIndex >= 0 && segments.slice(deliveryIndex + 1).includes("hosts");
}

function resourceFor(relativePath, type, claim, classification) {
  const normalized = relativePath.replace(/^\.\//u, "");
  const lower = normalized.toLowerCase();
  const segments = normalized.split("/");
  const currentDemand = (
    segments[0] === ".wakeflow-active"
    && segments[1] === "current"
    && segments.length >= 3
  ) || (
    segments[0] === ".workspace-active"
    && segments[1] === "workspace"
    && segments[2] === "current"
    && segments.length >= 4
  );
  if (currentDemand) {
    return { kind: "active-demand", state: "drain-required", blockerCodes: ["migration-owner-drain-required"] };
  }
  if (claim?.kind === "configured-active-root" && normalized !== ".") {
    return { kind: "active-root-residue", state: "correlation-required", blockerCodes: ["migration-domain-correlation-required"] };
  }
  if (/(?:^|\/)(?:wakeflow|workspace)\.config\.json$/u.test(lower)) {
    return { kind: "config-source", state: "observed", blockerCodes: [] };
  }
  if (lower.includes("stream-overlay.lock") || lower.includes("pending-merges") || lower.includes("/worktrees/") || lower.endsWith("/worktrees")) {
    return { kind: "stream-worktree", state: "drain-required", blockerCodes: ["migration-owner-drain-required"] };
  }
  if (
    lower.includes("pod-reservations")
    || lower.includes("/pods/")
    || lower.endsWith("/pods")
    || lower.includes("/pod-manifests/")
    || lower.endsWith("/pod-manifests")
    || lower.includes("/pod-bindings/")
    || lower.endsWith("/pod-bindings")
    || lower.includes("/pod-operations/")
    || lower.endsWith("/pod-operations")
    || lower.includes("/pod-test-access-plans/")
    || lower.endsWith("/pod-test-access-plans")
    || lower.includes("/pod-test-access-receipts/")
    || lower.endsWith("/pod-test-access-receipts")
    || lower.endsWith("/pod-operations.lock")
    || lower.endsWith("/pod-bindings.lock")
    || lower.endsWith("/pod-test-access.lock")
    || lower.endsWith("/pod-operations.lock.guard")
    || lower.endsWith("/pod-bindings.lock.guard")
    || lower.endsWith("/pod-test-access.lock.guard")
  ) {
    return { kind: "pod", state: "drain-required", blockerCodes: ["migration-owner-drain-required"] };
  }
  if (lower.includes("keep-live")) {
    return { kind: "keep-live", state: "drain-required", blockerCodes: ["migration-owner-drain-required"] };
  }
  if (classification?.artifact.kind === "legacy-readme") {
    return { kind: "local-readme", state: "observed", blockerCodes: [] };
  }
  if (
    classificationRequiresHostDecommission(classification)
    || isKnownLegacyHostIdentityResidue(normalized, type)
  ) {
    return { kind: "host-identity", state: "decommission-required", blockerCodes: ["migration-host-decommission-required"] };
  }
  if (isLegacyHostContainer(normalized, type)) {
    return { kind: "container", state: "observed", blockerCodes: [] };
  }
  if (lower.includes("wakeflow-delivery")) {
    return { kind: "transport", state: "correlation-required", blockerCodes: ["migration-domain-correlation-required"] };
  }
  if (lower.includes("preserved") || lower.includes("quarantine")) {
    return { kind: "preservation", state: "correlation-required", blockerCodes: ["migration-domain-correlation-required"] };
  }
  if (claim?.kind === "mixed-owned-surface") {
    return { kind: "mixed-owned", state: "observed", blockerCodes: [] };
  }
  if (["design-support", "test-support"].includes(claim?.surfaceKind)) {
    return { kind: "support-surface", state: "observed", blockerCodes: [] };
  }
  return { kind: type === "directory" ? "container" : "unclassified-source", state: "observed", blockerCodes: [] };
}

function ownershipFor(resource, claim) {
  const owners = {
    "active-demand": "legacy-state-owner",
    "active-root-residue": "legacy-state-owner",
    "config-source": "legacy-config-owner",
    "host-identity": "legacy-host-owner",
    "keep-live": "legacy-keep-live-owner",
    pod: "legacy-pod-owner",
    preservation: "legacy-preservation-owner",
    "stream-worktree": "legacy-stream-owner",
    transport: "legacy-transport-owner",
  };
  return owners[resource.kind] ?? claim?.ownership ?? "unknown";
}

function consumersFor(resource) {
  const consumers = {
    "active-demand": ["legacy-state-runtime", "migration-inventory"],
    "active-root-residue": ["legacy-state-runtime", "migration-inventory"],
    "config-source": ["legacy-config-loader", "migration-inventory"],
    "host-identity": ["legacy-host-runtime", "migration-inventory"],
    "keep-live": ["legacy-keep-live-runtime", "migration-inventory"],
    pod: ["legacy-pod-runtime", "migration-inventory"],
    preservation: ["legacy-preservation-reader", "migration-inventory"],
    "stream-worktree": ["legacy-stream-owner", "migration-inventory"],
    transport: ["legacy-delivery-runtime", "migration-inventory"],
  };
  return consumers[resource.kind] ?? ["migration-inventory"];
}

// ==================== 四、source/root/config事实组装 ====================

function buildSources({ workspaceRoot, claims, scanState }) {
  const publicSources = [];
  const byAbsolutePath = new Map();
  for (const node of [...scanState.nodes.values()].sort((left, right) => compareText(left.absolutePath, right.absolutePath))) {
    const { claim, contextConflict, matching } = classificationContext(claims, node.absolutePath);
    if (!claim) continue;
    const descriptorRef = relativePosix(claim.descriptorBasePath, node.absolutePath);
    const blockerCodes = new Set(node.blockerCodes);
    let classification = null;
    if (contextConflict) {
      blockerCodes.add("migration-source-context-conflict");
    } else if (node.type === "file" && node.bytes) {
      try {
        classification = classifyWakeflowLegacySource({
          gitIgnoreRoot: claim.gitIgnoreRoot,
          ownership: claim.ownership,
          relativePath: descriptorRef,
          sourceBytes: node.bytes,
          surfaceKind: claim.surfaceKind,
        });
      } catch {
        blockerCodes.add("migration-classifier-failed");
      }
      if (classification) {
        for (const code of classification.blockerCodes) blockerCodes.add(code);
        if (classification.confidence === "unknown") blockerCodes.add("migration-source-unrecognized");
        if (classification.defaultDisposition.action === "manual") blockerCodes.add("migration-source-manual");
      }
    } else if (node.type === "file") {
      blockerCodes.add("migration-source-unrecognized");
    }
    if (path.posix.basename(descriptorRef) === ".gitignore" && claim.gitIgnoreRoot === "unknown") {
      blockerCodes.add("migration-git-root-unproven");
    }
    const resource = resourceFor(descriptorRef, node.type, claim, classification);
    for (const code of resource.blockerCodes) blockerCodes.add(code);
    const privacy = contextConflict ? "local-sensitive" : sourcePrivacy(descriptorRef, classification);
    const visible = !contextConflict && privacy !== "local-secret" && safePortableRef(descriptorRef);
    const rootIds = matching.map((candidate) => candidate.rootId).sort(compareText);
    const identity = {
      digest: node.digest,
      path: visible ? descriptorRef : null,
      pathDigest: visible ? null : sha256(Buffer.from(canonicalJson({ descriptorRef, rootIds }), "utf8")),
      rootIds,
      size: node.size,
      type: node.type,
    };
    const sourceId = canonicalJsonDigest(identity);
    const output = {
      blockerCodes: sortedUnique(blockerCodes),
      childSourceIds: [],
      classification: publicClassification(classification),
      consumers: consumersFor(resource),
      digest: node.digest,
      mode: node.mode,
      owner: contextConflict ? "unknown" : ownershipFor(resource, claim),
      parentSourceId: null,
      path: identity.path,
      pathDigest: identity.pathDigest,
      privacy,
      resource: { kind: resource.kind, state: resource.state },
      rootIds,
      size: node.size,
      sourceId,
      sourceKind: classification?.artifact.kind ?? node.type,
      sourceVersion: classification?.artifact.schema ?? null,
      surfaceKind: contextConflict ? "ambiguous" : claim.surfaceKind,
      type: node.type,
    };
    publicSources.push(output);
    byAbsolutePath.set(node.absolutePath, output);
  }
  for (const [absolutePath, source] of byAbsolutePath) {
    const parent = byAbsolutePath.get(path.dirname(absolutePath)) ?? null;
    if (parent === null) continue;
    source.parentSourceId = parent.sourceId;
    parent.childSourceIds.push(source.sourceId);
  }
  for (const source of publicSources) source.childSourceIds.sort(compareText);
  publicSources.sort((left, right) => compareText(left.sourceId, right.sourceId));
  return { byAbsolutePath, publicSources };
}

function buildConfigSources(configs, sourceByPath) {
  const recognizedDurable = configs.filter((config) => (
    config.scope === "durable"
    && config.digest
    && config.intentDigest
    && config.topology
    && config.value
  ));
  const durableIntents = sortedUnique(recognizedDurable.map((config) => config.intentDigest));
  const durableTopologies = sortedUnique(recognizedDurable.map((config) => canonicalJsonDigest(config.topology)));
  const intentConflict = durableIntents.length > 1;
  const topologyConflict = durableTopologies.length > 1;
  return configs.map((config) => {
    const source = sourceByPath.get(config.absolutePath) ?? null;
    const blockerCodes = new Set(config.blockerCodes);
    let baseEvidence = null;
    if (config.scope === "local-overlay") {
      blockerCodes.add("migration-owner-drain-required");
      const baseHash = config.value?.derived?.baseHash;
      const baseRef = config.value?.derived?.from;
      const digestMatches = typeof baseHash === "string"
        ? recognizedDurable.filter((candidate) => candidate.digest === `sha256:${baseHash}`)
        : [];
      const exactMatches = typeof baseRef === "string"
        ? digestMatches.filter((candidate) => candidate.relativePath === baseRef)
        : [];
      const overlayBaseIntent = config.value
        ? canonicalJsonDigest(normalizedConfigIntent(config.value, { omitDerivedRepositories: true }))
        : null;
      if (exactMatches.length === 0 && (typeof baseHash === "string" || typeof baseRef === "string")) {
        baseEvidence = "mismatched-durable-source";
        blockerCodes.add("migration-overlay-base-mismatch");
      } else if (exactMatches.length > 0 && !exactMatches.some((candidate) => candidate.intentDigest === overlayBaseIntent)) {
        baseEvidence = "mismatched-durable-intent";
        blockerCodes.add("migration-overlay-intent-mismatch");
      } else if (exactMatches.length > 0) {
        baseEvidence = "matched-durable-source";
      } else {
        baseEvidence = "missing";
      }
    }
    if (intentConflict && config.scope === "durable" && config.intentDigest) {
      blockerCodes.add("migration-config-intent-conflict");
    }
    if (topologyConflict && config.scope === "durable" && config.topology) {
      blockerCodes.add("migration-config-topology-conflict");
    }
    if (source?.digest && config.digest && source.digest !== config.digest) {
      blockerCodes.add("migration-source-unstable");
    }
    return {
      baseEvidence,
      blockerCodes: sortedUnique(blockerCodes),
      classification: publicClassification(config.classification),
      intentDigest: config.intentDigest,
      rawDigest: config.digest,
      scope: config.scope,
      sourceId: source?.sourceId ?? canonicalJsonDigest({ configRef: config.relativePath, digest: config.digest }),
      topologyDigest: config.topology ? canonicalJsonDigest(config.topology) : null,
    };
  }).sort((left, right) => compareText(left.sourceId, right.sourceId));
}

function buildDomainFacts(sources) {
  const groups = new Map();
  for (const source of sources) {
    if (["container", "mixed-owned", "support-surface", "unclassified-source", "config-source"].includes(source.resource.kind)) continue;
    const key = `${source.resource.kind}:${source.resource.state}`;
    const group = groups.get(key) ?? {
      blockerCodes: new Set(),
      kind: source.resource.kind,
      sourceIds: [],
      state: source.resource.state,
    };
    group.sourceIds.push(source.sourceId);
    for (const code of source.blockerCodes.filter((item) => item.startsWith("migration-") && (
      item.includes("drain") || item.includes("correlation") || item.includes("decommission")
    ))) group.blockerCodes.add(code);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    blockerCodes: sortedUnique(group.blockerCodes),
    kind: group.kind,
    sourceIds: sortedUnique(group.sourceIds),
    state: group.state,
  })).sort((left, right) => compareText(`${left.kind}:${left.state}`, `${right.kind}:${right.state}`));
}

function buildRoots(claims, sources, scanState) {
  return claims.map((claim) => {
    const node = scanState.nodes.get(claim.absolutePath) ?? null;
    const covered = sources.filter((source) => source.rootIds.includes(claim.rootId));
    const blockerCodes = new Set(claim.blockerCodes);
    if (node) for (const code of node.blockerCodes) blockerCodes.add(code);
    return {
      blockerCodes: sortedUnique(blockerCodes),
      digest: node?.digest ?? null,
      exists: node !== null,
      gitIgnoreRoot: claim.gitIgnoreRoot,
      location: claim.location,
      ownership: claim.ownership,
      rootId: claim.rootId,
      rootKind: claim.kind,
      scanMode: claim.recursive ? "recursive" : "exact",
      sourceCount: covered.length,
      surfaceKind: claim.surfaceKind,
      type: node?.type ?? null,
    };
  }).sort((left, right) => compareText(left.rootId, right.rootId));
}

function buildBlockers({ roots, sources, configSources }) {
  const blockers = new Map();
  const physicalSourceIds = new Set(sources.map((source) => source.sourceId));
  function record(code, sourceId = null, rootId = null) {
    const value = blockers.get(code) ?? { code, rootIds: new Set(), sourceIds: new Set() };
    if (sourceId) value.sourceIds.add(sourceId);
    if (rootId) value.rootIds.add(rootId);
    blockers.set(code, value);
  }
  for (const root of roots) for (const code of root.blockerCodes) record(code, null, root.rootId);
  for (const source of sources) for (const code of source.blockerCodes) record(code, source.sourceId, null);
  // 配置发现可能在物理扫描器获准穿过symlink或不可读ancestor之前，就已证明候选不安全。
  // 该候选仍保留确定性的config fact ID，但它并不是physical source ID，不能泄漏进
  // source-reference闭包。
  for (const source of configSources) for (const code of source.blockerCodes) {
    record(code, physicalSourceIds.has(source.sourceId) ? source.sourceId : null, null);
  }
  return [...blockers.values()].map((blocker) => ({
    code: blocker.code,
    rootIds: sortedUnique(blocker.rootIds),
    sourceIds: sortedUnique(blocker.sourceIds),
  })).sort((left, right) => compareText(left.code, right.code));
}

function scanClaims(claims) {
  const state = { entryCount: 0, nodes: new Map(), totalBytes: 0 };
  const candidates = claims
    .filter((claim) => claim.scanAllowed)
    .map((claim) => {
      try {
        lstatSync(claim.absolutePath, { bigint: true });
        return claim;
      } catch (error) {
        if (error?.code !== "ENOENT") claim.blockerCodes.add("migration-source-unreadable");
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.absolutePath === right.absolutePath && left.recursive !== right.recursive) return left.recursive ? -1 : 1;
      return left.absolutePath.length - right.absolutePath.length || compareText(left.absolutePath, right.absolutePath);
    });
  const selected = [];
  for (const claim of candidates) {
    if (selected.some((candidate) => candidate.recursive && isWithin(candidate.absolutePath, claim.absolutePath))) continue;
    selected.push(claim);
  }
  for (const claim of selected) scanNode(claim.absolutePath, 0, state, { recursive: claim.recursive });
  // 被recursive父claim覆盖的exact claim仍必须在全局entry上限后留下显式limited节点，不能伪装成absent。
  for (const claim of candidates) {
    if (!state.nodes.has(claim.absolutePath)) {
      scanNode(claim.absolutePath, 0, state, { recursive: claim.recursive });
    }
  }
  return state;
}

function applyRootTopologyBlockers(claims, scanState) {
  const existing = claims.filter((claim) => scanState.nodes.has(claim.absolutePath));
  for (const claim of existing) {
    if (["old-active-root", "old-local-root"].includes(claim.kind)) {
      claim.blockerCodes.add("legacy-old-root-unsupported");
    }
  }

  const fixedActive = existing.find((claim) => claim.kind === "current-active-root") ?? null;
  const configuredActive = existing.filter((claim) => claim.kind === "configured-active-root");
  if (fixedActive) {
    for (const claim of configuredActive) {
      if (claim.absolutePath === fixedActive.absolutePath) continue;
      fixedActive.blockerCodes.add("migration-config-root-divergence");
      claim.blockerCodes.add("migration-config-root-divergence");
    }
  }

  for (const kind of ["configured-active-root", "configured-ledger-root"]) {
    const group = claims.filter((claim) => claim.kind === kind);
    if (new Set(group.map((claim) => claim.absolutePath)).size <= 1) continue;
    for (const claim of group) claim.blockerCodes.add("migration-config-root-divergence");
  }

  const authorityRoots = existing.filter((claim) => [
    "current-active-root",
    "current-local-root",
    "configured-active-root",
    "configured-ledger-root",
  ].includes(claim.kind));
  for (let leftIndex = 0; leftIndex < authorityRoots.length; leftIndex += 1) {
    const left = authorityRoots[leftIndex];
    for (const right of authorityRoots.slice(leftIndex + 1)) {
      if (left.absolutePath === right.absolutePath) continue;
      if (!isWithin(left.absolutePath, right.absolutePath) && !isWithin(right.absolutePath, left.absolutePath)) continue;
      left.blockerCodes.add("migration-config-root-overlap");
      right.blockerCodes.add("migration-config-root-overlap");
    }
  }
}

// ==================== 五、唯一公开只读入口 ====================

/**
 * 枚举一个显式legacy workspace的完整迁移输入，并返回确定、deep-frozen且不可授权的事实快照。
 * 本方法不写文件、不探测进程、不选择配置winner，也不把known classification提升为迁移资格。
 */
export function inspectWakeflowMigrationInventory(input) {
  const requestedRoot = exactInput(input);
  const { root: workspaceRoot } = inspectWorkspaceRoot(requestedRoot);
  const configs = CONFIG_CANDIDATES
    .map(([, relativePath, scope]) => inspectConfigCandidate(workspaceRoot, relativePath, scope))
    .filter(Boolean);
  const claims = discoverClaims(workspaceRoot, configs);
  const scanState = scanClaims(claims);
  applyRootTopologyBlockers(claims, scanState);
  const { byAbsolutePath, publicSources: sources } = buildSources({ workspaceRoot, claims, scanState });
  const configSources = buildConfigSources(configs, byAbsolutePath);
  const roots = buildRoots(claims, sources, scanState);
  const domainFacts = buildDomainFacts(sources);
  const blockers = buildBlockers({ roots, sources, configSources });
  const summary = {
    authorityEligible: false,
    blockerCount: blockers.length,
    directoryCount: sources.filter((source) => source.type === "directory").length,
    existingRootCount: roots.filter((root) => root.exists).length,
    fileCount: sources.filter((source) => source.type === "file").length,
    knownFileCount: sources.filter((source) => source.type === "file" && source.classification?.confidence !== "unknown" && source.classification !== null).length,
    manualSourceCount: sources.filter((source) => source.blockerCodes.length > 0).length,
    rootCount: roots.length,
    sourceCount: sources.length,
    specialCount: sources.filter((source) => !["directory", "file", "symlink"].includes(source.type)).length,
    symlinkCount: sources.filter((source) => source.type === "symlink").length,
    unknownFileCount: sources.filter((source) => source.type === "file" && (!source.classification || source.classification.confidence === "unknown")).length,
  };
  const payload = {
    artifactKind: WAKEFLOW_MIGRATION_INVENTORY_KIND,
    blockers,
    configSources,
    domainFacts,
    roots,
    schemaVersion: WAKEFLOW_MIGRATION_INVENTORY_SCHEMA_VERSION,
    sources,
    summary,
    workspace: {
      gitRoot: gitRootObservation(workspaceRoot),
      type: "directory",
    },
  };
  return deepFreeze({
    ...payload,
    inventoryDigest: canonicalJsonDigest(payload),
  });
}
