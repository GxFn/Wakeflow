import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND,
  WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION,
  inspectWakeflowArtifactTree,
  validateWakeflowArtifactTreeManifest,
} from "../../core/scripts/lib/wakeflow-artifact-tree-identity.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  inspectWakeflowLegacyScenarioFixtureDirectory,
} from "./wakeflow-legacy-scenario-fixtures.mjs";

export const WAKEFLOW_LEGACY_ORIGIN_FIXTURE_SCHEMA_VERSION = 1;
export const WAKEFLOW_LEGACY_ORIGIN_FIXTURE_KIND = "wakeflow-legacy-origin-fixture";
export const WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_SCHEMA_VERSION = 1;
export const WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_KIND = "wakeflow-legacy-origin-source-map";
export const WAKEFLOW_LEGACY_ORIGIN_GENERATION_COMMAND = Object.freeze([
  "node",
  "<artifact-root>/scripts/wakeflow-setup.mjs",
  "initialize",
  "--root",
  "<workspace-root>",
  "--parent",
  "<parent-root>",
  "--repo",
  "ProductWindow=../ProductWorkspace",
  "--internal-design",
  "--internal-test",
  "--language",
  "en",
  "--write",
  "--json",
]);
export const WAKEFLOW_LEGACY_ORIGIN_SYNTHETIC_TOPOLOGY = deepFreeze({
  design: Object.freeze({ mode: "internal", path: "WakeflowFixture/Design", windowName: "Design" }),
  interfaceLanguage: "en",
  parentDirectory: "wakeflow-fixture-parent",
  product: Object.freeze({ mode: "external", path: "ProductWorkspace", windowName: "ProductWindow" }),
  test: Object.freeze({ mode: "internal", path: "WakeflowFixture/Test", windowName: "Test" }),
  topologyId: "single-product-internal-design-internal-test-v1",
  workspaceDirectory: "WakeflowFixture",
});

const REQUEST_FIELDS = Object.freeze([
  "artifactRoot",
  "entrypoints",
  "layers",
  "originId",
  "rootFamily",
  "schemaVersion",
  "source",
]);
const SOURCE_REQUEST_FIELDS = Object.freeze([
  "artifactVersion",
  "commit",
  "host",
  "packageIntegrity",
]);
const ENTRYPOINT_REQUEST_FIELDS = Object.freeze(["ref", "role"]);
const LAYER_REQUEST_FIELDS = Object.freeze(["afterRoot", "beforeRoot", "layerId", "owner"]);
const ORIGIN_FIELDS = Object.freeze([
  "artifactKind",
  "eligibility",
  "generation",
  "originId",
  "rootFamily",
  "scenarios",
  "schemaVersion",
  "source",
  "staticLayers",
]);
const ORIGIN_SOURCE_FIELDS = Object.freeze([
  "artifactDigest",
  "artifactManifest",
  "artifactVersion",
  "commit",
  "host",
  "packageIntegrity",
  "sourceManifest",
]);
const SOURCE_MANIFEST_FIELDS = Object.freeze(["closurePolicy", "digest", "fileCount", "totalBytes"]);
const GENERATION_FIELDS = Object.freeze(["commandTemplate", "digest", "entrypoints", "topology"]);
const ENTRYPOINT_FIELDS = Object.freeze(["bytes", "digest", "executable", "ref", "role"]);
const STATIC_LAYER_FIELDS = Object.freeze([
  "directoryCount",
  "expectedEntries",
  "fileCount",
  "layerDigest",
  "layerId",
  "owner",
]);
const EXPECTED_ENTRY_FIELDS = Object.freeze([
  "afterBytes",
  "afterDigest",
  "afterExecutable",
  "afterType",
  "beforeBytes",
  "beforeDigest",
  "beforeExecutable",
  "beforeType",
  "normalizations",
  "operation",
  "owner",
  "path",
]);
const CANDIDATE_FIELDS = Object.freeze(["files", "fixtureDigest", "origin"]);
const CANDIDATE_FILE_FIELDS = Object.freeze(["bytes", "contentBase64", "digest", "executable", "ref"]);
const SOURCE_MAP_FIELDS = Object.freeze([
  "artifactKind",
  "audit",
  "boundaries",
  "counts",
  "hostArtifacts",
  "materializationPolicy",
  "schemaVersion",
]);
const SOURCE_MAP_AUDIT_FIELDS = Object.freeze(["boundaryRule", "branch", "head"]);
const SOURCE_MAP_BOUNDARY_FIELDS = Object.freeze([
  "artifactVersion",
  "commit",
  "ordinal",
  "originKind",
  "rootFamily",
]);
const SOURCE_MAP_COUNTS_FIELDS = Object.freeze([
  "boundaries",
  "currentRootDirectProducerCohortLowerBounds",
  "hostArtifacts",
  "hostArtifactsByHost",
  "rootFamilies",
]);
const SOURCE_MAP_HOST_FIELDS = Object.freeze(["artifactPath", "host", "unavailableCommits"]);
const HOST_COUNT_FIELDS = Object.freeze(["claudeCode", "codex"]);
const ROOT_FAMILY_COUNT_FIELDS = Object.freeze([
  "currentRootFlatCanonicalName",
  "currentRootFlatLegacyName",
  "currentRootV2",
  "oldRootFlat",
]);
const ROOT_FAMILIES = Object.freeze(new Map([
  ["current-root-flat-canonical-name", "conditional-auto"],
  ["current-root-flat-legacy-name", "conditional-auto"],
  ["current-root-v2", "conditional-auto"],
  ["old-root-flat", "manual"],
]));
const ROOT_FAMILY_COUNT_KEYS = Object.freeze(new Map([
  ["current-root-flat-canonical-name", "currentRootFlatCanonicalName"],
  ["current-root-flat-legacy-name", "currentRootFlatLegacyName"],
  ["current-root-v2", "currentRootV2"],
  ["old-root-flat", "oldRootFlat"],
]));
const HOST_IDS = Object.freeze(new Set(["claude-code", "codex"]));
const LAYER_OWNERS = Object.freeze(new Set([
  "claude-host-activation",
  "codex-host-activation",
  "shared-setup",
]));
const OPERATIONS = Object.freeze(new Set(["create", "remove", "replace"]));
const NODE_TYPES = Object.freeze(new Set(["directory", "file"]));
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SHA_INTEGRITY_PATTERN = /^(?:sha1|sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/u;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,126}[a-z0-9]$/u;
const SAFE_ROLE_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;
const UNSAFE_REF_CHARACTER_PATTERN = /[\\\u0000-\u001f\u007f\ufffd]/u;
const PRIVATE_TEXT_PATTERNS = Object.freeze([
  /\/(?:Users|home)\/[^/\s"']+/u,
  /\/(?:private\/)?var\/folders\//u,
  /[A-Za-z]:\\Users\\[^\\\s"']+/u,
  /\.(?:codex|claude)\/plugins\/cache\//u,
]);
const PRIVATE_JSON_KEYS = Object.freeze(new Set([
  "clientThreadId",
  "paneId",
  "pid",
  "processId",
  "rawHandle",
  "sessionId",
  "socketPath",
  "threadId",
  "tmuxTarget",
]));
const NORMALIZATION_FIELDS = Object.freeze(["kind", "pointer", "token"]);
const ISO_TIME_KEYS = Object.freeze(new Set([
  "createdAt",
  "generatedAt",
  "lastUpdatedAt",
  "recordedAt",
  "updatedAt",
]));
const ISO_TIME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/u;
const TREE_LIMITS = Object.freeze({
  maxDepth: 64,
  maxEntries: 32768,
  maxFileBytes: 32 * 1024 * 1024,
  maxRefBytes: 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

export class WakeflowLegacyOriginFixtureError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowLegacyOriginFixtureError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}) {
  throw new WakeflowLegacyOriginFixtureError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataObject(value, fields, at, code) {
  if (!isPlainObject(value)) fail(code, at, "expected a plain object");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) fail(code, at, "symbol properties are not allowed");
  const actual = /** @type {string[]} */ (keys).sort();
  const expected = [...fields].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(code, at, "object fields do not match the closed contract", { actual, expected });
  }
  const normalized = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${at}/${field}`, "fields must be enumerable data properties");
    }
    normalized[field] = descriptor.value;
  }
  return normalized;
}

function denseArray(value, at, code) {
  if (!Array.isArray(value)) fail(code, at, "expected an array");
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      fail(code, at, "array contains a non-index property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${at}/${key}`, "array entries must be enumerable data properties");
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code, `${at}/${index}`, "sparse arrays are not allowed");
    entries.push(Object.getOwnPropertyDescriptor(value, String(index)).value);
  }
  return entries;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBy(fields) {
  return (left, right) => {
    for (const field of fields) {
      const compared = compareText(left[field], right[field]);
      if (compared !== 0) return compared;
    }
    return 0;
  };
}

function nonEmptyString(value, at, code) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(code, at, "expected a non-empty string without outer whitespace");
  }
  return value;
}

function safeId(value, at, code) {
  const id = nonEmptyString(value, at, code);
  if (!SAFE_ID_PATTERN.test(id)) fail(code, at, "expected a lowercase portable identifier", { value: id });
  return id;
}

function safeRef(value, at, code = "wakeflow-legacy-origin-ref") {
  const ref = nonEmptyString(value, at, code);
  if (
    ref.length > TREE_LIMITS.maxRefBytes
    || Buffer.byteLength(ref, "utf8") > TREE_LIMITS.maxRefBytes
    || path.posix.isAbsolute(ref)
    || path.win32.isAbsolute(ref)
    || path.posix.normalize(ref) !== ref
    || ref.normalize("NFC") !== ref
    || UNSAFE_REF_CHARACTER_PATTERN.test(ref)
  ) {
    fail(code, at, "expected a canonical portable relative path", { ref });
  }
  const segments = ref.split("/");
  if (
    segments.length > TREE_LIMITS.maxDepth
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment !== segment.trim())
    || segments.includes(".git")
    || segments.includes(".DS_Store")
  ) {
    fail(code, at, "path contains a forbidden or noncanonical segment", { ref });
  }
  return ref;
}

function absoluteRoot(value, at, code) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || value.includes("\0")
  ) {
    fail(code, at, "expected a normalized absolute directory path");
  }
  let stat;
  try {
    stat = lstatSync(value);
  } catch (error) {
    fail(code, at, "directory is unavailable", { causeCode: error?.code ?? "unknown" });
  }
  if (stat.isSymbolicLink()) fail(`${code}-symlink`, at, "directory root cannot be a symbolic link");
  if (!stat.isDirectory()) fail(code, at, "path must identify a directory", { actualType: statType(stat) });
  try {
    return { lexical: value, real: realpathSync(value) };
  } catch (error) {
    fail(code, at, "directory cannot be resolved", { causeCode: error?.code ?? "unknown" });
  }
}

function statType(stat) {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isSocket()) return "socket";
  if (stat.isFIFO()) return "fifo";
  if (stat.isCharacterDevice()) return "character-device";
  if (stat.isBlockDevice()) return "block-device";
  return "unknown";
}

function sameStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.size === right.size;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readExactFile(file, ref) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (error) {
    fail("wakeflow-legacy-origin-tree-inspection", `$/tree/${ref}`, "cannot inspect static file", {
      ref,
      causeCode: error?.code ?? "unknown",
    });
  }
  if (before.isSymbolicLink()) {
    fail("wakeflow-legacy-origin-tree-symlink", `$/tree/${ref}`, "static tree cannot contain a symbolic link", { ref });
  }
  if (!before.isFile() || before.nlink !== 1n) {
    fail("wakeflow-legacy-origin-tree-special-node", `$/tree/${ref}`, "static tree contains an unsupported node", {
      ref,
      actualType: before.isFile() ? "hard-linked-file" : statType(before),
    });
  }
  if (before.size > BigInt(TREE_LIMITS.maxFileBytes)) {
    fail("wakeflow-legacy-origin-tree-file-bytes", `$/tree/${ref}`, "static file exceeds the byte bound", {
      ref,
      actual: String(before.size),
      limit: TREE_LIMITS.maxFileBytes,
    });
  }
  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = error?.code === "ELOOP"
      ? "wakeflow-legacy-origin-tree-symlink"
      : "wakeflow-legacy-origin-tree-inspection";
    fail(code, `$/tree/${ref}`, "cannot open exact static file", {
      ref,
      causeCode: error?.code ?? "unknown",
    });
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n) {
      fail("wakeflow-legacy-origin-tree-special-node", `$/tree/${ref}`, "opened static entry is not a regular file", {
        ref,
        actualType: opened.isFile() ? "hard-linked-file" : statType(opened),
      });
    }
    if (!sameStat(before, opened)) {
      fail("wakeflow-legacy-origin-tree-unstable", `$/tree/${ref}`, "static file changed while it was opened", { ref });
    }
    const expected = Number(opened.size);
    const buffer = Buffer.allocUnsafe(expected + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    let afterPath;
    try {
      afterPath = lstatSync(file, { bigint: true });
    } catch {
      fail("wakeflow-legacy-origin-tree-unstable", `$/tree/${ref}`, "static file path changed while it was read", { ref });
    }
    if (!sameStat(opened, after) || !sameStat(opened, afterPath) || offset !== expected) {
      fail("wakeflow-legacy-origin-tree-unstable", `$/tree/${ref}`, "static file changed while it was read", { ref });
    }
    const bytes = buffer.subarray(0, offset);
    return {
      bytes: bytes.length,
      contentBase64: bytes.toString("base64"),
      digest: sha256(bytes),
      executable: Boolean(after.mode & 0o111n),
      path: ref,
      type: "file",
    };
  } finally {
    closeSync(descriptor);
  }
}

function scanPortableTreeOnce(root) {
  const entries = [];
  const portableRefs = new Map();
  let totalBytes = 0;
  const visit = (directory, segments) => {
    const names = readBoundedDirectoryNames(directory, {
      code: "wakeflow-legacy-origin-tree-inspection",
      errorPath: "$",
      limit: TREE_LIMITS.maxEntries - entries.length + 1,
      message: "cannot enumerate static directory",
      ref: segments.join("/"),
    });
    for (const name of names) {
      const ref = safeRef([...segments, name].join("/"), `$/tree/${entries.length}`);
      const collisionKey = ref.toLowerCase();
      if (portableRefs.has(collisionKey)) {
        fail("wakeflow-legacy-origin-tree-ref-collision", `$/tree/${ref}`, "static refs collide under portable comparison", {
          ref,
          otherRef: portableRefs.get(collisionKey),
        });
      }
      portableRefs.set(collisionKey, ref);
      const absolute = path.join(directory, name);
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch (error) {
        fail("wakeflow-legacy-origin-tree-inspection", `$/tree/${ref}`, "cannot inspect static entry", {
          ref,
          causeCode: error?.code ?? "unknown",
        });
      }
      if (stat.isSymbolicLink()) {
        fail("wakeflow-legacy-origin-tree-symlink", `$/tree/${ref}`, "static tree cannot contain a symbolic link", { ref });
      }
      if (stat.isDirectory()) {
        entries.push({ path: ref, type: "directory" });
        if (entries.length > TREE_LIMITS.maxEntries) {
          fail("wakeflow-legacy-origin-tree-entry-count", "$/tree", "static tree exceeds the entry-count bound", {
            actual: entries.length,
            limit: TREE_LIMITS.maxEntries,
          });
        }
        visit(absolute, [...segments, name]);
        continue;
      }
      if (!stat.isFile()) {
        fail("wakeflow-legacy-origin-tree-special-node", `$/tree/${ref}`, "static tree contains an unsupported node", {
          ref,
          actualType: statType(stat),
        });
      }
      const entry = readExactFile(absolute, ref);
      totalBytes += entry.bytes;
      if (totalBytes > TREE_LIMITS.maxTotalBytes) {
        fail("wakeflow-legacy-origin-tree-total-bytes", "$/tree", "static tree exceeds the total-byte bound", {
          actual: totalBytes,
          limit: TREE_LIMITS.maxTotalBytes,
        });
      }
      entries.push(entry);
      if (entries.length > TREE_LIMITS.maxEntries) {
        fail("wakeflow-legacy-origin-tree-entry-count", "$/tree", "static tree exceeds the entry-count bound", {
          actual: entries.length,
          limit: TREE_LIMITS.maxEntries,
        });
      }
    }
  };
  visit(root, []);
  return entries.sort(compareBy(["path"]));
}

// 目录项在流式读取过程中实施上限，避免先由readdirSync分配一个无界数组再检查数量。
function readBoundedDirectoryNames(directory, {
  code,
  errorPath,
  limit,
  message,
  ref,
}) {
  const names = [];
  let handle;
  try {
    handle = opendirSync(directory);
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > limit) {
        fail(code, errorPath, `${message}: entry limit exceeded`, { limit, ref });
      }
    }
  } catch (error) {
    if (error instanceof WakeflowLegacyOriginFixtureError) throw error;
    fail(code, errorPath, message, { ref, causeCode: error?.code ?? "unknown" });
  } finally {
    handle?.closeSync();
  }
  return names.sort(compareText);
}

function scanPortableTree(root) {
  const first = scanPortableTreeOnce(root);
  const second = scanPortableTreeOnce(root);
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail("wakeflow-legacy-origin-tree-unstable", "$", "static tree changed between exact inventory passes");
  }
  return first;
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function pathTokenFor(value, mappings) {
  for (const mapping of mappings) {
    if (value === mapping.root) return mapping.token;
    const separator = mapping.root.includes("\\") ? "\\" : "/";
    if (!value.startsWith(`${mapping.root}${separator}`)) continue;
    const suffix = value.slice(mapping.root.length + 1).replaceAll("\\", "/");
    if (!suffix || suffix.split("/").some((segment) => !segment || segment === "." || segment === "..")) continue;
    return `${mapping.token}/${suffix}`;
  }
  return null;
}

function normalizeJsonStaticBytes({ bytes, mappings, ref }) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes) || text.includes("\0")) {
    fail("wakeflow-legacy-origin-static-encoding", `$/static/${ref}`, "checked fixture static files must be valid non-NUL UTF-8", { ref });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail("wakeflow-legacy-origin-static-json", `$/static/${ref}`, "static JSON fixture is invalid", {
      ref,
      cause: error.message,
    });
  }
  const replacements = new Map();
  const normalizations = [];
  const visit = (current, pointer = "$", key = null) => {
    if (Array.isArray(current)) {
      return current.map((child, index) => visit(child, `${pointer}/${index}`, String(index)));
    }
    if (!current || typeof current !== "object") {
      if (typeof current !== "string") return current;
      const pathToken = pathTokenFor(current, mappings);
      let normalized = current;
      let kind = null;
      let token = null;
      if (pathToken !== null) {
        normalized = pathToken;
        kind = "json-root-path";
        token = pathToken.startsWith("@wakeflow-fixture-artifact")
          ? "fixture-artifact-root"
          : "fixture-workspace-root";
      } else if (key === "command" && pointer.endsWith("/statusLine/command")) {
        const commandMatch = /^node "([^"]+)"$/u.exec(current);
        const commandTarget = commandMatch ? pathTokenFor(commandMatch[1], mappings) : null;
        if (new Set([
          "@wakeflow-fixture-root/WakeflowFixture/.wakeflow-local/wakeflow-statusline.mjs",
          "@wakeflow-fixture-root/WakeflowFixture/.workspace-local/wakeflow-statusline.mjs",
        ]).has(commandTarget)) {
          normalized = `node "${commandTarget}"`;
          kind = "json-statusline-command";
          token = "fixture-workspace-root";
        }
      } else if (key && ISO_TIME_KEYS.has(key) && ISO_TIME_PATTERN.test(current)) {
        normalized = "@wakeflow-fixture-iso-time";
        kind = "json-iso-time";
        token = "fixture-iso-time";
      }
      if (normalized !== current) {
        const existing = replacements.get(current);
        if (existing && existing !== normalized) {
          fail("wakeflow-legacy-origin-normalization", `$/static/${ref}`, "one raw JSON string maps to conflicting fixture tokens", { ref });
        }
        replacements.set(current, normalized);
        normalizations.push({ kind, pointer, token });
      }
      return normalized;
    }
    const result = {};
    for (const [childKey, child] of Object.entries(current)) {
      if (PRIVATE_JSON_KEYS.has(childKey) && child !== null && child !== "" && child !== false) {
        fail("wakeflow-legacy-origin-privacy", `$/static/${ref}`, "static fixture contains a real host/runtime identity field", {
          ref,
          field: childKey,
        });
      }
      result[childKey] = visit(child, `${pointer}/${pointerSegment(childKey)}`, childKey);
    }
    return result;
  };
  const normalizedValue = visit(parsed);
  let normalizedText = text;
  for (const [raw, normalized] of [...replacements.entries()].sort((left, right) => right[0].length - left[0].length)) {
    normalizedText = normalizedText.replaceAll(JSON.stringify(raw), JSON.stringify(normalized));
  }
  let reparsed;
  try {
    reparsed = JSON.parse(normalizedText);
  } catch {
    fail("wakeflow-legacy-origin-normalization", `$/static/${ref}`, "field-aware JSON normalization produced invalid JSON", { ref });
  }
  if (canonicalJson(reparsed) !== canonicalJson(normalizedValue)) {
    fail("wakeflow-legacy-origin-normalization", `$/static/${ref}`, "field-aware JSON normalization did not preserve non-slot structure", { ref });
  }
  const normalizedBytes = Buffer.from(normalizedText, "utf8");
  return {
    bytes: normalizedBytes.length,
    contentBase64: normalizedBytes.toString("base64"),
    digest: sha256(normalizedBytes),
    normalizations: normalizations.sort(compareBy(["pointer", "kind", "token"])),
  };
}

function normalizePortableTreeEntries(entries, { mappings }) {
  return entries.map((entry) => {
    if (entry.type !== "file") return { ...entry, normalizations: [] };
    const rawBytes = Buffer.from(entry.contentBase64, "base64");
    if (entry.path.endsWith(".json")) {
      return {
        ...entry,
        ...normalizeJsonStaticBytes({ bytes: rawBytes, mappings, ref: entry.path }),
      };
    }
    assertUtf8AndPrivacy({ bytes: rawBytes, inputRoots: mappings.map(({ root }) => root), ref: entry.path });
    return { ...entry, normalizations: [] };
  });
}

function nullableFileField(node, field) {
  return node?.type === "file" ? node[field] : null;
}

function changedNode(before, after) {
  if (!before || !after || before.type !== after.type) return true;
  if (before.type === "directory") return false;
  return before.bytes !== after.bytes
    || before.digest !== after.digest
    || before.executable !== after.executable;
}

function buildExpectedDelta({ afterEntries, beforeEntries, layerId, owner }) {
  const before = new Map(beforeEntries.map((entry) => [entry.path, entry]));
  const after = new Map(afterEntries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort(compareText);
  const expectedEntries = [];
  const outputFiles = [];
  for (const entryPath of paths) {
    const previous = before.get(entryPath) ?? null;
    const next = after.get(entryPath) ?? null;
    if (!changedNode(previous, next)) continue;
    const operation = previous && next ? "replace" : next ? "create" : "remove";
    expectedEntries.push({
      afterBytes: nullableFileField(next, "bytes"),
      afterDigest: nullableFileField(next, "digest"),
      afterExecutable: nullableFileField(next, "executable"),
      afterType: next?.type ?? null,
      beforeBytes: nullableFileField(previous, "bytes"),
      beforeDigest: nullableFileField(previous, "digest"),
      beforeExecutable: nullableFileField(previous, "executable"),
      beforeType: previous?.type ?? null,
      normalizations: next?.normalizations ?? [],
      operation,
      owner,
      path: entryPath,
    });
    if (next?.type === "file") {
      outputFiles.push({
        bytes: next.bytes,
        contentBase64: next.contentBase64,
        digest: next.digest,
        executable: next.executable,
        ref: `static/${layerId}/${entryPath}`,
      });
    }
  }
  const digestPayload = { expectedEntries, layerId, owner };
  return {
    layer: {
      directoryCount: expectedEntries.filter((entry) => entry.afterType === "directory").length,
      expectedEntries,
      fileCount: outputFiles.length,
      layerDigest: canonicalJsonDigest(digestPayload),
      layerId,
      owner,
    },
    outputFiles,
  };
}

function assertUtf8AndPrivacy({ bytes, inputRoots, ref }) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes) || text.includes("\0")) {
    fail("wakeflow-legacy-origin-static-encoding", `$/static/${ref}`, "checked fixture static files must be valid non-NUL UTF-8", { ref });
  }
  const rootHit = inputRoots.find((root) => root && text.includes(root));
  if (rootHit || PRIVATE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    fail("wakeflow-legacy-origin-privacy", `$/static/${ref}`, "static fixture contains a private absolute path or cache location", { ref });
  }
}

function normalizeSourceRequest(source) {
  const value = exactDataObject(source, SOURCE_REQUEST_FIELDS, "$/source", "wakeflow-legacy-origin-request-shape");
  const artifactVersion = nonEmptyString(
    value.artifactVersion,
    "$/source/artifactVersion",
    "wakeflow-legacy-origin-source",
  );
  if (!SEMVER_PATTERN.test(artifactVersion)) {
    fail("wakeflow-legacy-origin-source", "$/source/artifactVersion", "artifact version must be a canonical provenance semver");
  }
  const commit = nonEmptyString(value.commit, "$/source/commit", "wakeflow-legacy-origin-source");
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    fail("wakeflow-legacy-origin-source", "$/source/commit", "source commit must be an exact lowercase 40-hex object id");
  }
  const host = nonEmptyString(value.host, "$/source/host", "wakeflow-legacy-origin-source");
  if (!HOST_IDS.has(host)) fail("wakeflow-legacy-origin-source", "$/source/host", "unknown Wakeflow host", { host });
  const packageIntegrity = value.packageIntegrity;
  if (packageIntegrity !== null && (typeof packageIntegrity !== "string" || !SHA_INTEGRITY_PATTERN.test(packageIntegrity))) {
    fail("wakeflow-legacy-origin-source", "$/source/packageIntegrity", "package integrity must be null or a canonical Subresource Integrity value");
  }
  return { artifactVersion, commit, host, packageIntegrity };
}

function entrypointTuple(entry, artifactFiles, index) {
  const at = `$/entrypoints/${index}`;
  const value = exactDataObject(entry, ENTRYPOINT_REQUEST_FIELDS, at, "wakeflow-legacy-origin-request-shape");
  const role = nonEmptyString(value.role, `${at}/role`, "wakeflow-legacy-origin-entrypoint");
  if (!SAFE_ROLE_PATTERN.test(role)) fail("wakeflow-legacy-origin-entrypoint", `${at}/role`, "entrypoint role is invalid", { role });
  const ref = safeRef(value.ref, `${at}/ref`, "wakeflow-legacy-origin-entrypoint");
  const file = artifactFiles.get(ref);
  if (!file) fail("wakeflow-legacy-origin-entrypoint", `${at}/ref`, "entrypoint is absent from the exact artifact manifest", { ref });
  return { ...file, role };
}

function normalizeEntrypoints(input, artifactManifest, host) {
  const entries = denseArray(input, "$/entrypoints", "wakeflow-legacy-origin-request-shape");
  const artifactFiles = new Map(artifactManifest.files.map((entry) => [entry.ref, entry]));
  const normalized = entries.map((entry, index) => entrypointTuple(entry, artifactFiles, index));
  const sorted = [...normalized].sort(compareBy(["role", "ref"]));
  if (canonicalJson(normalized) !== canonicalJson(sorted)) {
    fail("wakeflow-legacy-origin-entrypoint", "$/entrypoints", "entrypoints must be unique and sorted by role then ref");
  }
  if (new Set(normalized.map(({ role }) => role)).size !== normalized.length) {
    fail("wakeflow-legacy-origin-entrypoint", "$/entrypoints", "entrypoint roles must be unique");
  }
  const byRole = new Map(normalized.map((entry) => [entry.role, entry]));
  if (byRole.get("setup")?.ref !== "scripts/wakeflow-setup.mjs") {
    fail("wakeflow-legacy-origin-entrypoint", "$/entrypoints", "setup entrypoint must be scripts/wakeflow-setup.mjs");
  }
  if (byRole.get("template-bundle")?.ref !== "templates/wakeflow-template-bundle.json") {
    fail("wakeflow-legacy-origin-entrypoint", "$/entrypoints", "template-bundle entrypoint must be the exact historical bundle");
  }
  if (host === "claude-code" && !byRole.has("host-helper")) {
    fail("wakeflow-legacy-origin-entrypoint", "$/entrypoints", "Claude origin requires its exact host-helper entrypoint");
  }
  if (host === "codex" && byRole.has("host-helper")) {
    fail("wakeflow-legacy-origin-entrypoint", "$/entrypoints", "Codex origin cannot contain a Claude host-helper placeholder");
  }
  return normalized;
}

function normalizeLayerRequest(layer, index, host) {
  const at = `$/layers/${index}`;
  const value = exactDataObject(layer, LAYER_REQUEST_FIELDS, at, "wakeflow-legacy-origin-request-shape");
  const layerId = safeId(value.layerId, `${at}/layerId`, "wakeflow-legacy-origin-layer");
  const owner = nonEmptyString(value.owner, `${at}/owner`, "wakeflow-legacy-origin-layer");
  if (!LAYER_OWNERS.has(owner)) fail("wakeflow-legacy-origin-layer", `${at}/owner`, "unknown static layer owner", { owner });
  if (owner === "claude-host-activation" && host !== "claude-code") {
    fail("wakeflow-legacy-origin-layer", `${at}/owner`, "Claude activation layer requires a Claude artifact");
  }
  if (owner === "codex-host-activation" && host !== "codex") {
    fail("wakeflow-legacy-origin-layer", `${at}/owner`, "Codex activation layer requires a Codex artifact");
  }
  const beforeRoot = absoluteRoot(value.beforeRoot, `${at}/beforeRoot`, "wakeflow-legacy-origin-tree-root");
  const afterRoot = absoluteRoot(value.afterRoot, `${at}/afterRoot`, "wakeflow-legacy-origin-tree-root");
  if (beforeRoot.real === afterRoot.real) {
    fail("wakeflow-legacy-origin-layer", at, "before and after roots must be distinct materialized trees");
  }
  return { afterRoot, beforeRoot, layerId, owner };
}

function candidateFile(ref, bytes, executable = false) {
  return {
    bytes: bytes.length,
    contentBase64: bytes.toString("base64"),
    digest: sha256(bytes),
    executable,
    ref: safeRef(ref, `$/files/${ref}`, "wakeflow-legacy-origin-candidate"),
  };
}

function manifestForCandidateFiles(files) {
  return validateWakeflowArtifactTreeManifest({
    artifactKind: WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND,
    fileCount: files.length,
    files: files.map(({ bytes, digest, executable, ref }) => ({ bytes, digest, executable, ref })),
    schemaVersion: WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION,
    totalBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
  });
}

export function buildWakeflowLegacyOriginFixture(request) {
  const value = exactDataObject(request, REQUEST_FIELDS, "$", "wakeflow-legacy-origin-request-shape");
  if (value.schemaVersion !== WAKEFLOW_LEGACY_ORIGIN_FIXTURE_SCHEMA_VERSION) {
    fail("wakeflow-legacy-origin-request-version", "$/schemaVersion", `expected ${WAKEFLOW_LEGACY_ORIGIN_FIXTURE_SCHEMA_VERSION}`);
  }
  const sourceRequest = normalizeSourceRequest(value.source);
  const originId = safeId(value.originId, "$/originId", "wakeflow-legacy-origin-id");
  const expectedPrefix = sourceRequest.host === "codex" ? "codex-" : "claude-code-";
  if (!originId.startsWith(expectedPrefix)) {
    fail("wakeflow-legacy-origin-id", "$/originId", `origin id must begin with ${expectedPrefix}`);
  }
  const rootFamily = nonEmptyString(value.rootFamily, "$/rootFamily", "wakeflow-legacy-origin-root-family");
  if (!ROOT_FAMILIES.has(rootFamily)) {
    fail("wakeflow-legacy-origin-root-family", "$/rootFamily", "unknown D40 root family", { rootFamily });
  }
  const artifactRoot = absoluteRoot(value.artifactRoot, "$/artifactRoot", "wakeflow-legacy-origin-artifact-root");
  let artifact;
  try {
    artifact = inspectWakeflowArtifactTree({ artifactRoot: artifactRoot.lexical });
  } catch (error) {
    if (error?.code) throw error;
    fail("wakeflow-legacy-origin-artifact", "$/artifactRoot", "cannot inspect exact historical artifact");
  }
  const entrypoints = normalizeEntrypoints(value.entrypoints, artifact.manifest, sourceRequest.host);
  const layerInputs = denseArray(value.layers, "$/layers", "wakeflow-legacy-origin-request-shape");
  if (layerInputs.length === 0) fail("wakeflow-legacy-origin-layer", "$/layers", "at least one explicit static layer is required");
  const normalizedLayers = layerInputs.map((layer, index) => normalizeLayerRequest(layer, index, sourceRequest.host));
  const sortedLayers = [...normalizedLayers].sort(compareBy(["layerId"]));
  if (canonicalJson(normalizedLayers.map(({ layerId, owner }) => ({ layerId, owner }))) !== canonicalJson(sortedLayers.map(({ layerId, owner }) => ({ layerId, owner })))) {
    fail("wakeflow-legacy-origin-layer", "$/layers", "layers must be unique and sorted by layerId");
  }
  if (new Set(normalizedLayers.map(({ layerId }) => layerId)).size !== normalizedLayers.length) {
    fail("wakeflow-legacy-origin-layer", "$/layers", "layer ids must be unique");
  }

  const inputRoots = [artifactRoot.lexical, artifactRoot.real];
  for (const layer of normalizedLayers) {
    inputRoots.push(layer.beforeRoot.lexical, layer.beforeRoot.real, layer.afterRoot.lexical, layer.afterRoot.real);
  }
  const pathMappings = [...new Set(inputRoots)]
    .map((root) => ({
      root,
      token: root === artifactRoot.lexical || root === artifactRoot.real
        ? "@wakeflow-fixture-artifact"
        : "@wakeflow-fixture-root",
    }))
    .sort((left, right) => right.root.length - left.root.length || compareText(left.root, right.root));
  const staticLayers = [];
  const staticOutputFiles = [];
  for (const layer of normalizedLayers) {
    const beforeEntries = normalizePortableTreeEntries(scanPortableTree(layer.beforeRoot.real), {
      mappings: pathMappings,
    });
    const afterEntries = normalizePortableTreeEntries(scanPortableTree(layer.afterRoot.real), {
      mappings: pathMappings,
    });
    const built = buildExpectedDelta({
      afterEntries,
      beforeEntries,
      layerId: layer.layerId,
      owner: layer.owner,
    });
    if (built.layer.expectedEntries.length === 0) {
      fail("wakeflow-legacy-origin-layer", `$/layers/${layer.layerId}`, "static layer has no exact generated delta");
    }
    staticLayers.push(built.layer);
    staticOutputFiles.push(...built.outputFiles);
  }
  for (const file of staticOutputFiles) {
    assertUtf8AndPrivacy({
      bytes: Buffer.from(file.contentBase64, "base64"),
      inputRoots: [...new Set(inputRoots)],
      ref: file.ref,
    });
  }

  const sourceManifest = {
    closurePolicy: "complete-artifact-tree-conservative",
    digest: artifact.artifactDigest,
    fileCount: artifact.manifest.fileCount,
    totalBytes: artifact.manifest.totalBytes,
  };
  const generationWithoutDigest = {
    commandTemplate: WAKEFLOW_LEGACY_ORIGIN_GENERATION_COMMAND,
    entrypoints,
    topology: WAKEFLOW_LEGACY_ORIGIN_SYNTHETIC_TOPOLOGY,
  };
  const generation = {
    commandTemplate: WAKEFLOW_LEGACY_ORIGIN_GENERATION_COMMAND,
    digest: canonicalJsonDigest({ ...generationWithoutDigest, sourceManifest }),
    entrypoints,
    topology: WAKEFLOW_LEGACY_ORIGIN_SYNTHETIC_TOPOLOGY,
  };
  const origin = validateWakeflowLegacyOriginFixture({
    artifactKind: WAKEFLOW_LEGACY_ORIGIN_FIXTURE_KIND,
    eligibility: ROOT_FAMILIES.get(rootFamily),
    generation,
    originId,
    rootFamily,
    scenarios: [],
    schemaVersion: WAKEFLOW_LEGACY_ORIGIN_FIXTURE_SCHEMA_VERSION,
    source: {
      artifactDigest: artifact.artifactDigest,
      artifactManifest: artifact.manifest,
      artifactVersion: sourceRequest.artifactVersion,
      commit: sourceRequest.commit,
      host: sourceRequest.host,
      packageIntegrity: sourceRequest.packageIntegrity,
      sourceManifest,
    },
    staticLayers,
  });
  const originBytes = Buffer.from(`${JSON.stringify(origin, null, 2)}\n`, "utf8");
  const files = [
    candidateFile("origin.json", originBytes),
    ...staticOutputFiles.map((file) => candidateFile(
      file.ref,
      Buffer.from(file.contentBase64, "base64"),
      file.executable,
    )),
  ].sort(compareBy(["ref"]));
  const fixtureDigest = canonicalJsonDigest(manifestForCandidateFiles(files));
  return deepFreeze({ files, fixtureDigest, origin });
}

function numberOrNull(value, at, code) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail(code, at, "expected null or a non-negative safe integer");
  return value;
}

function digestOrNull(value, at, code) {
  if (value === null) return null;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(code, at, "expected null or a canonical SHA-256 digest");
  return value;
}

function booleanOrNull(value, at, code) {
  if (value !== null && typeof value !== "boolean") fail(code, at, "expected null or boolean");
  return value;
}

function typeOrNull(value, at, code) {
  if (value === null) return null;
  if (!NODE_TYPES.has(value)) fail(code, at, "expected null, directory, or file");
  return value;
}

function validateNormalizations(value, at) {
  const inputs = denseArray(value, at, "wakeflow-legacy-origin-fixture-shape");
  const normalized = inputs.map((input, index) => {
    const itemAt = `${at}/${index}`;
    const item = exactDataObject(input, NORMALIZATION_FIELDS, itemAt, "wakeflow-legacy-origin-fixture-shape");
    if (!new Set(["json-iso-time", "json-root-path", "json-statusline-command"]).has(item.kind)) {
      fail("wakeflow-legacy-origin-fixture-shape", `${itemAt}/kind`, "unknown static normalization kind");
    }
    if (typeof item.pointer !== "string" || !/^\$(?:\/(?:[^/~]|~[01])*)*$/u.test(item.pointer)) {
      fail("wakeflow-legacy-origin-fixture-shape", `${itemAt}/pointer`, "normalization pointer must be a canonical JSON pointer");
    }
    if (!new Set(["fixture-artifact-root", "fixture-iso-time", "fixture-workspace-root"]).has(item.token)) {
      fail("wakeflow-legacy-origin-fixture-shape", `${itemAt}/token`, "unknown static normalization token");
    }
    if (
      (item.kind === "json-iso-time" && item.token !== "fixture-iso-time")
      || (item.kind !== "json-iso-time" && item.token === "fixture-iso-time")
      || (item.kind === "json-statusline-command" && item.token !== "fixture-workspace-root")
    ) {
      fail("wakeflow-legacy-origin-fixture-shape", itemAt, "normalization kind and token do not match");
    }
    return { kind: item.kind, pointer: item.pointer, token: item.token };
  });
  const sorted = [...normalized].sort(compareBy(["pointer", "kind", "token"]));
  if (canonicalJson(normalized) !== canonicalJson(sorted) || new Set(normalized.map((item) => canonicalJson(item))).size !== normalized.length) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "normalizations must be unique and sorted");
  }
  return normalized;
}

function validateExpectedEntry(input, index, owner) {
  const at = `$/staticLayers/expectedEntries/${index}`;
  const value = exactDataObject(input, EXPECTED_ENTRY_FIELDS, at, "wakeflow-legacy-origin-fixture-shape");
  const entryPath = safeRef(value.path, `${at}/path`, "wakeflow-legacy-origin-fixture-shape");
  if (value.owner !== owner) fail("wakeflow-legacy-origin-fixture-shape", `${at}/owner`, "expected entry owner must match its layer");
  if (!OPERATIONS.has(value.operation)) fail("wakeflow-legacy-origin-fixture-shape", `${at}/operation`, "unknown static delta operation");
  const beforeType = typeOrNull(value.beforeType, `${at}/beforeType`, "wakeflow-legacy-origin-fixture-shape");
  const afterType = typeOrNull(value.afterType, `${at}/afterType`, "wakeflow-legacy-origin-fixture-shape");
  const beforeBytes = numberOrNull(value.beforeBytes, `${at}/beforeBytes`, "wakeflow-legacy-origin-fixture-shape");
  const beforeDigest = digestOrNull(value.beforeDigest, `${at}/beforeDigest`, "wakeflow-legacy-origin-fixture-shape");
  const beforeExecutable = booleanOrNull(value.beforeExecutable, `${at}/beforeExecutable`, "wakeflow-legacy-origin-fixture-shape");
  const afterBytes = numberOrNull(value.afterBytes, `${at}/afterBytes`, "wakeflow-legacy-origin-fixture-shape");
  const afterDigest = digestOrNull(value.afterDigest, `${at}/afterDigest`, "wakeflow-legacy-origin-fixture-shape");
  const afterExecutable = booleanOrNull(value.afterExecutable, `${at}/afterExecutable`, "wakeflow-legacy-origin-fixture-shape");
  const normalizations = validateNormalizations(value.normalizations, `${at}/normalizations`);
  const beforeFileFields = [beforeBytes, beforeDigest, beforeExecutable];
  const afterFileFields = [afterBytes, afterDigest, afterExecutable];
  if ((beforeType === "file") !== beforeFileFields.every((field) => field !== null)) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "before file tuple must be complete only for a regular file");
  }
  if ((afterType === "file") !== afterFileFields.every((field) => field !== null)) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "after file tuple must be complete only for a regular file");
  }
  if (value.operation === "create" && (beforeType !== null || afterType === null)) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "create requires absent before and present after");
  }
  if (value.operation === "remove" && (beforeType === null || afterType !== null)) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "remove requires present before and absent after");
  }
  if (value.operation === "replace" && (beforeType === null || afterType === null)) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "replace requires present before and after");
  }
  if (afterType !== "file" && normalizations.length > 0) {
    fail("wakeflow-legacy-origin-fixture-shape", `${at}/normalizations`, "only an after regular file can declare normalizations");
  }
  return {
    afterBytes,
    afterDigest,
    afterExecutable,
    afterType,
    beforeBytes,
    beforeDigest,
    beforeExecutable,
    beforeType,
    normalizations,
    operation: value.operation,
    owner,
    path: entryPath,
  };
}

function validateStaticLayer(input, index, host) {
  const at = `$/staticLayers/${index}`;
  const value = exactDataObject(input, STATIC_LAYER_FIELDS, at, "wakeflow-legacy-origin-fixture-shape");
  const layerId = safeId(value.layerId, `${at}/layerId`, "wakeflow-legacy-origin-fixture-shape");
  if (!LAYER_OWNERS.has(value.owner)) fail("wakeflow-legacy-origin-fixture-shape", `${at}/owner`, "unknown static layer owner");
  if (value.owner === "claude-host-activation" && host !== "claude-code") {
    fail("wakeflow-legacy-origin-fixture-shape", `${at}/owner`, "Claude activation layer requires Claude provenance");
  }
  if (value.owner === "codex-host-activation" && host !== "codex") {
    fail("wakeflow-legacy-origin-fixture-shape", `${at}/owner`, "Codex activation layer requires Codex provenance");
  }
  const expectedEntries = denseArray(value.expectedEntries, `${at}/expectedEntries`, "wakeflow-legacy-origin-fixture-shape")
    .map((entry, entryIndex) => validateExpectedEntry(entry, entryIndex, value.owner));
  if (expectedEntries.length === 0) fail("wakeflow-legacy-origin-fixture-shape", `${at}/expectedEntries`, "static layer cannot be empty");
  const sorted = [...expectedEntries].sort(compareBy(["path"]));
  if (canonicalJson(expectedEntries) !== canonicalJson(sorted) || new Set(expectedEntries.map((entry) => entry.path)).size !== expectedEntries.length) {
    fail("wakeflow-legacy-origin-fixture-shape", `${at}/expectedEntries`, "expected entries must be unique and sorted by path");
  }
  const fileCount = expectedEntries.filter((entry) => entry.afterType === "file").length;
  const directoryCount = expectedEntries.filter((entry) => entry.afterType === "directory").length;
  if (value.fileCount !== fileCount || value.directoryCount !== directoryCount) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "static layer counts do not match expected entries");
  }
  const layerDigest = canonicalJsonDigest({ expectedEntries, layerId, owner: value.owner });
  if (value.layerDigest !== layerDigest) fail("wakeflow-legacy-origin-fixture-digest", `${at}/layerDigest`, "static layer digest does not match exact entries");
  return { directoryCount, expectedEntries, fileCount, layerDigest, layerId, owner: value.owner };
}

function validateTopology(value, at) {
  if (canonicalJson(value) !== canonicalJson(WAKEFLOW_LEGACY_ORIGIN_SYNTHETIC_TOPOLOGY)) {
    fail("wakeflow-legacy-origin-fixture-shape", at, "unknown synthetic topology contract");
  }
  return WAKEFLOW_LEGACY_ORIGIN_SYNTHETIC_TOPOLOGY;
}

export function validateWakeflowLegacyOriginFixture(origin) {
  const value = exactDataObject(origin, ORIGIN_FIELDS, "$", "wakeflow-legacy-origin-fixture-shape");
  if (value.schemaVersion !== WAKEFLOW_LEGACY_ORIGIN_FIXTURE_SCHEMA_VERSION) {
    fail("wakeflow-legacy-origin-fixture-version", "$/schemaVersion", `expected ${WAKEFLOW_LEGACY_ORIGIN_FIXTURE_SCHEMA_VERSION}`);
  }
  if (value.artifactKind !== WAKEFLOW_LEGACY_ORIGIN_FIXTURE_KIND) {
    fail("wakeflow-legacy-origin-fixture-kind", "$/artifactKind", `expected ${WAKEFLOW_LEGACY_ORIGIN_FIXTURE_KIND}`);
  }
  const originId = safeId(value.originId, "$/originId", "wakeflow-legacy-origin-fixture-shape");
  const rootFamily = nonEmptyString(value.rootFamily, "$/rootFamily", "wakeflow-legacy-origin-fixture-shape");
  if (!ROOT_FAMILIES.has(rootFamily) || value.eligibility !== ROOT_FAMILIES.get(rootFamily)) {
    fail("wakeflow-legacy-origin-fixture-shape", "$/eligibility", "eligibility must be derived from the exact D40 root family");
  }
  const sourceValue = exactDataObject(value.source, ORIGIN_SOURCE_FIELDS, "$/source", "wakeflow-legacy-origin-fixture-shape");
  const sourceRequest = normalizeSourceRequest({
    artifactVersion: sourceValue.artifactVersion,
    commit: sourceValue.commit,
    host: sourceValue.host,
    packageIntegrity: sourceValue.packageIntegrity,
  });
  const artifactManifest = validateWakeflowArtifactTreeManifest(sourceValue.artifactManifest);
  const artifactDigest = canonicalJsonDigest(artifactManifest);
  if (sourceValue.artifactDigest !== artifactDigest) {
    fail("wakeflow-legacy-origin-fixture-digest", "$/source/artifactDigest", "artifact digest does not match the complete tree manifest");
  }
  const sourceManifestValue = exactDataObject(
    sourceValue.sourceManifest,
    SOURCE_MANIFEST_FIELDS,
    "$/source/sourceManifest",
    "wakeflow-legacy-origin-fixture-shape",
  );
  const sourceManifest = {
    closurePolicy: sourceManifestValue.closurePolicy,
    digest: sourceManifestValue.digest,
    fileCount: sourceManifestValue.fileCount,
    totalBytes: sourceManifestValue.totalBytes,
  };
  if (
    sourceManifest.closurePolicy !== "complete-artifact-tree-conservative"
    || sourceManifest.digest !== artifactDigest
    || sourceManifest.fileCount !== artifactManifest.fileCount
    || sourceManifest.totalBytes !== artifactManifest.totalBytes
  ) {
    fail("wakeflow-legacy-origin-fixture-digest", "$/source/sourceManifest", "source manifest must bind the complete exact artifact tree");
  }
  const generationValue = exactDataObject(value.generation, GENERATION_FIELDS, "$/generation", "wakeflow-legacy-origin-fixture-shape");
  if (canonicalJson(generationValue.commandTemplate) !== canonicalJson(WAKEFLOW_LEGACY_ORIGIN_GENERATION_COMMAND)) {
    fail("wakeflow-legacy-origin-fixture-shape", "$/generation/commandTemplate", "generation command must use the fixed synthetic invocation");
  }
  const topology = validateTopology(generationValue.topology, "$/generation/topology");
  const artifactFiles = new Map(artifactManifest.files.map((entry) => [entry.ref, entry]));
  const entrypointInputs = denseArray(generationValue.entrypoints, "$/generation/entrypoints", "wakeflow-legacy-origin-fixture-shape");
  const entrypoints = entrypointInputs.map((input, index) => {
    const at = `$/generation/entrypoints/${index}`;
    const entry = exactDataObject(input, ENTRYPOINT_FIELDS, at, "wakeflow-legacy-origin-fixture-shape");
    const ref = safeRef(entry.ref, `${at}/ref`, "wakeflow-legacy-origin-fixture-shape");
    const role = nonEmptyString(entry.role, `${at}/role`, "wakeflow-legacy-origin-fixture-shape");
    const exact = artifactFiles.get(ref);
    if (!exact || canonicalJson(exact) !== canonicalJson({
      bytes: entry.bytes,
      digest: entry.digest,
      executable: entry.executable,
      ref,
    })) {
      fail("wakeflow-legacy-origin-fixture-digest", at, "entrypoint tuple does not match the exact artifact manifest");
    }
    return { ...exact, role };
  });
  const sortedEntrypoints = [...entrypoints].sort(compareBy(["role", "ref"]));
  if (canonicalJson(entrypoints) !== canonicalJson(sortedEntrypoints)) {
    fail("wakeflow-legacy-origin-fixture-shape", "$/generation/entrypoints", "entrypoints must be sorted by role then ref");
  }
  const roles = new Set(entrypoints.map(({ role }) => role));
  if (!roles.has("setup") || !roles.has("template-bundle") || (sourceRequest.host === "claude-code" && !roles.has("host-helper"))) {
    fail("wakeflow-legacy-origin-fixture-shape", "$/generation/entrypoints", "required generator entrypoint roles are missing");
  }
  const generation = {
    commandTemplate: WAKEFLOW_LEGACY_ORIGIN_GENERATION_COMMAND,
    digest: generationValue.digest,
    entrypoints,
    topology,
  };
  const expectedGenerationDigest = canonicalJsonDigest({
    commandTemplate: generation.commandTemplate,
    entrypoints,
    sourceManifest,
    topology,
  });
  if (generation.digest !== expectedGenerationDigest) {
    fail("wakeflow-legacy-origin-fixture-digest", "$/generation/digest", "generation digest does not match source, entrypoints, command, and topology");
  }
  const staticLayerInputs = denseArray(value.staticLayers, "$/staticLayers", "wakeflow-legacy-origin-fixture-shape");
  if (staticLayerInputs.length === 0) fail("wakeflow-legacy-origin-fixture-shape", "$/staticLayers", "origin fixture needs at least one static layer");
  const staticLayers = staticLayerInputs.map((layer, index) => validateStaticLayer(layer, index, sourceRequest.host));
  const sortedLayers = [...staticLayers].sort(compareBy(["layerId"]));
  if (canonicalJson(staticLayers) !== canonicalJson(sortedLayers) || new Set(staticLayers.map(({ layerId }) => layerId)).size !== staticLayers.length) {
    fail("wakeflow-legacy-origin-fixture-shape", "$/staticLayers", "static layers must be unique and sorted by layerId");
  }
  const scenarios = denseArray(value.scenarios, "$/scenarios", "wakeflow-legacy-origin-fixture-shape")
    .map((scenario, index) => safeRef(scenario, `$/scenarios/${index}`, "wakeflow-legacy-origin-fixture-shape"));
  if (canonicalJson(scenarios) !== canonicalJson([...scenarios].sort(compareText)) || new Set(scenarios).size !== scenarios.length) {
    fail("wakeflow-legacy-origin-fixture-shape", "$/scenarios", "scenario refs must be unique and sorted");
  }
  const normalized = {
    artifactKind: WAKEFLOW_LEGACY_ORIGIN_FIXTURE_KIND,
    eligibility: ROOT_FAMILIES.get(rootFamily),
    generation,
    originId,
    rootFamily,
    scenarios,
    schemaVersion: WAKEFLOW_LEGACY_ORIGIN_FIXTURE_SCHEMA_VERSION,
    source: {
      artifactDigest,
      artifactManifest,
      artifactVersion: sourceRequest.artifactVersion,
      commit: sourceRequest.commit,
      host: sourceRequest.host,
      packageIntegrity: sourceRequest.packageIntegrity,
      sourceManifest,
    },
    staticLayers,
  };
  const serialized = canonicalJson(normalized);
  if (PRIVATE_TEXT_PATTERNS.some((pattern) => pattern.test(serialized))) {
    fail("wakeflow-legacy-origin-privacy", "$", "origin provenance contains a private path or cache location");
  }
  return deepFreeze(normalized);
}

function validateCandidate(candidate) {
  const value = exactDataObject(candidate, CANDIDATE_FIELDS, "$", "wakeflow-legacy-origin-candidate");
  const origin = validateWakeflowLegacyOriginFixture(value.origin);
  const inputFiles = denseArray(value.files, "$/files", "wakeflow-legacy-origin-candidate");
  const files = inputFiles.map((input, index) => {
    const at = `$/files/${index}`;
    const entry = exactDataObject(input, CANDIDATE_FILE_FIELDS, at, "wakeflow-legacy-origin-candidate");
    const ref = safeRef(entry.ref, `${at}/ref`, "wakeflow-legacy-origin-candidate");
    if (typeof entry.contentBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(entry.contentBase64)) {
      fail("wakeflow-legacy-origin-candidate", `${at}/contentBase64`, "candidate content must be canonical base64");
    }
    const bytes = Buffer.from(entry.contentBase64, "base64");
    if (entry.bytes !== bytes.length || entry.digest !== sha256(bytes) || typeof entry.executable !== "boolean") {
      fail("wakeflow-legacy-origin-candidate", at, "candidate file tuple does not match exact bytes");
    }
    return {
      bytes: bytes.length,
      contentBase64: entry.contentBase64,
      digest: entry.digest,
      executable: entry.executable,
      ref,
    };
  });
  const sorted = [...files].sort(compareBy(["ref"]));
  if (canonicalJson(files) !== canonicalJson(sorted) || new Set(files.map(({ ref }) => ref)).size !== files.length) {
    fail("wakeflow-legacy-origin-candidate", "$/files", "candidate files must be unique and sorted");
  }
  if (files[0]?.ref !== "origin.json") fail("wakeflow-legacy-origin-candidate", "$/files", "candidate must include origin.json");
  const parsedOrigin = JSON.parse(Buffer.from(files[0].contentBase64, "base64").toString("utf8"));
  if (canonicalJson(parsedOrigin) !== canonicalJson(origin)) {
    fail("wakeflow-legacy-origin-candidate", "$/files/0", "origin.json bytes do not match validated provenance");
  }
  const fixtureDigest = canonicalJsonDigest(manifestForCandidateFiles(files));
  if (value.fixtureDigest !== fixtureDigest) fail("wakeflow-legacy-origin-candidate", "$/fixtureDigest", "fixture digest does not match exact candidate files");
  return deepFreeze({ files, fixtureDigest, origin });
}

export function summarizeWakeflowLegacyOriginFixture(candidate, {
  mode = "preview",
  writeResult = null,
} = {}) {
  const value = validateCandidate(candidate);
  if (!new Set(["preview", "write"]).has(mode)) {
    fail("wakeflow-legacy-origin-summary", "$/mode", "summary mode must be preview or write");
  }
  if (mode === "preview" && writeResult !== null) {
    fail("wakeflow-legacy-origin-summary", "$/writeResult", "preview cannot report a write result");
  }
  const normalizedWrite = writeResult === null
    ? null
    : deepFreeze({
        fixtureDigest: writeResult.fixtureDigest,
        relativeRoot: writeResult.relativeRoot,
        status: writeResult.status,
      });
  return deepFreeze({
    agentNext: mode === "preview"
      ? "Review the exact provenance, static delta, privacy result, and candidate diff before rerunning with --write."
      : "Review the checked-in origin.json and static delta diff; fixture creation is evidence, not migration acceptance.",
    artifactDigest: value.origin.source.artifactDigest,
    eligibility: value.origin.eligibility,
    fileCount: value.files.length,
    fixtureDigest: value.fixtureDigest,
    host: value.origin.source.host,
    mode,
    ok: true,
    originId: value.origin.originId,
    rootFamily: value.origin.rootFamily,
    scriptComplete: true,
    sourceManifestDigest: value.origin.source.sourceManifest.digest,
    staticLayers: value.origin.staticLayers.map((layer) => ({
      directoryCount: layer.directoryCount,
      entryCount: layer.expectedEntries.length,
      fileCount: layer.fileCount,
      layerDigest: layer.layerDigest,
      layerId: layer.layerId,
      owner: layer.owner,
    })),
    write: normalizedWrite,
  });
}

export function inspectWakeflowLegacyOriginFixtureDirectory({ fixtureRoot } = {}) {
  const root = absoluteRoot(
    fixtureRoot,
    "$/fixtureRoot",
    "wakeflow-legacy-origin-fixture-root",
  );
  const inventory = inspectWakeflowArtifactTree({ artifactRoot: root.lexical });
  const originEntry = inventory.manifest.files.find((entry) => entry.ref === "origin.json");
  if (!originEntry || originEntry.executable) {
    fail("wakeflow-legacy-origin-fixture-directory", "$/origin.json", "fixture root requires one non-executable origin.json");
  }
  let parsed;
  const originFile = path.join(root.real, "origin.json");
  let originBytes;
  try {
    const record = readExactFile(originFile, "origin.json");
    originBytes = Buffer.from(record.contentBase64, "base64");
    parsed = JSON.parse(originBytes.toString("utf8"));
  } catch {
    fail("wakeflow-legacy-origin-fixture-directory", "$/origin.json", "fixture origin.json is invalid");
  }
  const origin = validateWakeflowLegacyOriginFixture(parsed);
  const expectedFiles = new Map([["origin.json", {
    bytes: Buffer.byteLength(`${JSON.stringify(origin, null, 2)}\n`, "utf8"),
    digest: sha256(Buffer.from(`${JSON.stringify(origin, null, 2)}\n`, "utf8")),
    executable: false,
    ref: "origin.json",
  }]]);
  for (const layer of origin.staticLayers) {
    for (const entry of layer.expectedEntries) {
      if (entry.afterType !== "file") continue;
      const ref = `static/${layer.layerId}/${entry.path}`;
      expectedFiles.set(ref, {
        bytes: entry.afterBytes,
        digest: entry.afterDigest,
        executable: entry.afterExecutable,
        ref,
      });
    }
  }
  for (const scenario of origin.scenarios) {
    const segments = scenario.split("/");
    if (segments.length !== 2 || segments[1] !== "scenario.json" || segments[0] === "scenario.json") {
      fail(
        "wakeflow-legacy-origin-fixture-directory",
        "$/scenarios",
        "scenario refs must use <scenario-id>/scenario.json",
        { scenario },
      );
    }
    const scenarioRoot = path.join(root.real, "scenarios", segments[0]);
    const inspectedScenario = inspectWakeflowLegacyScenarioFixtureDirectory({
      origin,
      scenarioRoot,
    });
    if (inspectedScenario.manifest.scenarioId !== segments[0]) {
      fail("wakeflow-legacy-origin-fixture-directory", "$/scenarios", "scenario ref does not match its manifest id", {
        actual: inspectedScenario.manifest.scenarioId,
        expected: segments[0],
      });
    }
    for (const entry of inspectedScenario.expectedFiles) {
      const ref = `scenarios/${segments[0]}/${entry.ref}`;
      if (expectedFiles.has(ref)) {
        fail("wakeflow-legacy-origin-fixture-directory", "$/scenarios", "scenario output collides with another fixture file", { ref });
      }
      expectedFiles.set(ref, { ...entry, ref });
    }
  }
  const expected = [...expectedFiles.values()].sort(compareBy(["ref"]));
  if (canonicalJson(inventory.manifest.files) !== canonicalJson(expected)) {
    fail("wakeflow-legacy-origin-fixture-directory", "$", "fixture files do not match origin.json expected static tuples");
  }
  if (!originBytes.equals(Buffer.from(`${JSON.stringify(origin, null, 2)}\n`, "utf8"))) {
    fail("wakeflow-legacy-origin-fixture-directory", "$/origin.json", "origin.json must use the reviewable canonical pretty form");
  }
  for (const entry of expected) {
    if (entry.ref === "origin.json") continue;
    const record = readExactFile(path.join(root.real, ...entry.ref.split("/")), entry.ref);
    const bytes = Buffer.from(record.contentBase64, "base64");
    if (
      record.bytes !== entry.bytes
      || record.digest !== entry.digest
      || record.executable !== entry.executable
    ) {
      fail("wakeflow-legacy-origin-fixture-directory", `$/files/${entry.ref}`, "fixture file changed after inventory", { ref: entry.ref });
    }
    assertUtf8AndPrivacy({ bytes, inputRoots: [], ref: entry.ref });
    if (entry.ref.startsWith("scenarios/")) continue;
    if (entry.ref.endsWith(".json")) {
      const checked = normalizeJsonStaticBytes({ bytes, mappings: [], ref: entry.ref });
      if (checked.digest !== entry.digest || checked.normalizations.length !== 0) {
        fail("wakeflow-legacy-origin-fixture-directory", `$/files/${entry.ref}`, "checked JSON fixture still contains an unnormalized dynamic slot", { ref: entry.ref });
      }
    }
  }
  return deepFreeze({
    fileCount: inventory.manifest.fileCount,
    fixtureDigest: inventory.artifactDigest,
    origin,
    totalBytes: inventory.manifest.totalBytes,
  });
}

function exactNonNegativeInteger(value, at) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("wakeflow-legacy-origin-source-map-shape", at, "expected a non-negative safe integer");
  }
  return value;
}

function exactStringArray(value, at, validator) {
  const entries = denseArray(value, at, "wakeflow-legacy-origin-source-map-shape")
    .map((entry, index) => validator(entry, `${at}/${index}`));
  const sorted = [...entries].sort(compareText);
  if (canonicalJson(entries) !== canonicalJson(sorted) || new Set(entries).size !== entries.length) {
    fail("wakeflow-legacy-origin-source-map-shape", at, "values must be unique and lexically sorted");
  }
  return entries;
}

function validateSourceMapCounts(input, derived) {
  const value = exactDataObject(
    input,
    SOURCE_MAP_COUNTS_FIELDS,
    "$/counts",
    "wakeflow-legacy-origin-source-map-shape",
  );
  const hostCountsValue = exactDataObject(
    value.hostArtifactsByHost,
    HOST_COUNT_FIELDS,
    "$/counts/hostArtifactsByHost",
    "wakeflow-legacy-origin-source-map-shape",
  );
  const cohortValue = exactDataObject(
    value.currentRootDirectProducerCohortLowerBounds,
    HOST_COUNT_FIELDS,
    "$/counts/currentRootDirectProducerCohortLowerBounds",
    "wakeflow-legacy-origin-source-map-shape",
  );
  const familyValue = exactDataObject(
    value.rootFamilies,
    ROOT_FAMILY_COUNT_FIELDS,
    "$/counts/rootFamilies",
    "wakeflow-legacy-origin-source-map-shape",
  );
  const normalized = {
    boundaries: exactNonNegativeInteger(value.boundaries, "$/counts/boundaries"),
    currentRootDirectProducerCohortLowerBounds: {
      claudeCode: exactNonNegativeInteger(cohortValue.claudeCode, "$/counts/currentRootDirectProducerCohortLowerBounds/claudeCode"),
      codex: exactNonNegativeInteger(cohortValue.codex, "$/counts/currentRootDirectProducerCohortLowerBounds/codex"),
    },
    hostArtifacts: exactNonNegativeInteger(value.hostArtifacts, "$/counts/hostArtifacts"),
    hostArtifactsByHost: {
      claudeCode: exactNonNegativeInteger(hostCountsValue.claudeCode, "$/counts/hostArtifactsByHost/claudeCode"),
      codex: exactNonNegativeInteger(hostCountsValue.codex, "$/counts/hostArtifactsByHost/codex"),
    },
    rootFamilies: Object.fromEntries(ROOT_FAMILY_COUNT_FIELDS.map((field) => [
      field,
      exactNonNegativeInteger(familyValue[field], `$/counts/rootFamilies/${field}`),
    ])),
  };
  if (canonicalJson(normalized.boundaries) !== canonicalJson(derived.boundaries)
    || canonicalJson(normalized.hostArtifacts) !== canonicalJson(derived.hostArtifacts)
    || canonicalJson(normalized.hostArtifactsByHost) !== canonicalJson(derived.hostArtifactsByHost)
    || canonicalJson(normalized.rootFamilies) !== canonicalJson(derived.rootFamilies)) {
    fail("wakeflow-legacy-origin-source-map-counts", "$/counts", "declared source-map counts do not match exact boundaries and host availability");
  }
  if (
    normalized.currentRootDirectProducerCohortLowerBounds.codex < 16
    || normalized.currentRootDirectProducerCohortLowerBounds.claudeCode < 26
  ) {
    fail("wakeflow-legacy-origin-source-map-counts", "$/counts/currentRootDirectProducerCohortLowerBounds", "D40 direct-producer lower bounds cannot be reduced silently");
  }
  return normalized;
}

export function validateWakeflowLegacyOriginSourceMap(sourceMap) {
  const value = exactDataObject(
    sourceMap,
    SOURCE_MAP_FIELDS,
    "$",
    "wakeflow-legacy-origin-source-map-shape",
  );
  if (value.schemaVersion !== WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_SCHEMA_VERSION) {
    fail("wakeflow-legacy-origin-source-map-version", "$/schemaVersion", `expected ${WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_SCHEMA_VERSION}`);
  }
  if (value.artifactKind !== WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_KIND) {
    fail("wakeflow-legacy-origin-source-map-kind", "$/artifactKind", `expected ${WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_KIND}`);
  }
  const auditValue = exactDataObject(
    value.audit,
    SOURCE_MAP_AUDIT_FIELDS,
    "$/audit",
    "wakeflow-legacy-origin-source-map-shape",
  );
  const audit = {
    boundaryRule: nonEmptyString(auditValue.boundaryRule, "$/audit/boundaryRule", "wakeflow-legacy-origin-source-map-shape"),
    branch: nonEmptyString(auditValue.branch, "$/audit/branch", "wakeflow-legacy-origin-source-map-shape"),
    head: nonEmptyString(auditValue.head, "$/audit/head", "wakeflow-legacy-origin-source-map-shape"),
  };
  if (audit.boundaryRule !== "codex-package-version-change-plus-explicit-head" || audit.branch !== "main" || !/^[a-f0-9]{40}$/u.test(audit.head)) {
    fail("wakeflow-legacy-origin-source-map-shape", "$/audit", "audit baseline must use the exact frozen boundary rule, main branch, and 40-hex HEAD");
  }
  const boundaryInputs = denseArray(value.boundaries, "$/boundaries", "wakeflow-legacy-origin-source-map-shape");
  if (boundaryInputs.length === 0) fail("wakeflow-legacy-origin-source-map-shape", "$/boundaries", "source map needs at least one boundary");
  const seenCommits = new Set();
  const rootFamilies = Object.fromEntries(ROOT_FAMILY_COUNT_FIELDS.map((field) => [field, 0]));
  const boundaries = boundaryInputs.map((input, index) => {
    const at = `$/boundaries/${index}`;
    const boundary = exactDataObject(input, SOURCE_MAP_BOUNDARY_FIELDS, at, "wakeflow-legacy-origin-source-map-shape");
    if (boundary.ordinal !== index + 1) fail("wakeflow-legacy-origin-source-map-shape", `${at}/ordinal`, "boundary ordinals must be dense chronological positions");
    if (typeof boundary.commit !== "string" || !/^[a-f0-9]{40}$/u.test(boundary.commit) || seenCommits.has(boundary.commit)) {
      fail("wakeflow-legacy-origin-source-map-shape", `${at}/commit`, "boundary commit must be unique exact lowercase 40-hex");
    }
    seenCommits.add(boundary.commit);
    if (typeof boundary.artifactVersion !== "string" || !SEMVER_PATTERN.test(boundary.artifactVersion)) {
      fail("wakeflow-legacy-origin-source-map-shape", `${at}/artifactVersion`, "boundary artifact version must be canonical provenance semver");
    }
    if (!ROOT_FAMILIES.has(boundary.rootFamily)) {
      fail("wakeflow-legacy-origin-source-map-shape", `${at}/rootFamily`, "boundary has an unknown D40 root family");
    }
    if (!new Set(["head-snapshot", "package-version-boundary"]).has(boundary.originKind)) {
      fail("wakeflow-legacy-origin-source-map-shape", `${at}/originKind`, "boundary has an unknown provenance kind");
    }
    if ((boundary.originKind === "head-snapshot") !== (index === boundaryInputs.length - 1)) {
      fail("wakeflow-legacy-origin-source-map-shape", `${at}/originKind`, "only the final explicit audit HEAD can be a head snapshot");
    }
    rootFamilies[ROOT_FAMILY_COUNT_KEYS.get(boundary.rootFamily)] += 1;
    return {
      artifactVersion: boundary.artifactVersion,
      commit: boundary.commit,
      ordinal: boundary.ordinal,
      originKind: boundary.originKind,
      rootFamily: boundary.rootFamily,
    };
  });
  if (boundaries.at(-1).commit !== audit.head) {
    fail("wakeflow-legacy-origin-source-map-shape", "$/audit/head", "audit HEAD must equal the final explicit boundary");
  }
  const hostInputs = denseArray(value.hostArtifacts, "$/hostArtifacts", "wakeflow-legacy-origin-source-map-shape");
  const hostArtifacts = hostInputs.map((input, index) => {
    const at = `$/hostArtifacts/${index}`;
    const host = exactDataObject(input, SOURCE_MAP_HOST_FIELDS, at, "wakeflow-legacy-origin-source-map-shape");
    if (!HOST_IDS.has(host.host)) fail("wakeflow-legacy-origin-source-map-shape", `${at}/host`, "unknown source-map host");
    const expectedPath = host.host === "codex" ? "plugins/codex-wakeflow" : "plugins/claude-code-wakeflow";
    if (host.artifactPath !== expectedPath) fail("wakeflow-legacy-origin-source-map-shape", `${at}/artifactPath`, "host artifact path does not match repository ownership");
    const unavailableCommits = exactStringArray(host.unavailableCommits, `${at}/unavailableCommits`, (commit, commitAt) => {
      if (typeof commit !== "string" || !/^[a-f0-9]{40}$/u.test(commit) || !seenCommits.has(commit)) {
        fail("wakeflow-legacy-origin-source-map-shape", commitAt, "unavailable commit must be an exact mapped boundary");
      }
      return commit;
    });
    return { artifactPath: expectedPath, host: host.host, unavailableCommits };
  });
  const sortedHosts = [...hostArtifacts].sort(compareBy(["host"]));
  if (canonicalJson(hostArtifacts) !== canonicalJson(sortedHosts) || new Set(hostArtifacts.map(({ host }) => host)).size !== hostArtifacts.length || hostArtifacts.length !== 2) {
    fail("wakeflow-legacy-origin-source-map-shape", "$/hostArtifacts", "source map requires exactly one sorted record per host");
  }
  const hostArtifactsByHost = {
    claudeCode: boundaries.length - hostArtifacts.find(({ host }) => host === "claude-code").unavailableCommits.length,
    codex: boundaries.length - hostArtifacts.find(({ host }) => host === "codex").unavailableCommits.length,
  };
  const counts = validateSourceMapCounts(value.counts, {
    boundaries: boundaries.length,
    hostArtifacts: hostArtifactsByHost.claudeCode + hostArtifactsByHost.codex,
    hostArtifactsByHost,
    rootFamilies,
  });
  if (value.materializationPolicy !== "one-fixture-per-available-host-artifact") {
    fail("wakeflow-legacy-origin-source-map-shape", "$/materializationPolicy", "source map must derive one fixture per available host artifact");
  }
  return deepFreeze({
    artifactKind: WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_KIND,
    audit,
    boundaries,
    counts,
    hostArtifacts,
    materializationPolicy: value.materializationPolicy,
    schemaVersion: WAKEFLOW_LEGACY_ORIGIN_SOURCE_MAP_SCHEMA_VERSION,
  });
}

export function inspectWakeflowLegacyOriginSourceMap({ fixturesRoot } = {}) {
  const root = absoluteRoot(
    fixturesRoot,
    "$/fixturesRoot",
    "wakeflow-legacy-origin-source-map-root",
  );
  const sourceMapFile = path.join(root.real, "source-map.json");
  let sourceMapInput;
  try {
    const record = readExactFile(sourceMapFile, "source-map.json");
    sourceMapInput = JSON.parse(Buffer.from(record.contentBase64, "base64").toString("utf8"));
  } catch {
    fail("wakeflow-legacy-origin-source-map-file", "$/source-map.json", "source-map.json is missing, symlinked, or invalid");
  }
  const sourceMap = validateWakeflowLegacyOriginSourceMap(sourceMapInput);
  const expectedOrigins = sourceMap.boundaries.flatMap((boundary) => sourceMap.hostArtifacts
    .filter((host) => !host.unavailableCommits.includes(boundary.commit))
    .map((host) => ({
      artifactVersion: boundary.artifactVersion,
      host: host.host,
      originId: `${host.host}-${boundary.artifactVersion}-${boundary.commit.slice(0, 8)}`,
      rootFamily: boundary.rootFamily,
      sourceCommit: boundary.commit,
    })))
    .sort(compareBy(["originId"]));
  const expectedById = new Map(expectedOrigins.map((origin) => [origin.originId, origin]));
  const actualDirectories = [];
  const materializedOrigins = [];
  const rootNames = readBoundedDirectoryNames(root.real, {
    code: "wakeflow-legacy-origin-source-map-file",
    errorPath: "$/fixturesRoot",
    limit: Math.max(expectedOrigins.length + 1, 128),
    message: "cannot enumerate the legacy origin fixture root",
    ref: "",
  });
  for (const name of rootNames) {
    if (name === "source-map.json") continue;
    safeId(name, "$/fixturesRoot", "wakeflow-legacy-origin-source-map-file");
    const absolute = path.join(root.real, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("wakeflow-legacy-origin-source-map-file", "$/fixturesRoot", "legacy origin root contains an unregistered non-directory entry", { ref: name });
    }
    actualDirectories.push(name);
  }
  const unknown = actualDirectories.find((originId) => !expectedById.has(originId));
  if (unknown) {
    fail("wakeflow-legacy-origin-source-map-coverage", "$/fixturesRoot", "checked fixture directory is not derived from an available source-map host artifact", { originId: unknown });
  }
  for (const originId of actualDirectories) {
    const item = expectedById.get(originId);
    const inspected = inspectWakeflowLegacyOriginFixtureDirectory({
      fixtureRoot: path.join(root.real, originId),
    });
    if (
      inspected.origin.source.commit !== item.sourceCommit
      || inspected.origin.source.host !== item.host
      || inspected.origin.source.artifactVersion !== item.artifactVersion
      || inspected.origin.rootFamily !== item.rootFamily
    ) {
      fail("wakeflow-legacy-origin-source-map-coverage", `$/fixturesRoot/${originId}`, "materialized origin does not match its derived source-map tuple");
    }
    materializedOrigins.push(inspected.origin);
  }
  const pendingOriginIds = expectedOrigins
    .map(({ originId }) => originId)
    .filter((originId) => !actualDirectories.includes(originId));
  const cohortsByDigest = new Map();
  for (const origin of materializedOrigins) {
    const cohortDigest = canonicalJsonDigest({
      generationDigest: origin.generation.digest,
      host: origin.source.host,
      rootFamily: origin.rootFamily,
      sourceManifestDigest: origin.source.sourceManifest.digest,
      staticLayers: origin.staticLayers.map(({ layerDigest, layerId, owner }) => ({
        layerDigest,
        layerId,
        owner,
      })),
    });
    const key = `${origin.source.host}:${cohortDigest}`;
    const cohort = cohortsByDigest.get(key) ?? {
      cohortDigest,
      host: origin.source.host,
      originIds: [],
      rootFamily: origin.rootFamily,
    };
    cohort.originIds.push(origin.originId);
    cohortsByDigest.set(key, cohort);
  }
  const cohorts = [...cohortsByDigest.values()]
    .map((cohort) => ({ ...cohort, originIds: cohort.originIds.sort(compareText) }))
    .sort(compareBy(["host", "cohortDigest"]));
  const countCohorts = (host, currentRootOnly) => cohorts.filter((cohort) => (
    cohort.host === host
    && (!currentRootOnly || cohort.rootFamily !== "old-root-flat")
  )).length;
  const cohortCounts = {
    all: {
      claudeCode: countCohorts("claude-code", false),
      codex: countCohorts("codex", false),
    },
    currentRoot: {
      claudeCode: countCohorts("claude-code", true),
      codex: countCohorts("codex", true),
    },
  };
  const lowerBounds = sourceMap.counts.currentRootDirectProducerCohortLowerBounds;
  if (
    cohortCounts.currentRoot.claudeCode < lowerBounds.claudeCode
    || cohortCounts.currentRoot.codex < lowerBounds.codex
  ) {
    fail("wakeflow-legacy-origin-source-map-cohort", "$/fixturesRoot", "complete source/output cohorts fell below the audited direct-producer lower bound");
  }
  return deepFreeze({
    cohortCounts,
    cohorts,
    materializedHostArtifacts: actualDirectories.length,
    materializedOriginIds: actualDirectories,
    pendingHostArtifacts: pendingOriginIds.length,
    pendingOriginIds,
    sourceMap,
  });
}

function validateRepositoryRoot(repoRoot) {
  const inspected = absoluteRoot(repoRoot, "$/repoRoot", "wakeflow-legacy-origin-repository-root");
  const packageFile = path.join(inspected.real, "package.json");
  let packageStat;
  try {
    packageStat = lstatSync(packageFile, { bigint: true });
  } catch {
    packageStat = null;
  }
  if (!packageStat || packageStat.isSymbolicLink() || !packageStat.isFile() || packageStat.nlink !== 1n) {
    fail("wakeflow-legacy-origin-repository-root", "$/repoRoot", "repository root must contain package.json");
  }
  return inspected.real;
}

// --write只拥有固定test/fixtures/legacy-origins链；逐层拒绝链接，避免recursive mkdir
// 经由仓库内替换节点把历史fixture写到仓库之外。
function ensureLegacyFixtureParent(repositoryRoot) {
  let current = repositoryRoot;
  for (const segment of ["test", "fixtures", "legacy-origins"]) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        fail("wakeflow-legacy-origin-write-boundary", "$/repoRoot", "fixture parent cannot be inspected");
      }
      mkdirSync(current, { mode: 0o755 });
      stat = lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("wakeflow-legacy-origin-write-boundary", "$/repoRoot", "fixture parent must contain only real directories");
    }
  }
  return current;
}

export function writeWakeflowLegacyOriginFixture({ candidate, repoRoot } = {}) {
  const value = validateCandidate(candidate);
  const repositoryRoot = validateRepositoryRoot(repoRoot);
  const relativeRoot = `test/fixtures/legacy-origins/${value.origin.originId}`;
  const parent = ensureLegacyFixtureParent(repositoryRoot);
  const target = path.join(parent, value.origin.originId);

  let targetStat;
  try {
    targetStat = lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail("wakeflow-legacy-origin-write-conflict", "$/candidate", "origin fixture target cannot be inspected");
    }
    targetStat = null;
  }
  if (targetStat) {
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      fail("wakeflow-legacy-origin-write-conflict", "$/candidate", "existing origin fixture target is not one real directory");
    }
    let current;
    try {
      current = inspectWakeflowArtifactTree({ artifactRoot: target });
    } catch {
      fail("wakeflow-legacy-origin-write-conflict", "$/candidate", "existing origin fixture is not the exact candidate");
    }
    if (current.artifactDigest !== value.fixtureDigest) {
      fail("wakeflow-legacy-origin-write-conflict", "$/candidate", "existing origin fixture differs; review its diff instead of overwriting it");
    }
    return deepFreeze({ fixtureDigest: value.fixtureDigest, relativeRoot, status: "unchanged" });
  }

  const stage = mkdtempSync(path.join(parent, ".wakeflow-legacy-origin-stage-"));
  try {
    for (const file of value.files) {
      const destination = path.join(stage, ...file.ref.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      writeFileSync(destination, Buffer.from(file.contentBase64, "base64"), {
        flag: "wx",
        mode: file.executable ? 0o755 : 0o644,
      });
      chmodSync(destination, file.executable ? 0o755 : 0o644);
    }
    const staged = inspectWakeflowArtifactTree({ artifactRoot: stage });
    if (staged.artifactDigest !== value.fixtureDigest) {
      fail("wakeflow-legacy-origin-write-verification", "$/candidate", "staged fixture digest does not match the exact candidate");
    }
    try {
      renameSync(stage, target);
    } catch (error) {
      fail("wakeflow-legacy-origin-write-conflict", "$/candidate", "origin fixture target appeared before publish", {
        causeCode: error?.code ?? "unknown",
      });
    }
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
  return deepFreeze({ fixtureDigest: value.fixtureDigest, relativeRoot, status: "created" });
}
