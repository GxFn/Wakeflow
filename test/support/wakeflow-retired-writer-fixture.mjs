import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/legacy-retired-writer-outputs.json",
);
const MAX_FIXTURE_BYTES = 4 * 1024 * 1024;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail(message) {
  throw new Error(`invalid retired-writer fixture: ${message}`);
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

// 固定fixture也按single-link、nofollow和size+1读取，避免测试证据被路径替换或无界文件冒充。
function readFixtureBytes() {
  const beforePath = lstatSync(fixtureFile, { bigint: true });
  if (
    beforePath.isSymbolicLink()
    || !beforePath.isFile()
    || beforePath.nlink !== 1n
    || beforePath.size > BigInt(MAX_FIXTURE_BYTES)
  ) fail("fixture source is not one bounded single-link regular file");
  let descriptor;
  try {
    descriptor = openSync(fixtureFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (statIdentity(beforePath) !== statIdentity(before)) fail("fixture source changed while opening");
    const expected = Number(before.size);
    const buffer = Buffer.allocUnsafe(expected + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(fixtureFile, { bigint: true });
    if (
      offset !== expected
      || statIdentity(before) !== statIdentity(after)
      || statIdentity(after) !== statIdentity(afterPath)
    ) fail("fixture source changed while reading");
    return Buffer.from(buffer.subarray(0, expected));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function safeRelativeRef(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value.startsWith("/")
    || value.includes("\\")
    || value.split("/").some((part) => !part || part === "." || part === "..")
  ) fail(`${label} is not one safe workspace-relative ref`);
  return value;
}

function loadFixture() {
  const bytes = readFixtureBytes();
  const value = JSON.parse(bytes);
  if (
    value?.artifactKind !== "wakeflow-retired-writer-output-fixture"
    || value.schemaVersion !== 1
    || value.fixtureScope !== "archive-unit-and-active-state-removal-only"
    || value.source?.sourceCommit !== "70d79d720d65837a068993006f356e8de91215d4"
    || value.source?.artifactDigest !== "sha256:e7e6cb6cd792147cfa94bf76d720d077c439809aed1805aefbafb0c2adc7b335"
    || value.source?.writer?.ref !== "scripts/wakeflow-state.mjs"
    || value.source?.writer?.digest !== "sha256:fc0e3116fabafd403494b266cd6f01765455cdfe6827ca6f97cb9343d936a4a4"
    || value.source?.writer?.bytes !== 250410
    || value.source?.executionPolicy !== "checked-in-bytes-only-current-writer-retired"
  ) fail("provenance header drifted");

  const seenCases = new Set();
  for (const [scenarioId, entry] of Object.entries(value.cases ?? {})) {
    if (seenCases.has(scenarioId)) fail(`duplicate scenario ${scenarioId}`);
    seenCases.add(scenarioId);
    const activeStateRef = safeRelativeRef(entry.activeStateRef, `${scenarioId}.activeStateRef`);
    const archiveRef = safeRelativeRef(entry.archiveRef, `${scenarioId}.archiveRef`);
    if (!archiveRef.startsWith("wakeflow-ledger/workspace/archive/")) {
      fail(`${scenarioId}.archiveRef leaves the historical archive root`);
    }
    if (!Array.isArray(entry.files) || entry.files.length === 0) {
      fail(`${scenarioId}.files must be non-empty`);
    }
    const seenRefs = new Set();
    for (const file of entry.files) {
      const ref = safeRelativeRef(file.ref, `${scenarioId}.files.ref`);
      if (!ref.startsWith(`${archiveRef}/`) || seenRefs.has(ref)) {
        fail(`${scenarioId} has an out-of-scope or duplicate file ref`);
      }
      seenRefs.add(ref);
      const fileBytes = Buffer.from(file.base64, "base64");
      if (fileBytes.length !== file.bytes || sha256(fileBytes) !== file.digest) {
        fail(`${scenarioId} file bytes do not match ${ref}`);
      }
      const text = fileBytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(fileBytes)) fail(`${ref} is not UTF-8`);
      if (/\/(?:Users|home|tmp|private)\//u.test(text)) fail(`${ref} contains a private absolute path`);
    }
    entry.activeStateRef = activeStateRef;
    entry.archiveRef = archiveRef;
  }
  if (canonicalKeys(value.cases).join("\n") !== ["pod-closed", "transport-result-reviewed"].join("\n")) {
    fail("scenario closure drifted");
  }
  return deepFreeze(value);
}

function canonicalKeys(value) {
  return Object.keys(value ?? {}).sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function realDirectory(value, label) {
  if (
    typeof value !== "string"
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || value.includes("\0")
  ) fail(`${label} must be one normalized absolute path`);
  let stat;
  try {
    stat = lstatSync(value);
  } catch (error) {
    fail(`${label} is unavailable (${error?.code ?? "unknown"})`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be one real directory`);
  return realpathSync(value);
}

// 这个 helper 会删除历史 active 状态，因此只接受显式声明的系统临时测试沙箱。
// disposableRoot 是删除权限边界；workspaceRoot 必须是它的真实子目录，不能退化为仓库或产品根目录。
function admittedDisposableWorkspace({ disposableRoot, workspaceRoot }) {
  const disposable = realDirectory(disposableRoot, "disposableRoot");
  const workspace = realDirectory(workspaceRoot, "workspaceRoot");
  const temporaryRoot = realpathSync(os.tmpdir());
  if (
    !isInside(temporaryRoot, disposable)
    || !path.basename(disposable).startsWith("wakeflow-")
    || !isInside(disposable, workspace)
  ) fail("workspaceRoot must be inside one explicit Wakeflow system-temporary test sandbox");
  return workspace;
}

let loaded;

export function inspectWakeflowRetiredWriterFixture() {
  loaded ??= loadFixture();
  return loaded;
}

export function materializeWakeflowRetiredArchiveOutput({ disposableRoot, workspaceRoot, scenarioId }) {
  const admittedWorkspaceRoot = admittedDisposableWorkspace({ disposableRoot, workspaceRoot });
  const fixture = inspectWakeflowRetiredWriterFixture();
  const entry = fixture.cases[scenarioId];
  if (!entry) fail(`unknown scenario ${scenarioId}`);
  const activeStateRoot = path.join(admittedWorkspaceRoot, ...entry.activeStateRef.split("/"));
  const archiveRoot = path.join(admittedWorkspaceRoot, ...entry.archiveRef.split("/"));
  if (!existsSync(activeStateRoot)) fail(`${scenarioId} active source is absent`);
  if (existsSync(archiveRoot)) fail(`${scenarioId} archive target already exists`);

  rmSync(activeStateRoot, { recursive: true, force: false });
  for (const file of entry.files) {
    const target = path.join(admittedWorkspaceRoot, ...file.ref.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(file.base64, "base64"), { mode: 0o644 });
    chmodSync(target, 0o644);
  }
  return deepFreeze({
    activeStateRef: entry.activeStateRef,
    archiveRef: entry.archiveRef,
    archiveRoot,
    sourceCommit: fixture.source.sourceCommit,
    sourceScenarioDigest: entry.sourceScenarioDigest,
    writerDigest: fixture.source.writer.digest,
  });
}
