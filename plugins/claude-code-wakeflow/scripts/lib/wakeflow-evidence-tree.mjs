/**
 * Demand受管证据的来源捕获与私有证据树物理effect。
 *
 * 能力导航：
 * - source capture：inspectConfiguredEvidenceSource关闭configured file/tree的类型、容量、内容与隐私扫描。
 * - tree inspection：inspectEvidenceStage、inspectEvidenceFinalWrite关闭stage/final目录及manifest/payload字节。
 * - recovery residue：assertNoEvidenceStageResidue与确定性member stage只处理可证明归属当前intent的残留。
 * - physical effect：materializeEvidenceStage、publishEvidenceStage执行journal调用方授权的stage与同父发布。
 *
 * 本文件不拥有Evidence manifest业务codec、Controller准入、state/event顺序或验收决定：record合同归
 * evidence-records，preview/apply/recover编排归evidence-importer，事务次序归demand-state-service。
 * 外部configured source只作owner-neutral稳定观察；内部stage/final/residue才要求current-owner私有节点。
 */
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  validateEvidenceSource,
  validateEvidenceWriteIntent,
} from "./wakeflow-evidence-records.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

export const WAKEFLOW_EVIDENCE_LIMITS = Object.freeze({
  maxFiles: 256,
  maxDirectories: 256,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxDepth: 16,
  maxPathBytes: 512,
});

export const WAKEFLOW_EVIDENCE_CONTENT_CLASSES = Object.freeze([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);
export const CONTENT_CLASSES = WAKEFLOW_EVIDENCE_CONTENT_CLASSES;
export const PRIVACY_SCAN_VERSION = 1;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu;
const TYPED_UUID_PREFIX_RE = /(?:archive|binding|confirmation|delivery-envelope|delivery-group|delivery-packet|delivery-run|demand|evidence|pod|pod-design-handoff|pod-design-request|program|repository|review-candidate|surface|task-package|target-result|target-task|test-card|window)_$/u;
const PRIVATE_PATH_PATTERNS = Object.freeze([
  /(?:^|[\s"'=(])\/(?!\/)[A-Za-z0-9._-]+(?:\/[^\s"'<>]+)*/u,
  /(?:^|[\s"'=(])[A-Za-z]:\\[^\s"']+/u,
  /(?:^|[\s"'=(])~\/[^\s"']+/u,
]);
const CREDENTIAL_PATTERNS = Object.freeze([
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u,
  /(?:^|[^A-Za-z0-9])(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})(?:$|[^A-Za-z0-9])/u,
  /(?:^|[^A-Za-z0-9_])(?:token|password|passwd|secret|api[_-]?key|access[_-]?key)\s*[:=]\s*[^\s,;]+/iu,
]);
const STAGE_MEMBERS_DIRECTORY = ".wakeflow-evidence-member-stages";
const STAGE_MEMBER_SUFFIX = ".stage";

// ==================== 一、错误、无行为输入与固定合同 ====================

export class WakeflowEvidenceTreeError extends Error {
  constructor(code, message, { details = {}, cause } = {}) {
    super(message);
    this.name = "WakeflowEvidenceTreeError";
    this.code = code;
    this.details = Object.freeze({
      ...details,
      ...(cause?.code ? { causeCode: cause.code } : {}),
    });
  }
}

function treeError(code, message, details = {}, cause = undefined) {
  return new WakeflowEvidenceTreeError(code, message, { details, cause });
}

function fail(code, message, details = {}, cause = undefined) {
  throw treeError(code, message, details, cause);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, required, optional, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-evidence-tree-input", `${label} must be one plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-evidence-tree-input", `${label} must be one plain data object`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("wakeflow-evidence-tree-input", `${label} contains unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("wakeflow-evidence-tree-input", `${label} is missing ${key}`);
  }
  return value;
}

// 公开tree/effect边界先复制canonical纯数据，拒绝accessor、隐藏字段、symbol和循环引用。
function canonicalTreeInput(value, required, optional, label) {
  let snapshot;
  try {
    snapshot = JSON.parse(canonicalJson(value));
  } catch (cause) {
    fail(
      "wakeflow-evidence-tree-input",
      `${label} must be canonical plain data without accessors, symbols, hidden fields, or cycles`,
      {},
      cause,
    );
  }
  return exactKeys(snapshot, required, optional, label);
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-evidence-tree-digest", `${label} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function byteDigest(bytes) {
  return `sha256:${sha256Bytes(bytes)}`;
}

function assertPortablePath(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || value.includes(":")
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || /^[A-Za-z]:/u.test(value)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || Buffer.byteLength(value, "utf8") > WAKEFLOW_EVIDENCE_LIMITS.maxPathBytes
  ) {
    fail("wakeflow-evidence-tree-path", `${label} must be one canonical relative path within the 512-byte limit`);
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
    || segments.length > WAKEFLOW_EVIDENCE_LIMITS.maxDepth
    || path.posix.normalize(value) !== value
  ) {
    fail("wakeflow-evidence-tree-path", `${label} has a dot segment or exceeds the depth limit`);
  }
  return value;
}

function resolveStateRoot(stateRoot) {
  if (typeof stateRoot !== "string" || !stateRoot.trim()) {
    fail("wakeflow-evidence-tree-root", "stateRoot must be one non-empty path");
  }
  return path.resolve(stateRoot);
}

function currentEffectiveUid() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") return null;
  return BigInt(process.geteuid());
}

function permissionBits(stat) {
  return Number(stat.mode & 0o777n);
}

function nodeOwnedByCurrentUser(stat) {
  const expectedUid = currentEffectiveUid();
  return expectedUid === null || stat.uid === expectedUid;
}

// 比较路径与descriptor的完整稳定节点身份；atime不参与，避免只读本身制造漂移。
function sameObservedStat(left, right) {
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

// ==================== 二、外部source与内部私有节点的物理准入 ====================

function assertPrivateDirectory(target, label, { allowMissing = false } = {}) {
  let stat;
  try {
    stat = lstatSync(target, { bigint: true });
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-evidence-tree-directory", `${label} is missing or unreadable`, {}, cause);
  }
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || (process.platform !== "win32" && permissionBits(stat) !== 0o700)
    || !nodeOwnedByCurrentUser(stat)
  ) {
    fail(
      "wakeflow-evidence-tree-directory",
      `${label} must be a current-owner real directory with mode 0700`,
    );
  }
  return stat;
}

// configured source可位于共享repository/support surface；这里只拒绝link/type，不施加私有owner/mode。
function assertSourceDirectory(target, label) {
  let before;
  try {
    before = lstatSync(target, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-source-directory", `${label} is unavailable`, {}, cause);
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    fail("wakeflow-evidence-source-symlink", `${label} must be a real source directory, not a symlink or special file`);
  }
  return before;
}

// 从已安全打开的descriptor读取固定上限；容量属于evidence v1合同，不在此推断业务内容。
function readBoundedFile(descriptor, maximumBytes, label) {
  const chunks = [];
  let total = 0;
  while (true) {
    const remaining = maximumBytes + 1 - total;
    if (remaining <= 0) {
      fail("wakeflow-evidence-source-limit", `${label} exceeds its bounded file limit`);
    }
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > maximumBytes) {
    fail("wakeflow-evidence-source-limit", `${label} exceeds its bounded file limit`);
  }
  return Buffer.concat(chunks, total);
}

// source file允许共享owner/mode，但必须是稳定、非执行、无link且不超过16 MiB的regular file。
function readSourceFile(target, label, expectedStat = null) {
  let before;
  try {
    before = lstatSync(target, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-source-file", `${label} is unavailable`, {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || (before.mode & 0o111n) !== 0n
  ) {
    fail(
      "wakeflow-evidence-source-file",
      `${label} must be one non-executable, single-link regular source file; symlinks, hardlinks, and special files are forbidden`,
    );
  }
  if (expectedStat !== null && !sameObservedStat(before, expectedStat)) {
    fail("wakeflow-evidence-source-race", `${label} changed after its parent directory was enumerated`);
  }
  if (before.size > BigInt(WAKEFLOW_EVIDENCE_LIMITS.maxFileBytes)) {
    fail("wakeflow-evidence-source-limit", `${label} exceeds the 16 MiB file limit`);
  }
  let descriptor;
  try {
    descriptor = openSync(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    fail("wakeflow-evidence-source-file", `${label} cannot be opened without following links`, {}, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || (opened.mode & 0o111n) !== 0n
      || !sameObservedStat(opened, before)
    ) {
      fail("wakeflow-evidence-source-race", `${label} changed while being opened`);
    }
    if (opened.size > BigInt(WAKEFLOW_EVIDENCE_LIMITS.maxFileBytes)) {
      fail("wakeflow-evidence-source-limit", `${label} exceeds the 16 MiB file limit`);
    }
    const bytes = readBoundedFile(descriptor, WAKEFLOW_EVIDENCE_LIMITS.maxFileBytes, label);
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(target, { bigint: true });
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n
      || (after.mode & 0o111n) !== 0n
      || !sameObservedStat(opened, afterDescriptor)
      || !sameObservedStat(afterDescriptor, after)
      || after.size !== BigInt(bytes.length)
    ) {
      fail("wakeflow-evidence-source-race", `${label} changed while being read`);
    }
    return Buffer.from(bytes);
  } finally {
    closeSync(descriptor);
  }
}

// stage/final成员必须是current-owner 0600单链接文件，并与期望bytes或inventory上限一致。
function safeOutputFile(target, expectedBytes, label, { maximumBytes = null } = {}) {
  let before;
  try {
    before = lstatSync(target, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-tree-file", `${label} is missing or unreadable`, {}, cause);
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || (process.platform !== "win32" && permissionBits(before) !== 0o600)
    || !nodeOwnedByCurrentUser(before)
  ) {
    fail(
      "wakeflow-evidence-tree-file",
      `${label} must be one current-owner single-link regular file with mode 0600`,
    );
  }
  let descriptor;
  try {
    descriptor = openSync(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    fail("wakeflow-evidence-tree-file", `${label} cannot be opened safely`, {}, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const readLimit = expectedBytes === null ? maximumBytes : expectedBytes.length;
    if (!Number.isInteger(readLimit) || readLimit < 0) {
      fail("wakeflow-evidence-tree-file", `${label} requires one exact bounded read limit`);
    }
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(opened) !== 0o600)
      || !nodeOwnedByCurrentUser(opened)
      || !sameObservedStat(opened, before)
      || opened.size > BigInt(readLimit)
    ) {
      fail("wakeflow-evidence-tree-race", `${label} changed while being opened`);
    }
    const bytes = readBoundedFile(descriptor, readLimit, label);
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(target, { bigint: true });
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(after) !== 0o600)
      || !nodeOwnedByCurrentUser(after)
      || !sameObservedStat(opened, afterDescriptor)
      || !sameObservedStat(afterDescriptor, after)
      || after.size !== BigInt(bytes.length)
      || (expectedBytes !== null && !bytes.equals(expectedBytes))
    ) {
      fail("wakeflow-evidence-tree-tamper", `${label} differs from the immutable evidence intent`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

// ==================== 三、content class与reject-only隐私扫描 ====================

// content class只做v1 allowlist的magic/UTF-8分类，不证明文档内容真实或安全。
function contentClass(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) return null;
    return "text/plain";
  } catch {
    return null;
  }
}

function privacyFindings(bytes, memberPath, detectedClass) {
  const findings = new Set();
  const scan = detectedClass === "text/plain"
    ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    : bytes.toString("latin1").replace(/[^\x20-\x7e\r\n\t]/gu, " ");
  const joined = `${memberPath}\n${scan}`;
  if (CREDENTIAL_PATTERNS[0].test(joined)) findings.add("private-key-header");
  if (CREDENTIAL_PATTERNS[1].test(joined)) findings.add("provider-credential-prefix");
  if (CREDENTIAL_PATTERNS[2].test(joined)) findings.add("credential-assignment");
  if (PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(joined))) findings.add("private-absolute-path");
  UUID_RE.lastIndex = 0;
  for (const match of joined.matchAll(UUID_RE)) {
    const prefix = joined.slice(Math.max(0, match.index - 40), match.index);
    if (!TYPED_UUID_PREFIX_RE.test(prefix)) findings.add("private-host-handle");
  }
  return findings;
}

function assertSourceMemberMetadata(memberPath) {
  const findings = privacyFindings(Buffer.alloc(0), memberPath, "text/plain");
  if (findings.size > 0) {
    fail(
      "wakeflow-evidence-privacy-finding",
      "evidence source metadata failed the bounded privacy scan",
      { findingCount: findings.size, findingCodes: [...findings].sort(lexicalCompare) },
    );
  }
}

function inspectSourceContent(bytes, memberPath, controllerReviewedOpaque) {
  const detectedClass = contentClass(bytes);
  if (detectedClass === null) {
    fail("wakeflow-evidence-content", "evidence source contains an unknown binary or NUL-bearing text file");
  }
  if (detectedClass !== "text/plain" && controllerReviewedOpaque !== true) {
    fail("wakeflow-evidence-content-review", "recognized binary evidence requires controllerReviewedOpaque=true");
  }
  const findings = privacyFindings(bytes, memberPath, detectedClass);
  if (findings.size > 0) {
    const codes = [...findings].sort(lexicalCompare);
    fail(
      "wakeflow-evidence-privacy-finding",
      "evidence source contains reject-only privacy or credential findings",
      { findingCount: codes.length, codes },
    );
  }
  return detectedClass;
}

// ==================== 四、configured source解析与有界捕获 ====================

function sourceRoot(root) {
  if (typeof root !== "string" || !root.trim()) {
    fail("wakeflow-evidence-source-root", "configured evidence source root is required");
  }
  const absolute = path.resolve(root);
  const before = assertSourceDirectory(absolute, "configured evidence source root");
  let real;
  let after;
  try {
    real = realpathSync(absolute);
    after = lstatSync(absolute, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-source-race", "configured evidence source root changed while resolving", {}, cause);
  }
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || !sameObservedStat(before, after)
  ) {
    fail("wakeflow-evidence-source-race", "configured evidence source root changed while resolving");
  }
  return Object.freeze({ absolute, real });
}

function resolveSourceLeaf(rootInfo, sourcePath) {
  const segments = assertPortablePath(sourcePath, "source.path").split("/");
  let current = rootInfo.absolute;
  let leafStat = null;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
    } catch (cause) {
      fail("wakeflow-evidence-source-path", "configured evidence source path is unavailable", {}, cause);
    }
    if (stat.isSymbolicLink()) {
      fail("wakeflow-evidence-source-symlink", "configured evidence source path cannot contain a symlink");
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      fail("wakeflow-evidence-source-type", "configured evidence source intermediate member must be a directory");
    }
    leafStat = stat;
  }
  let resolvedLeaf;
  let after;
  try {
    resolvedLeaf = realpathSync(current);
    after = lstatSync(current, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-source-race", "configured evidence source path changed while resolving", {}, cause);
  }
  if (after.isSymbolicLink() || !sameObservedStat(leafStat, after)) {
    fail("wakeflow-evidence-source-race", "configured evidence source path changed while resolving");
  }
  const relative = path.relative(rootInfo.real, resolvedLeaf);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-evidence-source-containment", "configured evidence source resolves outside its typed root");
  }
  return Object.freeze({ path: current, stat: after });
}

// 按code-unit次序递归捕获source tree；空目录也进入digest，所有file bytes总量受32 MiB限制。
function inspectTreeSource(root) {
  const directories = [];
  const files = [];
  const captures = new Map();
  let totalBytes = 0;
  const walk = (directory, relative, expectedStat = null) => {
    const before = assertSourceDirectory(directory, "evidence source tree directory");
    if (expectedStat !== null && !sameObservedStat(before, expectedStat)) {
      fail("wakeflow-evidence-source-race", "evidence source directory changed after its parent was enumerated");
    }
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => lexicalCompare(left.name, right.name));
    } catch (cause) {
      fail("wakeflow-evidence-source-directory", "evidence source tree cannot be enumerated", {}, cause);
    }
    for (const entry of entries) {
      const member = relative ? `${relative}/${entry.name}` : entry.name;
      assertPortablePath(member, "source tree member");
      assertSourceMemberMetadata(member);
      const target = path.join(directory, entry.name);
      let stat;
      try {
        stat = lstatSync(target, { bigint: true });
      } catch (cause) {
        fail("wakeflow-evidence-source-race", "evidence source member changed after directory enumeration", {}, cause);
      }
      if (stat.isSymbolicLink()) fail("wakeflow-evidence-source-symlink", "evidence source tree cannot contain symlinks");
      if (stat.isDirectory()) {
        directories.push(member);
        if (directories.length > WAKEFLOW_EVIDENCE_LIMITS.maxDirectories) {
          fail("wakeflow-evidence-source-limit", "evidence source exceeds the 256-directory limit");
        }
        walk(target, member, stat);
      } else if (stat.isFile()) {
        if (files.length >= WAKEFLOW_EVIDENCE_LIMITS.maxFiles) {
          fail("wakeflow-evidence-source-limit", "evidence source exceeds the 256-file limit");
        }
        const bytes = readSourceFile(target, "evidence source tree file", stat);
        totalBytes += bytes.length;
        if (totalBytes > WAKEFLOW_EVIDENCE_LIMITS.maxTotalBytes) {
          fail("wakeflow-evidence-source-limit", "evidence source exceeds the 32 MiB total payload limit");
        }
        files.push({ path: member, bytes: bytes.length, digest: byteDigest(bytes), contentClass: null });
        captures.set(member, bytes);
      } else {
        fail("wakeflow-evidence-source-special", "evidence source tree cannot contain a device, FIFO, socket, or special file");
      }
    }
    let afterEntries;
    let after;
    try {
      afterEntries = readdirSync(directory, { withFileTypes: true })
        .map((entry) => entry.name)
        .sort(lexicalCompare);
      after = lstatSync(directory, { bigint: true });
    } catch (cause) {
      fail("wakeflow-evidence-source-race", "evidence source tree changed after enumeration", {}, cause);
    }
    const beforeEntries = entries.map((entry) => entry.name);
    if (
      after.isSymbolicLink()
      || !after.isDirectory()
      || !sameObservedStat(after, before)
      || canonicalJson(afterEntries) !== canonicalJson(beforeEntries)
    ) {
      fail("wakeflow-evidence-source-race", "evidence source tree changed while being enumerated");
    }
  };
  walk(root, "");
  directories.sort(lexicalCompare);
  files.sort((left, right) => lexicalCompare(left.path, right.path));
  return { directories, files, captures, totalBytes };
}

function passedPrivacyScan() {
  return deepFreeze({ schemaVersion: PRIVACY_SCAN_VERSION, disposition: "passed", findingCounts: [] });
}

/**
 * 从一个已配置repository/support root捕获exact file/tree bytes与manifest inventory。
 * 返回值只证明本次有界读取通过v1类型、digest和reject-only扫描，不证明材料真实性或验收结果。
 */
export function inspectConfiguredEvidenceSource(input = {}) {
  input = canonicalTreeInput(
    input,
    ["root", "source", "sensitivity"],
    ["controllerReviewedOpaque"],
    "inspectConfiguredEvidenceSource input",
  );
  const {
    root,
    sensitivity,
    controllerReviewedOpaque = false,
  } = input;
  let { source } = input;
  if (!new Set(["public", "internal"]).has(sensitivity)) {
    fail("wakeflow-evidence-sensitivity", "evidence sensitivity must be public or internal");
  }
  if (typeof controllerReviewedOpaque !== "boolean") {
    fail("wakeflow-evidence-content-review", "controllerReviewedOpaque must be boolean");
  }
  try {
    source = validateEvidenceSource(source);
  } catch (cause) {
    fail(
      cause?.code ?? "wakeflow-evidence-source",
      "configured evidence source requires one strict portable source record",
      {},
      cause,
    );
  }
  if (source.kind !== "managed-path") fail("wakeflow-evidence-source", "configured source inspection requires managed-path");
  assertSourceMemberMetadata(source.path);
  if (!new Set(["file", "tree"]).has(source.expectedType)) {
    fail("wakeflow-evidence-source-type", "managed evidence expectedType must be file or tree");
  }
  assertDigest(source.expectedDigest, "source.expectedDigest");
  const rootInfo = sourceRoot(root);
  const resolvedLeaf = resolveSourceLeaf(rootInfo, source.path);
  const leaf = resolvedLeaf.path;
  const leafStat = resolvedLeaf.stat;
  if ((source.expectedType === "file") !== leafStat.isFile()) {
    fail("wakeflow-evidence-source-type", "managed evidence source type differs from expectedType");
  }

  let payload;
  let materialization;
  let containsOpaque = false;
  if (source.expectedType === "file") {
    const bytes = readSourceFile(leaf, "managed evidence source file", leafStat);
    const detectedClass = inspectSourceContent(bytes, source.path, controllerReviewedOpaque);
    containsOpaque = detectedClass !== "text/plain";
    const digest = byteDigest(bytes);
    if (digest !== source.expectedDigest) {
      fail("wakeflow-evidence-source-digest", "managed evidence source digest differs from expectedDigest");
    }
    const treeProjection = {
      directories: [],
      files: [{ path: "content", bytes: bytes.length, digest, contentClass: detectedClass }],
    };
    payload = {
      directories: ["payload"],
      files: [{ path: "payload/content", bytes: bytes.length, digest, contentClass: detectedClass }],
      totalBytes: bytes.length,
      treeDigest: canonicalJsonDigest(treeProjection),
    };
    materialization = { files: new Map([["payload/content", bytes]]) };
  } else {
    if (!leafStat.isDirectory()) fail("wakeflow-evidence-source-type", "managed evidence tree source must be a directory");
    const inspected = inspectTreeSource(leaf);
    for (const file of inspected.files) {
      const bytes = inspected.captures.get(file.path);
      file.contentClass = inspectSourceContent(bytes, file.path, controllerReviewedOpaque);
      if (file.contentClass !== "text/plain") containsOpaque = true;
    }
    const projection = { directories: inspected.directories, files: inspected.files };
    const digest = canonicalJsonDigest(projection);
    if (digest !== source.expectedDigest) {
      fail("wakeflow-evidence-source-digest", "managed evidence tree digest differs from expectedDigest");
    }
    payload = {
      directories: ["payload", ...inspected.directories.map((entry) => `payload/${entry}`)],
      files: inspected.files.map((entry) => ({ ...entry, path: `payload/${entry.path}` })),
      totalBytes: inspected.totalBytes,
      treeDigest: digest,
    };
    materialization = {
      files: new Map([...inspected.captures].map(([entry, bytes]) => [`payload/${entry}`, bytes])),
    };
  }
  return deepFreeze({
    source: JSON.parse(canonicalJson(source)),
    payload,
    privacyScan: passedPrivacyScan(),
    ...(containsOpaque ? { controllerReviewedOpaque: true } : {}),
    materialization,
    sourceSnapshot: {
      type: source.expectedType,
      digest: source.expectedDigest,
      fileCount: payload.files.length,
      directoryCount: payload.directories.length - 1,
      totalBytes: payload.totalBytes,
    },
  });
}

// ==================== 五、write intent、确定性路径与stage/final闭包 ====================

function normalizeWrite(write) {
  let validated;
  try {
    validated = validateEvidenceWriteIntent(write);
  } catch (cause) {
    fail(
      "wakeflow-evidence-tree-write",
      "evidence tree operations require one strict canonical evidence write intent",
      {},
      cause,
    );
  }
  return Object.freeze({ write: validated, evidenceId: validated.artifactId });
}

/**
 * 返回一份evidence intent唯一的同父私有stage路径；不检查或创建filesystem节点。
 */
export function evidenceStagePath(input = {}) {
  input = canonicalTreeInput(input, ["stateRoot", "evidenceId"], [], "evidenceStagePath input");
  const { stateRoot, evidenceId } = input;
  const id = assertWakeflowId(evidenceId, "evidence", "$evidenceId");
  return path.join(resolveStateRoot(stateRoot), "evidence", `.${id}.wakeflow-stage`);
}

/**
 * 返回一份evidence intent唯一的immutable final root路径；不检查或创建filesystem节点。
 */
export function evidenceRootPath(input = {}) {
  input = canonicalTreeInput(input, ["stateRoot", "evidenceId"], [], "evidenceRootPath input");
  const { stateRoot, evidenceId } = input;
  const id = assertWakeflowId(evidenceId, "evidence", "$evidenceId");
  return path.join(resolveStateRoot(stateRoot), "evidence", id);
}

function expectedTree(write) {
  const manifestBytes = Buffer.from(`${canonicalJson(write.value)}\n`, "utf8");
  const directories = new Set([""]);
  const files = new Map([["evidence.json", manifestBytes]]);
  if (write.value.payload) {
    for (const directory of write.value.payload.directories) directories.add(directory);
    for (const file of write.value.payload.files) files.set(file.path, null);
  }
  return { directories, files, manifestBytes };
}

function stageResidueName(target) {
  return `${sha256Bytes(Buffer.from(target, "utf8"))}${STAGE_MEMBER_SUFFIX}`;
}

// 对照immutable write intent枚举整棵stage/final；partial只允许确定性member residue，不接纳未知节点。
function inspectOutputTree({ root, write, allowPartial }) {
  const expected = expectedTree(write);
  const expectedResidueTargets = new Map(
    [...expected.files.keys()].map((target) => [stageResidueName(target), target]),
  );
  if (expectedResidueTargets.size !== expected.files.size) {
    fail("wakeflow-evidence-tree-stage-residue", "evidence member stage keys are not unique");
  }
  assertPrivateDirectory(root, "evidence artifact root");
  const actualDirectories = new Set([""]);
  const actualFiles = new Set();
  const stageResidues = [];
  let hasStageResidueDirectory = false;
  const walk = (directory, relative) => {
    const before = assertPrivateDirectory(directory, "evidence artifact directory");
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => lexicalCompare(left.name, right.name));
    } catch (cause) {
      fail("wakeflow-evidence-tree-race", "evidence artifact directory could not be enumerated safely", {}, cause);
    }
    for (const entry of entries) {
      const member = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      let stat;
      try {
        stat = lstatSync(target, { bigint: true });
      } catch (cause) {
        fail("wakeflow-evidence-tree-race", "evidence artifact member changed after enumeration", {}, cause);
      }
      if (stat.isSymbolicLink()) fail("wakeflow-evidence-tree-symlink", "evidence artifact cannot contain symlinks");
      if (relative === "" && entry.name === STAGE_MEMBERS_DIRECTORY) {
        if (!allowPartial || !stat.isDirectory()) {
          fail(
            "wakeflow-evidence-tree-stage-residue",
            "evidence member stage namespace is only valid inside an unpublished evidence stage",
          );
        }
        hasStageResidueDirectory = true;
        const residueDirectoryBefore = assertPrivateDirectory(target, "evidence member stage namespace");
        const residueEntries = readdirSync(target, { withFileTypes: true })
          .sort((left, right) => lexicalCompare(left.name, right.name));
        for (const residueEntry of residueEntries) {
          const residueTarget = expectedResidueTargets.get(residueEntry.name) ?? null;
          const residuePath = path.join(target, residueEntry.name);
          const residueStat = lstatSync(residuePath, { bigint: true });
          if (
            residueTarget === null
            || residueStat.isSymbolicLink()
            || !residueStat.isFile()
            || residueStat.nlink !== 1n
            || (process.platform !== "win32" && permissionBits(residueStat) !== 0o600)
            || !nodeOwnedByCurrentUser(residueStat)
          ) {
            fail(
              "wakeflow-evidence-tree-stage-residue",
              "evidence member stage namespace contains an unknown or unsafe residue",
            );
          }
          stageResidues.push(Object.freeze({
            path: `${STAGE_MEMBERS_DIRECTORY}/${residueEntry.name}`,
            target: residueTarget,
          }));
        }
        const residueDirectoryAfter = lstatSync(target, { bigint: true });
        if (!sameObservedStat(residueDirectoryBefore, residueDirectoryAfter)) {
          fail("wakeflow-evidence-tree-race", "evidence member stage namespace changed while being inspected");
        }
        continue;
      }
      if (stat.isDirectory()) {
        if (!expected.directories.has(member)) fail("wakeflow-evidence-tree-unknown", "evidence stage or root contains an unknown directory");
        actualDirectories.add(member);
        walk(target, member);
      } else if (stat.isFile()) {
        if (!expected.files.has(member)) fail("wakeflow-evidence-tree-unknown", "evidence stage or root contains an unknown file");
        actualFiles.add(member);
        if (member === "evidence.json") {
          safeOutputFile(target, expected.manifestBytes, "evidence manifest");
        } else {
          const descriptor = write.value.payload.files.find((file) => file.path === member);
          const bytes = safeOutputFile(target, null, "evidence payload file", {
            maximumBytes: descriptor.bytes,
          });
          if (bytes.length !== descriptor.bytes || byteDigest(bytes) !== descriptor.digest) {
            fail("wakeflow-evidence-tree-tamper", "evidence payload bytes differ from the manifest inventory");
          }
          if (contentClass(bytes) !== descriptor.contentClass) {
            fail("wakeflow-evidence-tree-content", "evidence payload content class differs from the manifest inventory");
          }
        }
      } else {
        fail("wakeflow-evidence-tree-special", "evidence stage or root cannot contain a special file");
      }
    }
    let afterEntries;
    let after;
    try {
      afterEntries = readdirSync(directory, { withFileTypes: true })
        .map((entry) => entry.name)
        .sort(lexicalCompare);
      after = lstatSync(directory, { bigint: true });
    } catch (cause) {
      fail("wakeflow-evidence-tree-race", "evidence artifact directory changed after enumeration", {}, cause);
    }
    if (
      after.isSymbolicLink()
      || !after.isDirectory()
      || !sameObservedStat(after, before)
      || canonicalJson(afterEntries) !== canonicalJson(entries.map((entry) => entry.name))
    ) {
      fail("wakeflow-evidence-tree-race", "evidence artifact directory changed while being inspected");
    }
  };
  walk(root, "");
  const residueTargets = stageResidues.map((entry) => entry.target);
  if (
    new Set(residueTargets).size !== residueTargets.length
    || residueTargets.some((entry) => actualFiles.has(entry))
  ) {
    fail(
      "wakeflow-evidence-tree-stage-residue",
      "evidence stage cannot contain ambiguous member stages or both staged and final member bytes",
    );
  }
  const missingDirectories = [...expected.directories].filter((entry) => !actualDirectories.has(entry));
  const missingFiles = [...expected.files.keys()].filter((entry) => !actualFiles.has(entry));
  const complete = missingDirectories.length === 0 && missingFiles.length === 0;
  if (!allowPartial && !complete) fail("wakeflow-evidence-tree-incomplete", "evidence artifact root is incomplete");
  if (actualFiles.has("evidence.json") && (!complete || stageResidues.length > 0)) {
    fail("wakeflow-evidence-tree-incomplete", "evidence manifest cannot appear before its complete payload tree");
  }
  return Object.freeze({
    complete,
    missingDirectories: Object.freeze(missingDirectories),
    missingFiles: Object.freeze(missingFiles),
    stageResidues: Object.freeze(stageResidues),
    hasStageResidueDirectory,
  });
}

function pathStatus(target) {
  try {
    return lstatSync(target, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

/**
 * 检查journal intent对应的私有stage是否缺失、部分或完整，并拒绝与final root并存。
 * 该入口只观察物理闭包；是否允许forward recovery仍由demand-state-service决定。
 */
export function inspectEvidenceStage(input = {}) {
  input = canonicalTreeInput(input, ["stateRoot", "write"], ["allowMissing"], "inspectEvidenceStage input");
  const { stateRoot, allowMissing = true } = input;
  let { write } = input;
  if (typeof allowMissing !== "boolean") {
    fail("wakeflow-evidence-tree-input", "inspectEvidenceStage input.allowMissing must be boolean");
  }
  const normalized = normalizeWrite(write);
  const { evidenceId } = normalized;
  write = normalized.write;
  const stage = evidenceStagePath({ stateRoot, evidenceId });
  const final = evidenceRootPath({ stateRoot, evidenceId });
  if (pathStatus(stage) && pathStatus(final)) {
    fail("wakeflow-evidence-tree-ambiguous", "evidence stage and final root cannot coexist");
  }
  if (!pathStatus(stage)) {
    if (allowMissing) return Object.freeze({ exists: false, complete: false, path: stage });
    fail("wakeflow-evidence-tree-stage", "required evidence stage is missing");
  }
  const inspected = inspectOutputTree({ root: stage, write, allowPartial: true });
  return Object.freeze({ exists: true, path: stage, ...inspected });
}

/**
 * 在新mutation前拒绝其他evidence intent留下的deterministic stage。
 * 可选evidenceId只豁免当前事务自己的stage，不删除或采纳任何残留。
 */
export function assertNoEvidenceStageResidue(input = {}) {
  input = canonicalTreeInput(input, ["stateRoot"], ["evidenceId"], "assertNoEvidenceStageResidue input");
  const { stateRoot, evidenceId = null } = input;
  const evidenceRoot = path.join(resolveStateRoot(stateRoot), "evidence");
  const before = assertPrivateDirectory(evidenceRoot, "evidence capability root");
  const allowed = evidenceId === null ? null : `.${assertWakeflowId(evidenceId, "evidence", "$evidenceId")}.wakeflow-stage`;
  let entries;
  let afterEntries;
  let after;
  try {
    entries = readdirSync(evidenceRoot).sort(lexicalCompare);
    afterEntries = readdirSync(evidenceRoot).sort(lexicalCompare);
    after = lstatSync(evidenceRoot, { bigint: true });
  } catch (cause) {
    fail("wakeflow-evidence-tree-race", "evidence capability root changed while checking stage residue", {}, cause);
  }
  if (
    after.isSymbolicLink()
    || !after.isDirectory()
    || !nodeOwnedByCurrentUser(after)
    || !sameObservedStat(before, after)
    || canonicalJson(entries) !== canonicalJson(afterEntries)
  ) {
    fail("wakeflow-evidence-tree-race", "evidence capability root changed while checking stage residue");
  }
  const stages = entries.filter((name) => /^\.evidence_[^/]+\.wakeflow-stage$/u.test(name));
  const forbidden = allowed === null ? stages : stages.filter((name) => name !== allowed);
  if (forbidden.length > 0) {
    fail("wakeflow-evidence-tree-stage-residue", "unresolved evidence stage residue blocks mutation", { count: forbidden.length });
  }
}

// apply/recover重新捕获managed source并与journaled manifest逐字段相等；locator-only没有payload bytes。
function exactMaterialization(write, resolvedSourceRoot) {
  const manifest = write.value;
  if (manifest.source.kind !== "managed-path") {
    if (resolvedSourceRoot !== null && resolvedSourceRoot !== undefined) {
      fail("wakeflow-evidence-source-root", "locator-only evidence cannot use a filesystem source root");
    }
    return Object.freeze({ files: new Map() });
  }
  const inspected = inspectConfiguredEvidenceSource({
    root: resolvedSourceRoot,
    source: manifest.source,
    sensitivity: manifest.sensitivity,
    controllerReviewedOpaque: manifest.controllerReviewedOpaque === true,
  });
  const expected = {
    source: inspected.source,
    payload: inspected.payload,
    privacyScan: inspected.privacyScan,
    ...(inspected.controllerReviewedOpaque ? { controllerReviewedOpaque: true } : {}),
  };
  const actual = {
    source: manifest.source,
    payload: manifest.payload,
    privacyScan: manifest.privacyScan,
    ...(manifest.controllerReviewedOpaque ? { controllerReviewedOpaque: true } : {}),
  };
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    fail("wakeflow-evidence-source-drift", "current evidence source no longer matches the journaled manifest");
  }
  return inspected.materialization;
}

// ==================== 六、deterministic member-stage恢复与清理 ====================

function createPrivateDirectory(target) {
  try {
    mkdirSync(target, { mode: 0o700 });
  } catch (cause) {
    if (cause?.code !== "EEXIST") throw cause;
  }
  assertPrivateDirectory(target, "evidence stage directory");
}

function stageMemberResidueDirectory(stage) {
  return path.join(stage, STAGE_MEMBERS_DIRECTORY);
}

function stageMemberResiduePath(stage, target) {
  const relative = path.relative(stage, target).split(path.sep).join("/");
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith("../")
  ) {
    fail("wakeflow-evidence-tree-stage-residue", "evidence member target must stay inside its exact stage");
  }
  return path.join(stageMemberResidueDirectory(stage), stageResidueName(relative));
}

// 只有已验证为空的私有member-stage namespace可被恢复清理。
function removeStageMemberResidueDirectory(stage) {
  const directory = stageMemberResidueDirectory(stage);
  if (!pathStatus(directory)) return;
  assertPrivateDirectory(directory, "evidence member stage namespace");
  if (readdirSync(directory).length !== 0) {
    fail("wakeflow-evidence-tree-stage-residue", "evidence member stage namespace must be empty before cleanup");
  }
  rmdirSync(directory);
}

// 删除前用no-follow descriptor复验同一current-owner residue节点，拒绝路径替换或权限漂移。
function removeStageMemberResidue(target) {
  const before = lstatSync(target, { bigint: true });
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.nlink !== 1n
    || (process.platform !== "win32" && permissionBits(before) !== 0o600)
    || !nodeOwnedByCurrentUser(before)
  ) {
    fail(
      "wakeflow-evidence-tree-stage-residue",
      "evidence member stage residue must remain one private single-link regular file",
    );
  }
  let descriptor = null;
  try {
    descriptor = openSync(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(target, { bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(opened) !== 0o600)
      || !nodeOwnedByCurrentUser(opened)
      || !sameObservedStat(before, opened)
      || !sameObservedStat(opened, afterDescriptor)
      || after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n
      || (process.platform !== "win32" && permissionBits(after) !== 0o600)
      || !nodeOwnedByCurrentUser(after)
      || !sameObservedStat(afterDescriptor, after)
    ) {
      fail(
        "wakeflow-evidence-tree-stage-residue",
        "evidence member stage residue changed before recovery cleanup",
      );
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  unlinkSync(target);
}

// 每个member先写确定性exclusive residue、复验bytes，再rename到stage内最终相对目标。
function writeEvidenceStageMember({ stage, target, bytes, label }) {
  const residueDirectory = stageMemberResidueDirectory(stage);
  createPrivateDirectory(residueDirectory);
  const residue = stageMemberResiduePath(stage, target);
  if (pathStatus(residue)) removeStageMemberResidue(residue);
  if (pathStatus(target)) {
    fail("wakeflow-evidence-tree-stage-residue", `${label} appeared before its exclusive stage write`);
  }
  let descriptor = null;
  let residueOwned = false;
  try {
    descriptor = openSync(
      residue,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    residueOwned = true;
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    closeSync(descriptor);
    descriptor = null;
    safeOutputFile(residue, bytes, `${label} private member stage`);
    if (pathStatus(target)) {
      fail("wakeflow-evidence-tree-stage-residue", `${label} target changed before member publication`);
    }
    renameSync(residue, target);
    residueOwned = false;
  } catch (cause) {
    if (cause instanceof WakeflowEvidenceTreeError) throw cause;
    fail("wakeflow-evidence-tree-stage-write", `${label} could not be staged privately`, {}, cause);
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // 关闭失败时保留的确定性residue仍由原journal拥有并可显式恢复。
      }
    }
    if (residueOwned) {
      try {
        unlinkSync(residue);
      } catch {
        // 未能清理的确定性residue会在下一次显式replay中重新验证后处理。
      }
    }
    try {
      removeStageMemberResidueDirectory(stage);
    } catch {
      // 私有空namespace不构成已发布事实，并在显式恢复中再次清理。
    }
  }
  return safeOutputFile(target, bytes, label);
}

// ==================== 七、完整stage物化与immutable发布 ====================

/**
 * 依据validated write intent重捕获exact source，并前向完成可验证的partial stage。
 * manifest最后写入；本方法不发布final root，也不写event/state/journal。
 */
export function materializeEvidenceStage(input = {}) {
  input = canonicalTreeInput(
    input,
    ["stateRoot", "write"],
    ["resolvedSourceRoot"],
    "materializeEvidenceStage input",
  );
  const { stateRoot, resolvedSourceRoot = null } = input;
  let { write } = input;
  const normalized = normalizeWrite(write);
  const { evidenceId } = normalized;
  write = normalized.write;
  const capabilityRoot = path.join(resolveStateRoot(stateRoot), "evidence");
  assertPrivateDirectory(capabilityRoot, "evidence capability root");
  assertNoEvidenceStageResidue({ stateRoot, evidenceId });
  const final = evidenceRootPath({ stateRoot, evidenceId });
  if (pathStatus(final)) fail("wakeflow-evidence-tree-conflict", "immutable evidence final root already exists");
  const materialization = exactMaterialization(write, resolvedSourceRoot);
  const stage = evidenceStagePath({ stateRoot, evidenceId });
  createPrivateDirectory(stage);
  const partial = inspectEvidenceStage({ stateRoot, write, allowMissing: false });
  for (const residue of partial.stageResidues) {
    removeStageMemberResidue(path.join(stage, ...residue.path.split("/")));
  }
  if (partial.hasStageResidueDirectory) removeStageMemberResidueDirectory(stage);
  const expected = expectedTree(write);
  const directories = [...expected.directories]
    .filter(Boolean)
    .sort((left, right) => left.split("/").length - right.split("/").length || lexicalCompare(left, right));
  for (const relative of directories) createPrivateDirectory(path.join(stage, ...relative.split("/")));
  for (const descriptor of write.value.payload?.files ?? []) {
    const target = path.join(stage, ...descriptor.path.split("/"));
    const bytes = materialization.files.get(descriptor.path);
    if (!Buffer.isBuffer(bytes)) fail("wakeflow-evidence-source-drift", "evidence source materialization is incomplete");
    if (pathStatus(target)) {
      safeOutputFile(target, bytes, "existing evidence stage payload");
    } else {
      writeEvidenceStageMember({
        stage,
        target,
        bytes,
        label: "evidence stage payload",
      });
    }
  }
  const manifestTarget = path.join(stage, "evidence.json");
  if (pathStatus(manifestTarget)) {
    safeOutputFile(manifestTarget, expected.manifestBytes, "existing evidence stage manifest");
  } else {
    writeEvidenceStageMember({
      stage,
      target: manifestTarget,
      bytes: expected.manifestBytes,
      label: "evidence stage manifest",
    });
  }
  const inspected = inspectEvidenceStage({ stateRoot, write, allowMissing: false });
  if (!inspected.complete) fail("wakeflow-evidence-tree-incomplete", "evidence stage could not be completed");
  return inspected;
}

/**
 * 只把一棵complete且residue-free的同父stage rename为create-once final root并立即复验。
 * Node rename不被表述为非协作actor下的全局no-replace CAS；调用方state lock承担协作进程互斥。
 */
export function publishEvidenceStage(input = {}) {
  input = canonicalTreeInput(input, ["stateRoot", "write"], [], "publishEvidenceStage input");
  const { stateRoot } = input;
  let { write } = input;
  const normalized = normalizeWrite(write);
  const { evidenceId } = normalized;
  write = normalized.write;
  const stage = inspectEvidenceStage({ stateRoot, write, allowMissing: false });
  if (!stage.complete || stage.hasStageResidueDirectory) {
    fail("wakeflow-evidence-tree-incomplete", "only a complete residue-free evidence stage can be published");
  }
  const final = evidenceRootPath({ stateRoot, evidenceId });
  if (pathStatus(final)) fail("wakeflow-evidence-tree-conflict", "immutable evidence final root already exists");
  try {
    renameSync(stage.path, final);
  } catch (cause) {
    fail("wakeflow-evidence-tree-publish", "complete evidence stage could not be published", {}, cause);
  }
  return inspectEvidenceFinalWrite({ stateRoot, write });
}

/**
 * 严格关闭一棵已发布immutable evidence root的目录、manifest、payload bytes与content class。
 * 成功只证明exact记录未变；内容真实性、Controller验收和demand完成度仍由上层决定。
 */
export function inspectEvidenceFinalWrite(input = {}) {
  input = canonicalTreeInput(input, ["stateRoot", "write"], [], "inspectEvidenceFinalWrite input");
  const { stateRoot } = input;
  let { write } = input;
  const normalized = normalizeWrite(write);
  const { evidenceId } = normalized;
  write = normalized.write;
  const stage = evidenceStagePath({ stateRoot, evidenceId });
  const final = evidenceRootPath({ stateRoot, evidenceId });
  if (pathStatus(stage)) fail("wakeflow-evidence-tree-ambiguous", "evidence final root cannot coexist with its stage");
  if (!pathStatus(final)) fail("wakeflow-evidence-tree-missing", "immutable evidence final root is missing");
  const inspected = inspectOutputTree({ root: final, write, allowPartial: false });
  return Object.freeze({ path: final, ...inspected });
}
