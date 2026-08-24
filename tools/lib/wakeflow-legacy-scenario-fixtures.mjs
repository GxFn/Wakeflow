import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { createHash } from "node:crypto";
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

export const WAKEFLOW_LEGACY_SCENARIO_SCHEMA_VERSION = 1;
export const WAKEFLOW_LEGACY_SCENARIO_KIND = "wakeflow-legacy-lifecycle-scenario";

const MANIFEST_FIELDS = Object.freeze([
  "artifactKind",
  "beforeManifest",
  "category",
  "commandSequence",
  "deltaEntries",
  "host",
  "materializationMode",
  "normalizations",
  "outputManifest",
  "producer",
  "scenarioDigest",
  "scenarioId",
  "schemaVersion",
]);
const PRODUCER_FIELDS = Object.freeze([
  "artifactDigest",
  "sourceCommit",
  "sourceFiles",
]);
const SOURCE_FILE_FIELDS = Object.freeze([
  "bytes",
  "digest",
  "executable",
  "ref",
  "role",
]);
const COMMAND_FIELDS = Object.freeze(["argv", "stepId"]);
const NORMALIZATION_FIELDS = Object.freeze(["kind", "ref", "selector", "token"]);
const DELTA_ENTRY_FIELDS = Object.freeze([
  "afterBytes",
  "afterDigest",
  "afterExecutable",
  "afterType",
  "beforeBytes",
  "beforeDigest",
  "beforeExecutable",
  "beforeType",
  "operation",
  "path",
]);
const HOSTS = Object.freeze(new Set(["claude-code", "codex"]));
const MATERIALIZATION_MODES = Object.freeze(new Set(["historical-seed", "real-writer"]));
const CATEGORIES = Object.freeze(new Set([
  "claude-settings",
  "claude-window-operation",
  "identity",
  "keep-live",
  "pod",
  "preservation",
  "retired-material",
  "stream-worktree",
  "transport-result-review",
]));
const NORMALIZATION_KINDS = Object.freeze(new Set([
  "json-pointer-token",
  "path-token",
  "text-token",
]));

function sameFileIdentity(left, right) {
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

// fixture inventory给出精确tuple；后续语义读取仍需重新闭合文件身份，不能用普通
// readFileSync把两遍inventory之间的替换或增长竞态重新引入。
function readExactScenarioFile(file, expected, ref) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch {
    fail("wakeflow-legacy-scenario-directory", `$/files/${ref}`, "scenario file is missing");
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || before.size !== BigInt(expected.bytes)
  ) {
    fail("wakeflow-legacy-scenario-directory", `$/files/${ref}`, "scenario file is not one exact single-link regular file");
  }
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      fail("wakeflow-legacy-scenario-directory", `$/files/${ref}`, "scenario file changed before open");
    }
    const buffer = Buffer.allocUnsafe(expected.bytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    let afterPath;
    try {
      afterPath = lstatSync(file, { bigint: true });
    } catch {
      fail("wakeflow-legacy-scenario-directory", `$/files/${ref}`, "scenario file path changed while reading");
    }
    const bytes = buffer.subarray(0, offset);
    if (
      offset !== expected.bytes
      || !sameFileIdentity(opened, afterDescriptor)
      || !sameFileIdentity(opened, afterPath)
      || sha256Bytes(bytes) !== expected.digest
      || Boolean(afterDescriptor.mode & 0o111n) !== expected.executable
    ) {
      fail("wakeflow-legacy-scenario-directory", `$/files/${ref}`, "scenario file changed after inventory");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
const OPERATIONS = Object.freeze(new Set(["create", "remove", "replace"]));
const NODE_TYPES = Object.freeze(new Set(["directory", "file"]));
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SAFE_ROLE_PATTERN = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const TOKEN_PATTERN = /^@wakeflow-scenario-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const UNSAFE_REF_CHARACTER_PATTERN = /[\\\u0000-\u001f\u007f\ufffd]/u;
const PRIVATE_TEXT_PATTERNS = Object.freeze([
  /\/(?:Users|home)\/[^/\s"']+/u,
  /\/(?:private\/)?var\/folders\//u,
  /[A-Za-z]:\\Users\\[^\\\s"']+/u,
  /\.(?:codex|claude)\/plugins\/cache\//u,
]);
const PRIVATE_JSON_KEYS = Object.freeze(new Set([
  "childPid",
  "clientThreadId",
  "paneId",
  "pid",
  "processId",
  "rawHandle",
  "session",
  "sessionId",
  "socketPath",
  "threadId",
  "token",
  "tmuxTarget",
  "windowId",
  "workerPid",
]));

export class WakeflowLegacyScenarioFixtureError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowLegacyScenarioFixtureError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}) {
  throw new WakeflowLegacyScenarioFixtureError(code, `${message} at ${errorPath}`, {
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

function safeRef(value, at, code) {
  const ref = nonEmptyString(value, at, code);
  if (
    ref.length > 1024
    || Buffer.byteLength(ref, "utf8") > 1024
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
    segments.length > 64
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment !== segment.trim())
    || segments.includes(".git")
    || segments.includes(".DS_Store")
  ) {
    fail(code, at, "path contains a forbidden or noncanonical segment", { ref });
  }
  return ref;
}

function nonNegativeInteger(value, at, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code, at, "expected a non-negative safe integer");
  return value;
}

function digest(value, at, code) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(code, at, "expected a canonical SHA-256 digest");
  }
  return value;
}

function digestOrNull(value, at, code) {
  if (value === null) return null;
  return digest(value, at, code);
}

function sourceCommit(value, at, code) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    fail(code, at, "expected an exact 40-character lowercase source commit");
  }
  return value;
}

function assertSortedUnique(values, sorted, at, code) {
  if (canonicalJson(values) !== canonicalJson(sorted) || new Set(values.map((value) => canonicalJson(value))).size !== values.length) {
    fail(code, at, "entries must be unique and canonically sorted");
  }
}

function normalizeSourceFile(input, index) {
  const at = `$/producer/sourceFiles/${index}`;
  const value = exactDataObject(input, SOURCE_FILE_FIELDS, at, "wakeflow-legacy-scenario-shape");
  const role = nonEmptyString(value.role, `${at}/role`, "wakeflow-legacy-scenario-shape");
  if (!SAFE_ROLE_PATTERN.test(role)) fail("wakeflow-legacy-scenario-shape", `${at}/role`, "source role is not portable");
  if (typeof value.executable !== "boolean") fail("wakeflow-legacy-scenario-shape", `${at}/executable`, "expected boolean");
  return {
    bytes: nonNegativeInteger(value.bytes, `${at}/bytes`, "wakeflow-legacy-scenario-shape"),
    digest: digest(value.digest, `${at}/digest`, "wakeflow-legacy-scenario-shape"),
    executable: value.executable,
    ref: safeRef(value.ref, `${at}/ref`, "wakeflow-legacy-scenario-shape"),
    role,
  };
}

function normalizeCommand(input, index) {
  const at = `$/commandSequence/${index}`;
  const value = exactDataObject(input, COMMAND_FIELDS, at, "wakeflow-legacy-scenario-shape");
  const stepId = safeId(value.stepId, `${at}/stepId`, "wakeflow-legacy-scenario-shape");
  const argv = denseArray(value.argv, `${at}/argv`, "wakeflow-legacy-scenario-shape")
    .map((item, itemIndex) => nonEmptyString(item, `${at}/argv/${itemIndex}`, "wakeflow-legacy-scenario-shape"));
  if (argv.length < 2 || argv[0] !== "node" || !argv[1].startsWith("<artifact-root>/")) {
    fail("wakeflow-legacy-scenario-command", `${at}/argv`, "writer commands must use node plus an explicit artifact-root placeholder");
  }
  const serialized = canonicalJson(argv);
  if (PRIVATE_TEXT_PATTERNS.some((pattern) => pattern.test(serialized))) {
    fail("wakeflow-legacy-scenario-privacy", `${at}/argv`, "command contains a private path or cache location");
  }
  return { argv, stepId };
}

function normalizeNormalization(input, index) {
  const at = `$/normalizations/${index}`;
  const value = exactDataObject(input, NORMALIZATION_FIELDS, at, "wakeflow-legacy-scenario-shape");
  const kind = nonEmptyString(value.kind, `${at}/kind`, "wakeflow-legacy-scenario-shape");
  if (!NORMALIZATION_KINDS.has(kind)) fail("wakeflow-legacy-scenario-shape", `${at}/kind`, "unknown normalization kind");
  const token = nonEmptyString(value.token, `${at}/token`, "wakeflow-legacy-scenario-shape");
  if (!TOKEN_PATTERN.test(token)) fail("wakeflow-legacy-scenario-shape", `${at}/token`, "normalization token is not portable");
  return {
    kind,
    ref: safeRef(value.ref, `${at}/ref`, "wakeflow-legacy-scenario-shape"),
    selector: nonEmptyString(value.selector, `${at}/selector`, "wakeflow-legacy-scenario-shape"),
    token,
  };
}

function nodeTypeOrNull(value, at) {
  if (value === null) return null;
  if (typeof value !== "string" || !NODE_TYPES.has(value)) {
    fail("wakeflow-legacy-scenario-delta", at, "expected null, file, or directory");
  }
  return value;
}

function integerOrNull(value, at) {
  if (value === null) return null;
  return nonNegativeInteger(value, at, "wakeflow-legacy-scenario-delta");
}

function booleanOrNull(value, at) {
  if (value !== null && typeof value !== "boolean") {
    fail("wakeflow-legacy-scenario-delta", at, "expected null or boolean");
  }
  return value;
}

function normalizeNodeTuple({ bytes, digest: digestValue, executable, type }, at) {
  const normalizedType = nodeTypeOrNull(type, `${at}Type`);
  const normalizedBytes = integerOrNull(bytes, `${at}Bytes`);
  const normalizedDigest = digestOrNull(digestValue, `${at}Digest`, "wakeflow-legacy-scenario-delta");
  const normalizedExecutable = booleanOrNull(executable, `${at}Executable`);
  if (normalizedType === null) {
    if (normalizedBytes !== null || normalizedDigest !== null || normalizedExecutable !== null) {
      fail("wakeflow-legacy-scenario-delta", at, "absent nodes require null metadata");
    }
  } else if (normalizedType === "directory") {
    if (normalizedBytes !== null || normalizedDigest !== null || normalizedExecutable !== null) {
      fail("wakeflow-legacy-scenario-delta", at, "directory nodes require null file metadata");
    }
  } else if (normalizedBytes === null || normalizedDigest === null || normalizedExecutable === null) {
    fail("wakeflow-legacy-scenario-delta", at, "file nodes require bytes, digest, and executable");
  }
  return {
    bytes: normalizedBytes,
    digest: normalizedDigest,
    executable: normalizedExecutable,
    type: normalizedType,
  };
}

function normalizeDeltaEntry(input, index) {
  const at = `$/deltaEntries/${index}`;
  const value = exactDataObject(input, DELTA_ENTRY_FIELDS, at, "wakeflow-legacy-scenario-delta");
  const entryPath = safeRef(value.path, `${at}/path`, "wakeflow-legacy-scenario-delta");
  const operation = nonEmptyString(value.operation, `${at}/operation`, "wakeflow-legacy-scenario-delta");
  if (!OPERATIONS.has(operation)) fail("wakeflow-legacy-scenario-delta", `${at}/operation`, "unknown delta operation");
  const before = normalizeNodeTuple({
    bytes: value.beforeBytes,
    digest: value.beforeDigest,
    executable: value.beforeExecutable,
    type: value.beforeType,
  }, `${at}/before`);
  const after = normalizeNodeTuple({
    bytes: value.afterBytes,
    digest: value.afterDigest,
    executable: value.afterExecutable,
    type: value.afterType,
  }, `${at}/after`);
  if (
    (operation === "create" && (before.type !== null || after.type === null))
    || (operation === "remove" && (before.type === null || after.type !== null))
    || (operation === "replace" && (before.type === null || after.type === null))
  ) {
    fail("wakeflow-legacy-scenario-delta", at, `node tuple does not match ${operation}`);
  }
  if (operation === "replace" && canonicalJson(before) === canonicalJson(after)) {
    fail("wakeflow-legacy-scenario-delta", at, "replace must change node identity");
  }
  return {
    afterBytes: after.bytes,
    afterDigest: after.digest,
    afterExecutable: after.executable,
    afterType: after.type,
    beforeBytes: before.bytes,
    beforeDigest: before.digest,
    beforeExecutable: before.executable,
    beforeType: before.type,
    operation,
    path: entryPath,
  };
}

function validatePrivateJson(value, at) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validatePrivateJson(entry, `${at}/${index}`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const absentProcessIdentity = ["childPid", "pid", "processId", "workerPid"].includes(key) && child === 0;
    if (
      PRIVATE_JSON_KEYS.has(key)
      && child !== null
      && child !== ""
      && !absentProcessIdentity
      && !String(child).startsWith("@wakeflow-scenario-")
    ) {
      fail("wakeflow-legacy-scenario-privacy", `${at}/${key}`, "private runtime identity must be replaced by a declared scenario token");
    }
    validatePrivateJson(child, `${at}/${key}`);
  }
}

function assertPortableBytes(bytes, ref) {
  let text;
  try {
    text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("round trip mismatch");
  } catch {
    fail("wakeflow-legacy-scenario-encoding", `$/output/${ref}`, "scenario output must be valid UTF-8");
  }
  if (PRIVATE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    fail("wakeflow-legacy-scenario-privacy", `$/output/${ref}`, "scenario output contains a private path or cache location");
  }
  if (ref.endsWith(".json")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail("wakeflow-legacy-scenario-json", `$/output/${ref}`, "scenario JSON output is invalid");
    }
    validatePrivateJson(parsed, `$/output/${ref}`);
  } else if (ref.endsWith(".jsonl")) {
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (lines.length === 0 || lines.some((line) => !line)) {
      fail("wakeflow-legacy-scenario-json", `$/output/${ref}`, "scenario JSONL output requires non-empty JSON lines");
    }
    lines.forEach((line, index) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail("wakeflow-legacy-scenario-json", `$/output/${ref}/${index}`, "scenario JSONL output is invalid");
      }
      validatePrivateJson(parsed, `$/output/${ref}/${index}`);
    });
  }
}

function normalizedManifestWithoutDigest(input) {
  const value = exactDataObject(input, MANIFEST_FIELDS, "$", "wakeflow-legacy-scenario-shape");
  if (value.schemaVersion !== WAKEFLOW_LEGACY_SCENARIO_SCHEMA_VERSION) {
    fail("wakeflow-legacy-scenario-version", "$/schemaVersion", `expected ${WAKEFLOW_LEGACY_SCENARIO_SCHEMA_VERSION}`);
  }
  if (value.artifactKind !== WAKEFLOW_LEGACY_SCENARIO_KIND) {
    fail("wakeflow-legacy-scenario-kind", "$/artifactKind", `expected ${WAKEFLOW_LEGACY_SCENARIO_KIND}`);
  }
  const scenarioId = safeId(value.scenarioId, "$/scenarioId", "wakeflow-legacy-scenario-shape");
  const category = nonEmptyString(value.category, "$/category", "wakeflow-legacy-scenario-shape");
  if (!CATEGORIES.has(category)) fail("wakeflow-legacy-scenario-shape", "$/category", "unknown scenario category");
  const host = nonEmptyString(value.host, "$/host", "wakeflow-legacy-scenario-shape");
  if (!HOSTS.has(host)) fail("wakeflow-legacy-scenario-shape", "$/host", "unknown host");
  const materializationMode = nonEmptyString(value.materializationMode, "$/materializationMode", "wakeflow-legacy-scenario-shape");
  if (!MATERIALIZATION_MODES.has(materializationMode)) {
    fail("wakeflow-legacy-scenario-shape", "$/materializationMode", "unknown materialization mode");
  }
  if ((materializationMode === "historical-seed") !== (category === "retired-material")) {
    fail("wakeflow-legacy-scenario-mode", "$/category", "historical seeds must use retired-material and real writers must use a live category");
  }

  const producerValue = exactDataObject(value.producer, PRODUCER_FIELDS, "$/producer", "wakeflow-legacy-scenario-shape");
  const sourceFiles = denseArray(producerValue.sourceFiles, "$/producer/sourceFiles", "wakeflow-legacy-scenario-shape")
    .map(normalizeSourceFile);
  if (sourceFiles.length === 0) fail("wakeflow-legacy-scenario-producer", "$/producer/sourceFiles", "producer requires at least one exact source file");
  const sortedSourceFiles = [...sourceFiles].sort(compareBy(["role", "ref"]));
  assertSortedUnique(sourceFiles, sortedSourceFiles, "$/producer/sourceFiles", "wakeflow-legacy-scenario-shape");
  const producer = {
    artifactDigest: digestOrNull(producerValue.artifactDigest, "$/producer/artifactDigest", "wakeflow-legacy-scenario-shape"),
    sourceCommit: sourceCommit(producerValue.sourceCommit, "$/producer/sourceCommit", "wakeflow-legacy-scenario-shape"),
    sourceFiles,
  };

  const commandSequence = denseArray(value.commandSequence, "$/commandSequence", "wakeflow-legacy-scenario-shape")
    .map(normalizeCommand);
  const sortedStepIds = [...commandSequence.map(({ stepId }) => stepId)].sort(compareText);
  if (new Set(sortedStepIds).size !== sortedStepIds.length) {
    fail("wakeflow-legacy-scenario-command", "$/commandSequence", "command step ids must be unique");
  }
  if (materializationMode === "real-writer") {
    if (producer.artifactDigest === null || commandSequence.length === 0) {
      fail("wakeflow-legacy-scenario-mode", "$/producer", "real-writer requires an exact artifact digest and non-empty writer command sequence");
    }
  } else if (producer.artifactDigest !== null || commandSequence.length !== 0) {
    fail("wakeflow-legacy-scenario-mode", "$/producer", "historical-seed cannot claim a loaded artifact or executable command sequence");
  }

  const deltaEntries = denseArray(value.deltaEntries, "$/deltaEntries", "wakeflow-legacy-scenario-delta")
    .map(normalizeDeltaEntry);
  if (deltaEntries.length === 0) {
    fail("wakeflow-legacy-scenario-delta", "$/deltaEntries", "scenario requires a non-empty exact filesystem delta");
  }
  const sortedDeltaEntries = [...deltaEntries].sort(compareBy(["path"]));
  assertSortedUnique(deltaEntries, sortedDeltaEntries, "$/deltaEntries", "wakeflow-legacy-scenario-delta");

  const normalizations = denseArray(value.normalizations, "$/normalizations", "wakeflow-legacy-scenario-shape")
    .map(normalizeNormalization);
  const sortedNormalizations = [...normalizations].sort(compareBy(["ref", "kind", "selector", "token"]));
  assertSortedUnique(normalizations, sortedNormalizations, "$/normalizations", "wakeflow-legacy-scenario-shape");
  if (materializationMode === "historical-seed" && normalizations.length !== 0) {
    fail("wakeflow-legacy-scenario-mode", "$/normalizations", "historical exact samples cannot be rewritten through normalization");
  }

  const beforeManifest = value.beforeManifest === null
    ? null
    : validateWakeflowArtifactTreeManifest(value.beforeManifest);
  const outputManifest = value.outputManifest === null
    ? null
    : validateWakeflowArtifactTreeManifest(value.outputManifest);
  if (
    (beforeManifest && (
      beforeManifest.artifactKind !== WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND
      || beforeManifest.schemaVersion !== WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION
    ))
    || (outputManifest && (
      outputManifest.artifactKind !== WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND
      || outputManifest.schemaVersion !== WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION
    ))
  ) {
    fail("wakeflow-legacy-scenario-output", "$/beforeManifest", "scenario before/output require exact regular-file tree manifests");
  }
  const expectedBeforeFiles = deltaEntries
    .filter(({ beforeType }) => beforeType === "file")
    .map((entry) => ({
      bytes: entry.beforeBytes,
      digest: entry.beforeDigest,
      executable: entry.beforeExecutable,
      ref: entry.path,
    }));
  const outputRefs = new Set((outputManifest?.files ?? []).map(({ ref }) => ref));
  const expectedOutputFiles = deltaEntries
    .filter(({ afterType }) => afterType === "file")
    .map((entry) => ({
      bytes: entry.afterBytes,
      digest: entry.afterDigest,
      executable: entry.afterExecutable,
      ref: entry.path,
    }));
  if (
    canonicalJson(beforeManifest?.files ?? []) !== canonicalJson(expectedBeforeFiles)
    || canonicalJson(outputManifest?.files ?? []) !== canonicalJson(expectedOutputFiles)
  ) {
    fail("wakeflow-legacy-scenario-output", "$/outputManifest", "before/output files must exactly match every delta file tuple");
  }
  const deltaFileRefs = new Set([
    ...(beforeManifest?.files ?? []).map(({ ref }) => ref),
    ...outputRefs,
  ]);
  for (const normalization of normalizations) {
    if (!deltaFileRefs.has(normalization.ref)) {
      fail("wakeflow-legacy-scenario-normalization", "$/normalizations", "normalization ref is absent from the before/output manifests", { ref: normalization.ref });
    }
  }

  const normalized = {
    artifactKind: WAKEFLOW_LEGACY_SCENARIO_KIND,
    beforeManifest,
    category,
    commandSequence,
    deltaEntries,
    host,
    materializationMode,
    normalizations,
    outputManifest,
    producer,
    scenarioId,
    schemaVersion: WAKEFLOW_LEGACY_SCENARIO_SCHEMA_VERSION,
  };
  return { normalized, scenarioDigest: value.scenarioDigest };
}

export function createWakeflowLegacyScenarioManifest(input) {
  if (!isPlainObject(input) || Object.hasOwn(input, "scenarioDigest")) {
    fail("wakeflow-legacy-scenario-create", "$", "create input must omit scenarioDigest");
  }
  const provisional = {
    ...input,
    scenarioDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  const { normalized } = normalizedManifestWithoutDigest(provisional);
  return validateWakeflowLegacyScenarioManifest({
    ...normalized,
    scenarioDigest: canonicalJsonDigest(normalized),
  });
}

export function validateWakeflowLegacyScenarioManifest(input) {
  const { normalized, scenarioDigest } = normalizedManifestWithoutDigest(input);
  const expectedDigest = canonicalJsonDigest(normalized);
  if (scenarioDigest !== expectedDigest) {
    fail("wakeflow-legacy-scenario-digest", "$/scenarioDigest", "scenario digest does not match the closed manifest", {
      actual: scenarioDigest,
      expected: expectedDigest,
    });
  }
  const result = { ...normalized, scenarioDigest: expectedDigest };
  const serialized = canonicalJson(result);
  if (PRIVATE_TEXT_PATTERNS.some((pattern) => pattern.test(serialized))) {
    fail("wakeflow-legacy-scenario-privacy", "$", "scenario manifest contains a private path or cache location");
  }
  return deepFreeze(result);
}

export function validateWakeflowLegacyScenarioAgainstOrigin({ origin, scenario } = {}) {
  if (!isPlainObject(origin) || !isPlainObject(origin.source)) {
    fail("wakeflow-legacy-scenario-origin", "$/origin", "expected a validated origin-like object");
  }
  const manifest = validateWakeflowLegacyScenarioManifest(scenario);
  if (manifest.host !== origin.source.host) {
    fail("wakeflow-legacy-scenario-origin", "$/host", "scenario host does not match its origin", {
      originHost: origin.source.host,
      scenarioHost: manifest.host,
    });
  }
  if (manifest.materializationMode === "real-writer") {
    if (
      manifest.producer.artifactDigest !== origin.source.artifactDigest
      || manifest.producer.sourceCommit !== origin.source.commit
    ) {
      fail("wakeflow-legacy-scenario-origin", "$/producer", "real writer is not bound to the exact origin artifact and commit");
    }
    const originFiles = new Map(origin.source.artifactManifest.files.map((entry) => [entry.ref, entry]));
    for (const sourceFile of manifest.producer.sourceFiles) {
      const exact = originFiles.get(sourceFile.ref);
      if (!exact || canonicalJson(exact) !== canonicalJson({
        bytes: sourceFile.bytes,
        digest: sourceFile.digest,
        executable: sourceFile.executable,
        ref: sourceFile.ref,
      })) {
        fail("wakeflow-legacy-scenario-origin", "$/producer/sourceFiles", "writer source tuple does not match the complete origin artifact", {
          ref: sourceFile.ref,
        });
      }
    }
  }
  return manifest;
}

function absoluteDirectory(value, at) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value) || path.resolve(value) !== value || value.includes("\0")) {
    fail("wakeflow-legacy-scenario-root", at, "expected a normalized absolute directory path");
  }
  let stat;
  try {
    stat = lstatSync(value);
  } catch (error) {
    fail("wakeflow-legacy-scenario-root", at, "scenario directory is unavailable", { causeCode: error?.code ?? "unknown" });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-legacy-scenario-root", at, "scenario root must be a real directory");
  }
  return value;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function inspectWakeflowLegacyScenarioFixtureDirectory({ origin, scenarioRoot } = {}) {
  const root = absoluteDirectory(scenarioRoot, "$/scenarioRoot");
  const inventory = inspectWakeflowArtifactTree({ artifactRoot: root });
  const manifestEntry = inventory.manifest.files.find((entry) => entry.ref === "scenario.json");
  if (!manifestEntry || manifestEntry.executable) {
    fail("wakeflow-legacy-scenario-directory", "$/scenario.json", "scenario root requires one non-executable scenario.json");
  }
  let parsed;
  const manifestFile = path.join(root, "scenario.json");
  let loadedManifestBytes;
  try {
    loadedManifestBytes = readExactScenarioFile(manifestFile, manifestEntry, "scenario.json");
    parsed = JSON.parse(loadedManifestBytes.toString("utf8"));
  } catch {
    fail("wakeflow-legacy-scenario-directory", "$/scenario.json", "scenario manifest is invalid JSON");
  }
  const manifest = origin
    ? validateWakeflowLegacyScenarioAgainstOrigin({ origin, scenario: parsed })
    : validateWakeflowLegacyScenarioManifest(parsed);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const expected = [{
    bytes: manifestBytes.length,
    digest: sha256Bytes(manifestBytes),
    executable: false,
    ref: "scenario.json",
  }, ...(manifest.beforeManifest?.files ?? []).map((entry) => ({
    ...entry,
    ref: `before/${entry.ref}`,
  })), ...(manifest.outputManifest?.files ?? []).map((entry) => ({
    ...entry,
    ref: `output/${entry.ref}`,
  }))].sort(compareBy(["ref"]));
  if (canonicalJson(inventory.manifest.files) !== canonicalJson(expected)) {
    fail("wakeflow-legacy-scenario-directory", "$", "scenario directory does not match its exact output manifest");
  }
  if (!loadedManifestBytes.equals(manifestBytes)) {
    fail("wakeflow-legacy-scenario-directory", "$/scenario.json", "scenario manifest must use the reviewable canonical pretty form");
  }
  for (const [layer, layerManifest] of [
    ["before", manifest.beforeManifest],
    ["output", manifest.outputManifest],
  ]) {
    for (const entry of layerManifest?.files ?? []) {
      const ref = `${layer}/${entry.ref}`;
      const inventoryEntry = inventory.manifest.files.find((candidate) => candidate.ref === ref);
      if (!inventoryEntry) {
        fail("wakeflow-legacy-scenario-directory", `$/files/${ref}`, "scenario file is missing from inventory");
      }
      assertPortableBytes(
        readExactScenarioFile(path.join(root, layer, ...entry.ref.split("/")), inventoryEntry, ref),
        entry.ref,
      );
    }
  }
  return deepFreeze({
    directoryManifest: inventory.manifest,
    expectedFiles: expected,
    manifest,
  });
}
