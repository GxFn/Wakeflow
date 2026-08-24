import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
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
import os from "node:os";
import path from "node:path";

import {
  WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND,
  WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION,
  validateWakeflowArtifactTreeManifest,
} from "../../core/scripts/lib/wakeflow-artifact-tree-identity.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createWakeflowLegacyScenarioManifest,
  inspectWakeflowLegacyScenarioFixtureDirectory,
  validateWakeflowLegacyScenarioAgainstOrigin,
} from "../../tools/lib/wakeflow-legacy-scenario-fixtures.mjs";
import {
  inspectWakeflowLegacyOriginFixtureDirectory,
  validateWakeflowLegacyOriginFixture,
} from "../../tools/lib/wakeflow-legacy-origin-fixtures.mjs";

const DEFINITIONS = [
  definition("identity-registered", "identity", "real-writer", ["claude-code", "codex"], "none", [
    "register-thread",
  ]),
  definition("transport-result-reviewed", "transport-result-review", "real-writer", ["claude-code", "codex"], "none", [
    "state-init",
    "state-add-task-package",
    "register-thread",
    "prepare-dispatch-from-state",
    "record-delivery-run",
    "record-target-result",
    "build-controller-return",
    "record-controller-return-run",
    "import-target-result",
    "reduce-results",
    "decide-review",
  ]),
  definition("keep-live-terminal", "keep-live", "real-writer", ["claude-code", "codex"], "none", [
    "keep-live-state-stopped",
  ]),
  definition("keep-live-live", "keep-live", "real-writer", ["claude-code", "codex"], "process", [
    "start-keep-live",
    "stop-keep-live",
  ]),
  definition("preservation-valid", "preservation", "real-writer", ["claude-code", "codex"], "none", [
    "storage-preserve",
  ]),
  definition("pod-open", "pod", "real-writer", ["claude-code", "codex"], "git", [
    "state-init-pod",
    "pod-open-controls",
    "pod-record-controller-creating",
    "pod-record-controller-finalized",
    "pod-register-controller",
    "pod-bind-controller",
    "pod-record-design-creating",
    "pod-record-design-finalized",
    "pod-register-design",
    "pod-bind-design",
    "pod-record-test-creating",
    "pod-record-test-finalized",
    "pod-register-test",
    "pod-bind-test",
    "pod-prepare-design-request",
    "pod-record-design-handoff",
    "pod-open-product",
    "pod-record-product-creating",
    "pod-record-product-finalized",
    "pod-register-product",
    "pod-bind-product",
  ]),
  definition("pod-closed", "pod", "real-writer", ["claude-code", "codex"], "git", [
    "state-init-pod",
    "pod-open-controls",
    "pod-record-controller-creating",
    "pod-record-controller-finalized",
    "pod-register-controller",
    "pod-bind-controller",
    "pod-record-design-creating",
    "pod-record-design-finalized",
    "pod-register-design",
    "pod-bind-design",
    "pod-record-test-creating",
    "pod-record-test-finalized",
    "pod-register-test",
    "pod-bind-test",
    "pod-prepare-design-request",
    "pod-record-design-handoff",
    "pod-open-product",
    "pod-record-product-creating",
    "pod-record-product-finalized",
    "pod-register-product",
    "pod-bind-product",
    "state-cancel-demand",
    "pod-close",
    "pod-record-controller-close-receipt",
    "pod-record-design-close-receipt",
    "pod-record-test-close-receipt",
    "pod-record-product-close-receipt",
  ]),
  definition("claude-settings-seeded", "claude-settings", "real-writer", ["claude-code"], "none", [
    "seed-permissions",
  ]),
  definition("claude-window-operation", "claude-window-operation", "real-writer", ["claude-code"], "tmux", [
    "launch-window",
    "deliver",
    "readback",
  ]),
  definition("legacy-stream-open", "stream-worktree", "real-writer", ["claude-code"], "git", [
    "stream-open-no-launch",
  ]),
  definition("legacy-stream-closed", "stream-worktree", "real-writer", ["claude-code"], "git", [
    "stream-open-no-launch",
    "stream-close",
  ]),
  definition(
    "pod-reservation-historical",
    "retired-material",
    "historical-seed",
    ["claude-code", "codex"],
    "none",
    [],
    "bc6c6512c722d36469a9dcd0cff215d614b2109b",
  ),
  definition(
    "next-work-cache-historical",
    "retired-material",
    "historical-seed",
    ["claude-code", "codex"],
    "none",
    [],
    "19403f8454038ec2767e6a0e684a6d7cc1ec8fc7",
  ),
  definition(
    "stop-marker-historical",
    "retired-material",
    "historical-seed",
    ["claude-code", "codex"],
    "none",
    [],
    "19403f8454038ec2767e6a0e684a6d7cc1ec8fc7",
  ),
].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));

export const WAKEFLOW_LEGACY_SCENARIO_DEFINITIONS = deepFreeze(DEFINITIONS);

export class WakeflowLegacyScenarioBuilderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WakeflowLegacyScenarioBuilderError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function definition(
  scenarioId,
  category,
  materializationMode,
  supportedHosts,
  requiredCapability,
  writerSteps,
  sourceCommit = null,
) {
  return {
    category,
    executionPolicy: materializationMode === "real-writer"
      ? "historical-artifact-only"
      : "never-execute",
    materializationMode,
    requiredCapability,
    scenarioId,
    sourceCommit,
    supportedHosts: [...supportedHosts].sort(),
    writerSteps: [...writerSteps],
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, details = {}) {
  throw new WakeflowLegacyScenarioBuilderError(code, message, details);
}

function exactRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-legacy-scenario-definition-request", "scenario definition request must be an object");
  }
  const actual = Reflect.ownKeys(value).sort();
  const expected = ["host", "scenarioId"];
  if (
    actual.some((key) => typeof key !== "string")
    || JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    fail("wakeflow-legacy-scenario-definition-request", "scenario definition request fields do not match the closed contract", {
      actual,
      expected,
    });
  }
  for (const field of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-legacy-scenario-definition-request", `scenario definition ${field} must be an enumerable data property`);
    }
  }
  return value;
}

export function listWakeflowLegacyScenarioDefinitions() {
  return WAKEFLOW_LEGACY_SCENARIO_DEFINITIONS;
}

// 按host与scenarioId解析封闭场景登记，不接受调用方临时扩展支持范围。
export function resolveWakeflowLegacyScenarioDefinition(request) {
  const { host, scenarioId } = exactRequest(request);
  if (typeof host !== "string" || !["claude-code", "codex"].includes(host)) {
    fail("wakeflow-legacy-scenario-host", "scenario host must be claude-code or codex", { host });
  }
  if (typeof scenarioId !== "string" || !scenarioId || scenarioId !== scenarioId.trim()) {
    fail("wakeflow-legacy-scenario-id", "scenarioId must be a non-empty string without outer whitespace");
  }
  const definitionValue = WAKEFLOW_LEGACY_SCENARIO_DEFINITIONS.find((entry) => entry.scenarioId === scenarioId);
  if (!definitionValue) {
    fail("wakeflow-legacy-scenario-unknown", `unknown lifecycle scenario: ${scenarioId}`, { scenarioId });
  }
  if (!definitionValue.supportedHosts.includes(host)) {
    fail("wakeflow-legacy-scenario-host", `scenario ${scenarioId} is not available for host ${host}`, {
      host,
      supportedHosts: definitionValue.supportedHosts,
    });
  }
  return definitionValue;
}

// 统一执行闸门：historical-seed永不执行，real-writer也只保留历史provenance并拒绝当前执行。
export function assertWakeflowLegacyScenarioExecutionAllowed(request) {
  const definitionValue = resolveWakeflowLegacyScenarioDefinition(request);
  if (definitionValue.materializationMode !== "real-writer") {
    fail(
      "wakeflow-legacy-scenario-historical-seed",
      `scenario ${definitionValue.scenarioId} is historical-seed evidence and must never execute artifact code`,
      { sourceCommit: definitionValue.sourceCommit },
    );
  }
  fail(
    "wakeflow-legacy-scenario-writer-retired",
    `scenario ${definitionValue.scenarioId} preserves real-writer provenance, but current source maintenance must not execute the retired writer`,
    {
      executionPolicy: definitionValue.executionPolicy,
      scenarioId: definitionValue.scenarioId,
    },
  );
}

const BUILD_REQUEST_FIELDS = Object.freeze(["artifactRoot", "host", "originSource", "scenarioId"]);
const HISTORICAL_BUILD_REQUEST_FIELDS = Object.freeze([
  "historicalSourceRoot",
  "host",
  "sampleRoot",
  "scenarioId",
]);
const HISTORICAL_SOURCE_REFS = Object.freeze(new Map([
  ["next-work-cache-historical", Object.freeze(["scripts/wakeflow-next-work.mjs"])],
  ["pod-reservation-historical", Object.freeze(["scripts/lib/wakeflow-pod-reservations.mjs"])],
  ["stop-marker-historical", Object.freeze(["scripts/wakeflow-delivery.mjs"])],
]));
const MAX_HISTORICAL_FILE_BYTES = 8 * 1024 * 1024;
const MAX_HISTORICAL_TREE_BYTES = 64 * 1024 * 1024;
const MAX_HISTORICAL_TREE_DEPTH = 128;
const MAX_HISTORICAL_TREE_ENTRIES = 10_000;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-legacy-scenario-build-request", `${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.some((key) => typeof key !== "string")
    || canonicalJson(actual) !== canonicalJson(expected)
  ) {
    fail("wakeflow-legacy-scenario-build-request", `${label} fields do not match the closed contract`, {
      actual,
      expected,
    });
  }
  const normalized = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-legacy-scenario-build-request", `${label}.${field} must be an enumerable data property`);
    }
    normalized[field] = descriptor.value;
  }
  return normalized;
}

function absoluteReadOnlyDirectory(value, label) {
  if (
    typeof value !== "string"
    || !value
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || value.includes("\0")
  ) {
    fail("wakeflow-legacy-scenario-read-root", `${label} must be a normalized absolute directory path`);
  }
  let stat;
  try {
    stat = lstatSync(value);
  } catch (error) {
    fail("wakeflow-legacy-scenario-read-root", `${label} is unavailable`, {
      causeCode: error?.code ?? "unknown",
    });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-legacy-scenario-read-root", `${label} must be a real directory`);
  }
  return realpathSync(value);
}

function fileIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

// 对历史输入执行single-link、nofollow、size+1读取，并把路径身份绑定到descriptor前后状态。
function readHistoricalFile(file, ref, errorCode = "wakeflow-legacy-scenario-tree") {
  let beforePath;
  try {
    beforePath = lstatSync(file, { bigint: true });
  } catch (error) {
    fail(errorCode, `historical file is unavailable: ${ref}`, { causeCode: error?.code ?? "unknown" });
  }
  if (
    beforePath.isSymbolicLink()
    || !beforePath.isFile()
    || beforePath.nlink !== 1n
    || beforePath.size > BigInt(MAX_HISTORICAL_FILE_BYTES)
  ) fail(errorCode, `historical file is not one bounded single-link regular file: ${ref}`);

  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (fileIdentity(beforePath) !== fileIdentity(before)) {
      fail(errorCode, `historical file changed before it was opened: ${ref}`);
    }
    const expected = Number(before.size);
    const buffer = Buffer.allocUnsafe(expected + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      offset !== expected
      || fileIdentity(before) !== fileIdentity(after)
      || fileIdentity(after) !== fileIdentity(afterPath)
      || realpathSync(file) !== file
    ) fail(errorCode, `historical file changed while it was read: ${ref}`);
    return {
      bytes: Buffer.from(buffer.subarray(0, expected)),
      executable: (after.mode & 0o111n) !== 0n,
    };
  } catch (error) {
    if (error instanceof WakeflowLegacyScenarioBuilderError) throw error;
    fail(errorCode, `historical file cannot be safely read: ${ref}`, { causeCode: error?.code ?? "unknown" });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function boundedDirectoryNames(directory) {
  const names = [];
  let handle;
  try {
    handle = opendirSync(directory);
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > MAX_HISTORICAL_TREE_ENTRIES) {
        fail("wakeflow-legacy-scenario-tree", "historical sample directory exceeds the entry limit");
      }
    }
  } finally {
    handle?.closeSync();
  }
  return names.sort(compareText);
}

// 扫描只读历史样本树；拒绝链接/特殊节点并限制深度、数量和总字节，再返回精确manifest元组。
function scanTree(root) {
  const entries = new Map();
  let totalBytes = 0;
  function visit(directory, prefix = "", depth = 0) {
    if (depth > MAX_HISTORICAL_TREE_DEPTH) {
      fail("wakeflow-legacy-scenario-tree", "historical sample tree exceeds the depth limit");
    }
    const names = boundedDirectoryNames(directory);
    for (const name of names) {
      const absolute = path.join(directory, name);
      const ref = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute, { bigint: true });
      if (stat.isSymbolicLink()) fail("wakeflow-legacy-scenario-tree", `scenario tree contains a symbolic link: ${ref}`);
      if (entries.size >= MAX_HISTORICAL_TREE_ENTRIES) {
        fail("wakeflow-legacy-scenario-tree", "historical sample tree exceeds the entry limit");
      }
      if (stat.isDirectory()) {
        if (realpathSync(absolute) !== absolute) {
          fail("wakeflow-legacy-scenario-tree", `scenario directory is not physically rooted: ${ref}`);
        }
        entries.set(ref, { path: ref, type: "directory" });
        visit(absolute, ref, depth + 1);
      } else if (stat.isFile()) {
        const { bytes, executable } = readHistoricalFile(absolute, ref);
        totalBytes += bytes.length;
        if (totalBytes > MAX_HISTORICAL_TREE_BYTES) {
          fail("wakeflow-legacy-scenario-tree", "historical sample tree exceeds the total byte limit");
        }
        entries.set(ref, {
          bytes,
          digest: sha256(bytes),
          executable,
          path: ref,
          type: "file",
        });
      } else {
        fail("wakeflow-legacy-scenario-tree", `scenario tree contains a special filesystem node: ${ref}`);
      }
    }
  }
  visit(root);
  return entries;
}

function fileManifest(entries) {
  const files = [...entries.values()]
    .filter(({ type }) => type === "file")
    .map((entry) => ({
      bytes: entry.bytes.length,
      digest: entry.digest,
      executable: entry.executable,
      ref: entry.path,
    }))
    .sort((left, right) => compareText(left.ref, right.ref));
  if (files.length === 0) return null;
  return validateWakeflowArtifactTreeManifest({
    artifactKind: WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND,
    fileCount: files.length,
    files,
    schemaVersion: WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION,
    totalBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
  });
}

function createdTreeDelta(entries) {
  const deltaEntries = [...entries.values()].map((entry) => ({
    afterBytes: entry.type === "file" ? entry.bytes.length : null,
    afterDigest: entry.type === "file" ? entry.digest : null,
    afterExecutable: entry.type === "file" ? entry.executable : null,
    afterType: entry.type,
    beforeBytes: null,
    beforeDigest: null,
    beforeExecutable: null,
    beforeType: null,
    operation: "create",
    path: entry.path,
  })).sort((left, right) => compareText(left.path, right.path));
  if (deltaEntries.length === 0) {
    fail("wakeflow-legacy-scenario-empty", "historical seed sample contains no filesystem entries");
  }
  return deltaEntries;
}

function historicalSourceFiles({ definitionValue, historicalSourceRoot }) {
  const expectedRefs = HISTORICAL_SOURCE_REFS.get(definitionValue.scenarioId);
  if (!expectedRefs) {
    fail(
      "wakeflow-legacy-scenario-historical-source",
      `historical scenario has no closed original-writer source map: ${definitionValue.scenarioId}`,
    );
  }
  return expectedRefs.map((ref) => {
    const absolute = path.join(historicalSourceRoot, ...ref.split("/"));
    const { bytes, executable } = readHistoricalFile(
      absolute,
      ref,
      "wakeflow-legacy-scenario-historical-source",
    );
    return {
      bytes: bytes.length,
      digest: sha256(bytes),
      executable,
      ref,
      role: "original-writer",
    };
  }).sort((left, right) => compareText(left.role, right.role) || compareText(left.ref, right.ref));
}

function assertCandidateDirectoryContract(files) {
  const stageRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-historical-seed-check-"));
  try {
    for (const file of files) {
      const target = path.join(stageRoot, ...file.ref.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(file.contentBase64, "base64"), {
        mode: file.executable ? 0o755 : 0o644,
      });
    }
    inspectWakeflowLegacyScenarioFixtureDirectory({ scenarioRoot: stageRoot });
  } finally {
    rmSync(stageRoot, { force: true, recursive: true });
  }
}

// 从显式历史源码与样本根构造候选；只读取和签名字节，不加载或执行原writer。
export function buildWakeflowHistoricalSeedScenarioCandidate(request) {
  const value = exactObject(request, HISTORICAL_BUILD_REQUEST_FIELDS, "historical seed build request");
  const definitionValue = resolveWakeflowLegacyScenarioDefinition({
    host: value.host,
    scenarioId: value.scenarioId,
  });
  if (definitionValue.materializationMode !== "historical-seed") {
    fail(
      "wakeflow-legacy-scenario-not-historical-seed",
      `scenario ${definitionValue.scenarioId} must be materialized by its current real writer`,
    );
  }
  const historicalSourceRoot = absoluteReadOnlyDirectory(value.historicalSourceRoot, "historicalSourceRoot");
  const sampleRoot = absoluteReadOnlyDirectory(value.sampleRoot, "sampleRoot");
  const after = scanTree(sampleRoot);
  const outputManifest = fileManifest(after);
  if (!outputManifest) {
    fail("wakeflow-legacy-scenario-empty", "historical seed sample requires at least one regular output file");
  }
  const manifest = createWakeflowLegacyScenarioManifest({
    artifactKind: "wakeflow-legacy-lifecycle-scenario",
    beforeManifest: null,
    category: definitionValue.category,
    commandSequence: [],
    deltaEntries: createdTreeDelta(after),
    host: value.host,
    materializationMode: "historical-seed",
    normalizations: [],
    outputManifest,
    producer: {
      artifactDigest: null,
      sourceCommit: definitionValue.sourceCommit,
      sourceFiles: historicalSourceFiles({ definitionValue, historicalSourceRoot }),
    },
    scenarioId: definitionValue.scenarioId,
    schemaVersion: 1,
  });
  const files = candidateFiles({ after, before: new Map(), manifest });
  assertCandidateDirectoryContract(files);
  const fixtureDigest = canonicalJsonDigest(files.map(({ bytes, digest, executable, ref }) => ({
    bytes,
    digest,
    executable,
    ref,
  })));
  return deepFreeze({
    definition: definitionValue,
    files,
    fixtureDigest,
    manifest,
  });
}

function candidateFiles({ after, before, manifest }) {
  const files = [{
    bytes: Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    contentBase64: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8").toString("base64"),
    digest: sha256(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")),
    executable: false,
    ref: "scenario.json",
  }];
  for (const [layer, entries] of [["before", before], ["output", after]]) {
    for (const entry of [...entries.values()].filter(({ type }) => type === "file").sort((left, right) => compareText(left.path, right.path))) {
      files.push({
        bytes: entry.bytes.length,
        contentBase64: entry.bytes.toString("base64"),
        digest: entry.digest,
        executable: entry.executable,
        ref: `${layer}/${entry.path}`,
      });
    }
  }
  return files.sort((left, right) => compareText(left.ref, right.ref));
}

// 兼容旧调用名的拒绝入口；保留它只为返回稳定退役错误，不再包含任何writer实现。
export function buildWakeflowLegacyScenarioCandidate(request) {
  const value = exactObject(request, BUILD_REQUEST_FIELDS, "build request");
  // real-writer provenance只保存在checked-in fixture中；当前维护面无条件拒绝执行退役writer。
  return assertWakeflowLegacyScenarioExecutionAllowed({
    host: value.host,
    scenarioId: value.scenarioId,
  });
}

function validateScenarioCandidate(candidate, origin) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("wakeflow-legacy-scenario-candidate", "scenario candidate must be an object");
  }
  const keys = Reflect.ownKeys(candidate).sort();
  const expectedKeys = ["definition", "files", "fixtureDigest", "manifest"];
  if (keys.some((key) => typeof key !== "string") || canonicalJson(keys) !== canonicalJson(expectedKeys)) {
    fail("wakeflow-legacy-scenario-candidate", "scenario candidate fields do not match the closed builder output");
  }
  const manifest = validateWakeflowLegacyScenarioAgainstOrigin({ origin, scenario: candidate.manifest });
  const expectedDefinition = resolveWakeflowLegacyScenarioDefinition({
    host: manifest.host,
    scenarioId: manifest.scenarioId,
  });
  if (canonicalJson(candidate.definition) !== canonicalJson(expectedDefinition)) {
    fail("wakeflow-legacy-scenario-candidate", "candidate definition does not match the closed scenario registry");
  }
  if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
    fail("wakeflow-legacy-scenario-candidate", "scenario candidate requires files");
  }
  const files = candidate.files.map((file, index) => {
    const value = exactObject(file, ["bytes", "contentBase64", "digest", "executable", "ref"], `candidate.files[${index}]`);
    if (
      typeof value.ref !== "string"
      || !value.ref
      || path.posix.isAbsolute(value.ref)
      || path.win32.isAbsolute(value.ref)
      || path.posix.normalize(value.ref) !== value.ref
      || value.ref.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      fail("wakeflow-legacy-scenario-candidate", `candidate file ref is not portable: ${value.ref}`);
    }
    if (typeof value.contentBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.contentBase64)) {
      fail("wakeflow-legacy-scenario-candidate", `candidate file is not canonical base64: ${value.ref}`);
    }
    const bytes = Buffer.from(value.contentBase64, "base64");
    if (
      value.bytes !== bytes.length
      || value.digest !== sha256(bytes)
      || typeof value.executable !== "boolean"
    ) {
      fail("wakeflow-legacy-scenario-candidate", `candidate file tuple does not match exact bytes: ${value.ref}`);
    }
    return { ...value, bytes: value.bytes };
  });
  const sorted = [...files].sort((left, right) => compareText(left.ref, right.ref));
  if (canonicalJson(files) !== canonicalJson(sorted) || new Set(files.map(({ ref }) => ref)).size !== files.length) {
    fail("wakeflow-legacy-scenario-candidate", "candidate files must be unique and sorted by ref");
  }
  const scenarioFile = files.find(({ ref }) => ref === "scenario.json");
  const expectedScenarioBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (!scenarioFile || !Buffer.from(scenarioFile.contentBase64, "base64").equals(expectedScenarioBytes)) {
    fail("wakeflow-legacy-scenario-candidate", "candidate scenario.json does not match the validated manifest");
  }
  const fixtureDigest = canonicalJsonDigest(files.map(({ bytes, digest, executable, ref }) => ({
    bytes,
    digest,
    executable,
    ref,
  })));
  if (candidate.fixtureDigest !== fixtureDigest) {
    fail("wakeflow-legacy-scenario-candidate", "candidate fixture digest does not match exact files");
  }
  return { files, fixtureDigest, manifest };
}

function absoluteFixtureRoot(value) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value) || path.resolve(value) !== value || value.includes("\0")) {
    fail("wakeflow-legacy-scenario-fixture-root", "fixtureRoot must be a normalized absolute directory");
  }
  let stat;
  try {
    stat = lstatSync(value);
  } catch (error) {
    fail("wakeflow-legacy-scenario-fixture-root", "fixtureRoot is unavailable", { causeCode: error?.code ?? "unknown" });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-legacy-scenario-fixture-root", "fixtureRoot must be a real directory");
  }
  return realpathSync(value);
}

// 将已验证候选create-once附加到origin fixture，并原子更新origin.json的场景索引。
export function writeWakeflowLegacyScenarioCandidate({ candidate, fixtureRoot } = {}) {
  const root = absoluteFixtureRoot(fixtureRoot);
  // 写入前先完整核验现有fixture闭包，避免在污染、链接重定向或额外文件上继续附加场景。
  const origin = inspectWakeflowLegacyOriginFixtureDirectory({ fixtureRoot: root }).origin;
  const normalizedCandidate = validateScenarioCandidate(candidate, origin);
  const scenarioId = normalizedCandidate.manifest.scenarioId;
  const scenarioRef = `${scenarioId}/scenario.json`;
  const scenariosRoot = path.join(root, "scenarios");
  const targetRoot = path.join(scenariosRoot, scenarioId);
  mkdirSync(scenariosRoot, { recursive: true });

  let wroteScenario = false;
  if (existsSync(targetRoot)) {
    const inspected = inspectWakeflowLegacyScenarioFixtureDirectory({ origin, scenarioRoot: targetRoot });
    const actualFiles = inspected.directoryManifest.files;
    const expectedFiles = normalizedCandidate.files.map(({ bytes, digest, executable, ref }) => ({
      bytes,
      digest,
      executable,
      ref,
    }));
    if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
      fail("wakeflow-legacy-scenario-conflict", `scenario fixture already exists with different bytes: ${scenarioId}`);
    }
  } else {
    const stageRoot = path.join(scenariosRoot, `.${scenarioId}.stage-${process.pid}-${Date.now()}`);
    try {
      mkdirSync(stageRoot);
      for (const file of normalizedCandidate.files) {
        const target = path.join(stageRoot, ...file.ref.split("/"));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(file.contentBase64, "base64"), {
          mode: file.executable ? 0o755 : 0o644,
        });
      }
      inspectWakeflowLegacyScenarioFixtureDirectory({ origin, scenarioRoot: stageRoot });
      renameSync(stageRoot, targetRoot);
      wroteScenario = true;
    } finally {
      if (existsSync(stageRoot)) rmSync(stageRoot, { recursive: true, force: true });
    }
  }

  const nextScenarios = [...new Set([...origin.scenarios, scenarioRef])].sort(compareText);
  const nextOrigin = validateWakeflowLegacyOriginFixture({ ...origin, scenarios: nextScenarios });
  const { bytes: currentOriginBytes } = readHistoricalFile(
    path.join(root, "origin.json"),
    "origin.json",
    "wakeflow-legacy-scenario-origin",
  );
  const nextOriginBytes = Buffer.from(`${JSON.stringify(nextOrigin, null, 2)}\n`, "utf8");
  let wroteOrigin = false;
  if (!currentOriginBytes.equals(nextOriginBytes)) {
    const stagedOrigin = path.join(root, `.origin.json.stage-${process.pid}-${Date.now()}`);
    try {
      writeFileSync(stagedOrigin, nextOriginBytes, { flag: "wx", mode: 0o644 });
      chmodSync(stagedOrigin, 0o644);
      renameSync(stagedOrigin, path.join(root, "origin.json"));
      wroteOrigin = true;
    } finally {
      if (existsSync(stagedOrigin)) rmSync(stagedOrigin, { force: true });
    }
  }
  const inspectedOrigin = inspectWakeflowLegacyOriginFixtureDirectory({ fixtureRoot: root });
  return deepFreeze({
    fixtureDigest: inspectedOrigin.fixtureDigest,
    scenarioDigest: normalizedCandidate.manifest.scenarioDigest,
    scenarioId,
    scenarioRef,
    status: wroteScenario || wroteOrigin ? "written" : "replayed",
    wroteOrigin,
    wroteScenario,
  });
}
