import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";

/**
 * Wakeflow已加载artifact tree的可移植身份codec与scanner。
 *
 * 阅读地图：manifest validator关闭portable ref、排序、digest与总量合同；scanner以entry/file/byte/depth
 * 硬预算、no-follow文件读取和两次完整遍历生成location-independent digest。结果只证明观察时的
 * tree bytes与executable bit，不证明artifact之后不可变，也不替代release provenance或host激活。
 */

// ==================== 一、版本、预算与被动数据合同 ====================

export const WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION = 1;
export const WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND = "wakeflow-loaded-artifact-tree";
export const WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS = Object.freeze({
  maxDepth: 64,
  maxEntries: 8192,
  maxFileBytes: 32 * 1024 * 1024,
  maxFiles: 4096,
  maxRefBytes: 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

const LIMIT_FIELDS = Object.freeze(Object.keys(WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS).sort());
const MANIFEST_FIELDS = Object.freeze(["artifactKind", "fileCount", "files", "schemaVersion", "totalBytes"]);
const FILE_FIELDS = Object.freeze(["bytes", "digest", "executable", "ref"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const UNSAFE_REF_CHARACTER_PATTERN = /[\\\u0000-\u001f\u007f\ufffd]/u;

export class WakeflowArtifactTreeIdentityError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowArtifactTreeIdentityError";
    this.code = code;
    this.path = errorPath;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}) {
  throw new WakeflowArtifactTreeIdentityError(code, `${message} at ${errorPath}`, {
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
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail(code, at, "symbol properties are not allowed");
  }
  const actual = /** @type {string[]} */ (ownKeys).sort();
  const expected = [...fields].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(code, at, "object fields do not match the closed contract", { actual, expected });
  }
  const result = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${at}/${field}`, "fields must be enumerable data properties");
    }
    result[field] = descriptor.value;
  }
  return result;
}

function optionalDataObject(value, fields, at, code) {
  if (!isPlainObject(value)) fail(code, at, "expected a plain object");
  const allowed = new Set(fields);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail(code, at, "object contains an unknown field", {
        field: typeof key === "string" ? key : "<symbol>",
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${at}/${key}`, "fields must be enumerable data properties");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function exactDenseArray(value, at, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(code, at, "expected a built-in array");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value")) {
    fail(code, at, "array length must be a data property");
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) fail(code, at, "array length is invalid");
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      fail(code, at, "array contains a non-index property");
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length) {
      fail(code, at, "array contains an invalid index");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${at}/${key}`, "array entries must be enumerable data properties");
    }
  }
  const entries = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code, `${at}/${index}`, "sparse arrays are not allowed");
    entries.push(Object.getOwnPropertyDescriptor(value, String(index)).value);
  }
  return entries;
}

function positiveSafeInteger(value, at, code) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(code, at, "expected a positive safe integer", { value });
  }
  return value;
}

function nonNegativeSafeInteger(value, at, code) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(code, at, "expected a non-negative safe integer", { value });
  }
  return value;
}

function resolveLimits(limits) {
  if (limits === undefined) return WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS;
  const value = exactDataObject(limits, LIMIT_FIELDS, "$/limits", "wakeflow-artifact-tree-limits");
  const normalized = Object.fromEntries(
    LIMIT_FIELDS.map((field) => [
      field,
      positiveSafeInteger(value[field], `$/limits/${field}`, "wakeflow-artifact-tree-limits"),
    ]),
  );
  for (const field of LIMIT_FIELDS) {
    if (normalized[field] > WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS[field]) {
      fail("wakeflow-artifact-tree-limits", `$/limits/${field}`, "custom limits cannot widen the built-in safety bound", {
        actual: normalized[field],
        maximum: WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS[field],
      });
    }
  }
  return deepFreeze(normalized);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portableCollisionKey(ref) {
  return ref.normalize("NFC").toLowerCase();
}

function validateRef(ref, at, limits) {
  if (
    typeof ref !== "string"
    || !ref
    || ref !== ref.trim()
    || path.posix.isAbsolute(ref)
    || path.win32.isAbsolute(ref)
    || path.posix.normalize(ref) !== ref
    || ref.normalize("NFC") !== ref
    || UNSAFE_REF_CHARACTER_PATTERN.test(ref)
  ) {
    fail("wakeflow-artifact-tree-ref", at, "expected a canonical portable artifact-relative ref", { ref });
  }
  const segments = ref.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment !== segment.trim())) {
    fail("wakeflow-artifact-tree-ref", at, "artifact ref contains a noncanonical segment", { ref });
  }
  if (segments.length > limits.maxDepth) {
    fail("wakeflow-artifact-tree-depth", at, "artifact ref exceeds the depth bound", {
      ref,
      actual: segments.length,
      limit: limits.maxDepth,
    });
  }
  const refBytes = Buffer.byteLength(ref, "utf8");
  if (refBytes > limits.maxRefBytes) {
    fail("wakeflow-artifact-tree-ref-bytes", at, "artifact ref exceeds the byte bound", {
      ref,
      actual: refBytes,
      limit: limits.maxRefBytes,
    });
  }
  return ref;
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

function sameStatIdentity(left, right) {
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

// ==================== 二、单文件有界稳定读取 ====================

function readExactRegularFile(file, ref, limits) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (error) {
    fail("wakeflow-artifact-tree-inspection", `$/files/${ref}`, "cannot inspect artifact entry", {
      ref,
      causeCode: error?.code ?? "unknown",
    });
  }
  if (before.isSymbolicLink()) {
    fail("wakeflow-artifact-tree-symlink", `$/files/${ref}`, "artifact tree cannot contain a symbolic link", { ref });
  }
  if (!before.isFile()) {
    fail("wakeflow-artifact-tree-special-node", `$/files/${ref}`, "artifact tree contains an unsupported node", {
      ref,
      actualType: statType(before),
    });
  }
  if (before.size > BigInt(limits.maxFileBytes)) {
    fail("wakeflow-artifact-tree-file-bytes", `$/files/${ref}`, "artifact file exceeds the byte bound", {
      ref,
      actual: String(before.size),
      limit: limits.maxFileBytes,
    });
  }

  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = error?.code === "ELOOP"
      ? "wakeflow-artifact-tree-symlink"
      : "wakeflow-artifact-tree-inspection";
    fail(code, `$/files/${ref}`, "cannot open exact artifact file", {
      ref,
      causeCode: error?.code ?? "unknown",
    });
  }

  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) {
      fail("wakeflow-artifact-tree-special-node", `$/files/${ref}`, "opened artifact entry is not a regular file", {
        ref,
        actualType: statType(opened),
      });
    }
    if (!sameStatIdentity(before, opened)) {
      fail("wakeflow-artifact-tree-unstable", `$/files/${ref}`, "artifact file changed while it was opened", { ref });
    }
    if (opened.size > BigInt(limits.maxFileBytes)) {
      fail("wakeflow-artifact-tree-file-bytes", `$/files/${ref}`, "artifact file exceeds the byte bound", {
        ref,
        actual: String(opened.size),
        limit: limits.maxFileBytes,
      });
    }
    // 只按打开时size多分配一个字节；增长竞态最多读到这个probe，不会让readFileSync
    // 按攻击者后来扩张的文件大小进行无界分配。
    const buffer = Buffer.allocUnsafe(Number(opened.size) + 1);
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
      fail("wakeflow-artifact-tree-unstable", `$/files/${ref}`, "artifact file disappeared while it was read", { ref });
    }
    if (
      !sameStatIdentity(opened, after)
      || !sameStatIdentity(opened, afterPath)
      || offset !== Number(opened.size)
    ) {
      fail("wakeflow-artifact-tree-unstable", `$/files/${ref}`, "artifact file changed while it was read", { ref });
    }
    if (offset > limits.maxFileBytes) {
      fail("wakeflow-artifact-tree-file-bytes", `$/files/${ref}`, "artifact file exceeds the byte bound", {
        ref,
        actual: offset,
        limit: limits.maxFileBytes,
      });
    }
    const bytes = buffer.subarray(0, offset);
    return {
      bytes: offset,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      executable: Boolean(after.mode & 0o111n),
      ref,
    };
  } finally {
    closeSync(descriptor);
  }
}

// ==================== 三、整棵树的有界双遍扫描 ====================

function scanArtifactTree(root, limits) {
  const files = [];
  const portableRefs = new Map();
  let totalBytes = 0;
  let entryCount = 0;

  const visit = (directory, segments) => {
    let before;
    try {
      before = lstatSync(directory, { bigint: true });
    } catch (error) {
      fail("wakeflow-artifact-tree-inspection", "$", "cannot inspect artifact directory", {
        ref: segments.join("/"),
        causeCode: error?.code ?? "unknown",
      });
    }
    if (before.isSymbolicLink()) {
      const ref = segments.join("/");
      fail("wakeflow-artifact-tree-symlink", ref ? `$/entries/${ref}` : "$", "artifact tree cannot contain a symbolic link", { ref });
    }
    if (!before.isDirectory()) {
      const ref = segments.join("/");
      fail("wakeflow-artifact-tree-special-node", ref ? `$/entries/${ref}` : "$", "artifact node must be a directory", {
        ref,
        actualType: statType(before),
      });
    }

    const names = [];
    let handle = null;
    try {
      handle = opendirSync(directory, { encoding: "utf8" });
      for (;;) {
        const entry = handle.readSync();
        if (entry === null) break;
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          fail("wakeflow-artifact-tree-entry-count", "$/entries", "artifact tree exceeds the physical-entry bound", {
            actual: entryCount,
            limit: limits.maxEntries,
          });
        }
        names.push(entry.name);
      }
      names.sort(compareText);
    } catch (error) {
      if (error instanceof WakeflowArtifactTreeIdentityError) throw error;
      fail("wakeflow-artifact-tree-inspection", "$", "cannot enumerate artifact directory", {
        ref: segments.join("/"),
        causeCode: error?.code ?? "unknown",
      });
    } finally {
      if (handle !== null) {
        try {
          handle.closeSync();
        } catch {
          // enumeration result is still checked against the directory identity below
        }
      }
    }
    for (const name of names) {
      const ref = validateRef([...segments, name].join("/"), `$/entries/${entryCount}`, limits);
      const collisionKey = portableCollisionKey(ref);
      if (portableRefs.has(collisionKey)) {
        fail("wakeflow-artifact-tree-ref-collision", `$/entries/${ref}`, "artifact refs collide under portable comparison", {
          ref,
          otherRef: portableRefs.get(collisionKey),
        });
      }
      portableRefs.set(collisionKey, ref);
      const absolute = path.join(directory, name);
      let stat;
      try {
        stat = lstatSync(absolute, { bigint: true });
      } catch (error) {
        fail("wakeflow-artifact-tree-inspection", `$/entries/${ref}`, "cannot inspect artifact entry", {
          ref,
          causeCode: error?.code ?? "unknown",
        });
      }
      if (stat.isSymbolicLink()) {
        fail("wakeflow-artifact-tree-symlink", `$/entries/${ref}`, "artifact tree cannot contain a symbolic link", { ref });
      }
      if (stat.isDirectory()) {
        visit(absolute, [...segments, name]);
        continue;
      }
      if (!stat.isFile()) {
        fail("wakeflow-artifact-tree-special-node", `$/entries/${ref}`, "artifact tree contains an unsupported node", {
          ref,
          actualType: statType(stat),
        });
      }
      if (files.length >= limits.maxFiles) {
        fail("wakeflow-artifact-tree-file-count", `$/entries/${ref}`, "artifact tree exceeds the file-count bound", {
          actual: files.length + 1,
          limit: limits.maxFiles,
        });
      }
      const entry = readExactRegularFile(absolute, ref, limits);
      totalBytes += entry.bytes;
      if (totalBytes > limits.maxTotalBytes) {
        fail("wakeflow-artifact-tree-total-bytes", `$/entries/${ref}`, "artifact tree exceeds the total-byte bound", {
          actual: totalBytes,
          limit: limits.maxTotalBytes,
        });
      }
      files.push(entry);
    }

    let after;
    try {
      after = lstatSync(directory, { bigint: true });
    } catch (error) {
      fail("wakeflow-artifact-tree-unstable", "$", "artifact directory disappeared during inspection", {
        ref: segments.join("/"),
        causeCode: error?.code ?? "unknown",
      });
    }
    if (!after.isDirectory() || !sameStatIdentity(before, after)) {
      fail("wakeflow-artifact-tree-unstable", "$", "artifact directory changed during inspection", {
        ref: segments.join("/"),
      });
    }
  };

  visit(root, []);
  if (files.length === 0) {
    fail("wakeflow-artifact-tree-file-count", "$/files", "artifact tree must contain at least one regular file", {
      actual: 0,
      limit: limits.maxFiles,
    });
  }
  files.sort((left, right) => compareText(left.ref, right.ref));
  return {
    artifactKind: WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND,
    fileCount: files.length,
    files,
    schemaVersion: WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION,
    totalBytes,
  };
}

// ==================== 四、artifact root与portable manifest公共入口 ====================

function normalizeAbsoluteArtifactRoot(artifactRoot) {
  if (
    typeof artifactRoot !== "string"
    || !artifactRoot
    || artifactRoot !== artifactRoot.trim()
    || !path.isAbsolute(artifactRoot)
    || path.resolve(artifactRoot) !== artifactRoot
    || artifactRoot.includes("\0")
  ) {
    fail("wakeflow-artifact-tree-root", "$/artifactRoot", "artifact root must be a normalized absolute path");
  }
  let rootStat;
  try {
    rootStat = lstatSync(artifactRoot, { bigint: true });
  } catch (error) {
    fail("wakeflow-artifact-tree-root", "$/artifactRoot", "artifact root is unavailable", {
      causeCode: error?.code ?? "unknown",
    });
  }
  if (rootStat.isSymbolicLink()) {
    fail("wakeflow-artifact-tree-root-symlink", "$/artifactRoot", "artifact root cannot be a symbolic link");
  }
  if (!rootStat.isDirectory()) {
    fail("wakeflow-artifact-tree-root", "$/artifactRoot", "artifact root must be a directory", {
      actualType: statType(rootStat),
    });
  }
  try {
    return realpathSync(artifactRoot);
  } catch (error) {
    fail("wakeflow-artifact-tree-root", "$/artifactRoot", "artifact root cannot be resolved", {
      causeCode: error?.code ?? "unknown",
    });
  }
}

/** 校验并冻结一个portable manifest；不访问artifactRoot，也不重新证明其中digest对应真实文件。 */
export function validateWakeflowArtifactTreeManifest(manifest, options = undefined) {
  const optionValue = options === undefined
    ? {}
    : optionalDataObject(
      options,
      ["limits"],
      "$/options",
      "wakeflow-artifact-tree-input",
    );
  const limits = optionValue.limits;
  const resolvedLimits = resolveLimits(limits);
  const value = exactDataObject(
    manifest,
    MANIFEST_FIELDS,
    "$",
    "wakeflow-artifact-tree-manifest-shape",
  );
  if (value.schemaVersion !== WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION) {
    fail("wakeflow-artifact-tree-manifest-version", "$/schemaVersion", `expected ${WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION}`);
  }
  if (value.artifactKind !== WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND) {
    fail("wakeflow-artifact-tree-manifest-kind", "$/artifactKind", `expected ${WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND}`);
  }
  const declaredFileCount = nonNegativeSafeInteger(
    value.fileCount,
    "$/fileCount",
    "wakeflow-artifact-tree-manifest-totals",
  );
  const declaredTotalBytes = nonNegativeSafeInteger(
    value.totalBytes,
    "$/totalBytes",
    "wakeflow-artifact-tree-manifest-totals",
  );
  const inputFiles = exactDenseArray(value.files, "$/files", "wakeflow-artifact-tree-manifest-shape");
  if (inputFiles.length === 0 || inputFiles.length > resolvedLimits.maxFiles) {
    fail("wakeflow-artifact-tree-file-count", "$/files", "artifact manifest file count is outside the bound", {
      actual: inputFiles.length,
      limit: resolvedLimits.maxFiles,
    });
  }
  const collisions = new Map();
  let previousRef = null;
  const files = inputFiles.map((input, index) => {
    const at = `$/files/${index}`;
    const entry = exactDataObject(input, FILE_FIELDS, at, "wakeflow-artifact-tree-manifest-shape");
    const ref = validateRef(entry.ref, `${at}/ref`, resolvedLimits);
    if (previousRef !== null && compareText(previousRef, ref) >= 0) {
      fail("wakeflow-artifact-tree-manifest-order", `${at}/ref`, "artifact manifest refs must be unique and lexically sorted", { ref });
    }
    previousRef = ref;
    const collisionKey = portableCollisionKey(ref);
    if (collisions.has(collisionKey)) {
      fail("wakeflow-artifact-tree-ref-collision", `${at}/ref`, "artifact refs collide under portable comparison", {
        ref,
        otherRef: collisions.get(collisionKey),
      });
    }
    collisions.set(collisionKey, ref);
    const bytes = nonNegativeSafeInteger(entry.bytes, `${at}/bytes`, "wakeflow-artifact-tree-manifest-shape");
    if (bytes > resolvedLimits.maxFileBytes) {
      fail("wakeflow-artifact-tree-file-bytes", `${at}/bytes`, "artifact file exceeds the byte bound", {
        ref,
        actual: bytes,
        limit: resolvedLimits.maxFileBytes,
      });
    }
    if (typeof entry.digest !== "string" || !SHA256_PATTERN.test(entry.digest)) {
      fail("wakeflow-artifact-tree-manifest-shape", `${at}/digest`, "artifact file digest must be canonical SHA-256");
    }
    if (typeof entry.executable !== "boolean") {
      fail("wakeflow-artifact-tree-manifest-shape", `${at}/executable`, "artifact executable classification must be boolean");
    }
    return {
      bytes,
      digest: entry.digest,
      executable: entry.executable,
      ref,
    };
  });
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes > resolvedLimits.maxTotalBytes) {
    fail("wakeflow-artifact-tree-total-bytes", "$/totalBytes", "artifact manifest exceeds the total-byte bound", {
      actual: totalBytes,
      limit: resolvedLimits.maxTotalBytes,
    });
  }
  if (declaredFileCount !== files.length || declaredTotalBytes !== totalBytes) {
    fail("wakeflow-artifact-tree-manifest-totals", "$", "artifact manifest totals do not match its exact files", {
      actualFileCount: files.length,
      actualTotalBytes: totalBytes,
      declaredFileCount,
      declaredTotalBytes,
    });
  }
  return deepFreeze({
    artifactKind: WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND,
    fileCount: files.length,
    files,
    schemaVersion: WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION,
    totalBytes,
  });
}

/** 对一个normalized absolute artifact root执行两遍有界扫描并返回manifest及canonical digest。 */
export function inspectWakeflowArtifactTree(input = undefined) {
  const values = optionalDataObject(
    input === undefined ? {} : input,
    ["artifactRoot", "limits"],
    "$",
    "wakeflow-artifact-tree-input",
  );
  const artifactRoot = values.artifactRoot;
  const limits = values.limits;
  const resolvedLimits = resolveLimits(limits);
  const root = normalizeAbsoluteArtifactRoot(artifactRoot);
  const first = validateWakeflowArtifactTreeManifest(scanArtifactTree(root, resolvedLimits), {
    limits: resolvedLimits,
  });
  const second = validateWakeflowArtifactTreeManifest(scanArtifactTree(root, resolvedLimits), {
    limits: resolvedLimits,
  });
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail("wakeflow-artifact-tree-unstable", "$", "artifact tree changed between exact inventory passes");
  }
  return deepFreeze({
    artifactDigest: canonicalJsonDigest(first),
    manifest: first,
  });
}
