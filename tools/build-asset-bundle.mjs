#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowAssetBundle,
  WAKEFLOW_ASSET_BUNDLE_MAX_BYTES,
  WAKEFLOW_ASSET_CONTRACTS,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";

/**
 * canonical模板源到安装资产bundle的唯一构建器。
 *
 * 职责导航：
 * 1. 严格读取manifest及已登记模板，拒绝额外文件、路径逃逸和不稳定文件身份。
 * 2. 生成source、entry与bundle三层摘要，并用安装loader反向校验最终运行时合同。
 * 3. 对生成字节实施与安装loader相同的1 MiB预算，避免构建出运行时必然拒绝的artifact。
 * 4. CLI只负责选择明确source root和可选输出文件；不拥有模板领域语义或插件同步。
 *
 * 本模块不读取目标workspace，不决定投影内容，也不替代sync-core的双宿主物化职责。
 */

export const WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH = "templates/wakeflow-asset-bundle.json";
export const WAKEFLOW_ASSET_BUNDLE_SCHEMA_VERSION = 2;
export const WAKEFLOW_ASSET_BUNDLE_KIND = "wakeflow-install-assets";
export const WAKEFLOW_ASSET_SOURCE_KIND = "wakeflow-template-sources";
export const WAKEFLOW_ASSET_SOURCE_VERSION = 1;
export const WAKEFLOW_ASSET_SOURCE_LABEL = "core/template-sources";

const EXPECTED_MANIFEST_FIELDS = ["artifactKind", "assets", "schemaVersion", "source"];
const EXPECTED_ASSET_FIELDS = ["consumers", "id", "input", "kind", "owner", "source"];
const INPUT_TYPES = new Set(["integer", "string"]);
const ASSET_MANIFEST_MAX_BYTES = 256 * 1024;
const ASSET_SOURCE_FILE_MAX_BYTES = 1024 * 1024;
const ASSET_SOURCE_TREE_MAX_ENTRIES = 256;
const ASSET_SOURCE_TREE_MAX_DEPTH = 8;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class WakeflowAssetBuildError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowAssetBuildError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

function fail(code, errorPath, message, details = {}) {
  throw new WakeflowAssetBuildError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, at, fields) {
  if (!isPlainObject(value)) fail("wakeflow-asset-source-type", at, "expected an object");
  const expected = new Set(fields);
  const keys = Reflect.ownKeys(value);
  const symbol = keys.find((key) => typeof key !== "string");
  if (symbol) fail("wakeflow-asset-source-unknown", at, "symbol-keyed fields are not allowed");
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-asset-source-type", `${at}/${key}`, `field ${key} must be an enumerable data property`);
    }
    if (!expected.has(key)) fail("wakeflow-asset-source-unknown", `${at}/${key}`, `unknown field ${key}`);
    snapshot[key] = descriptor.value;
  }
  for (const field of fields) {
    if (!Object.hasOwn(snapshot, field)) {
      fail("wakeflow-asset-source-missing", `${at}/${field}`, `missing field ${field}`);
    }
  }
  return Object.freeze(snapshot);
}

function nonEmptyString(value, at) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    fail("wakeflow-asset-source-type", at, "expected a non-empty string without outer whitespace");
  }
  return value;
}

function sortedUniqueStrings(value, at) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("wakeflow-asset-source-type", at, "expected a non-empty string array");
  }
  const strings = value.map((entry, index) => nonEmptyString(entry, `${at}/${index}`));
  const sorted = [...strings].sort();
  if (
    new Set(strings).size !== strings.length
    || strings.length !== sorted.length
    || strings.some((entry, index) => entry !== sorted[index])
  ) {
    fail("wakeflow-asset-source-order", at, "values must be unique and sorted");
  }
  return strings;
}

function safeSourcePath(value, at) {
  const candidate = nonEmptyString(value, at);
  if (
    candidate.includes("\\")
    || candidate.includes("\0")
    || path.posix.isAbsolute(candidate)
    || candidate === "."
    || candidate === ".."
    || candidate.startsWith("../")
    || path.posix.normalize(candidate) !== candidate
  ) {
    fail("wakeflow-asset-source-path", at, "expected a canonical source-relative path", { value: candidate });
  }
  return candidate;
}

function normalizeInput(value, at) {
  if (!isPlainObject(value)) {
    fail("wakeflow-asset-source-type", at, "input must be a non-empty object");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string") || ownKeys.length === 0) {
    fail("wakeflow-asset-source-type", at, "input must contain only string-keyed fields");
  }
  const snapshot = Object.create(null);
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-asset-source-type", `${at}/${key}`, `input ${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  const keys = ownKeys;
  const sorted = [...keys].sort();
  if (keys.some((entry, index) => entry !== sorted[index])) {
    fail("wakeflow-asset-source-order", at, "input keys must be sorted");
  }
  return Object.fromEntries(keys.map((key) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(key) || !INPUT_TYPES.has(snapshot[key])) {
      fail("wakeflow-asset-source-input", `${at}/${key}`, "input fields require a safe name and known scalar type");
    }
    return [key, snapshot[key]];
  }));
}

function contentDigest(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// 在分配前实施容量预算，并在descriptor与路径两侧复查同一regular single-link文件。
function readStableFileBytes(file, at, maxBytes, { missingCode = "wakeflow-asset-source-file" } = {}) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") fail(missingCode, at, "source file is missing");
    fail("wakeflow-asset-source-file", at, "source file cannot be safely inspected");
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    fail("wakeflow-asset-source-file", at, "source must be one regular non-symlink single-link file");
  }
  if (before.size < 1n || before.size > BigInt(maxBytes)) {
    fail("wakeflow-asset-source-too-large", at, `source must be between 1 and ${maxBytes} bytes`);
  }

  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      fail("wakeflow-asset-source-file", at, "source identity changed before open");
    }
    const expectedBytes = Number(opened.size);
    const bytes = Buffer.alloc(expectedBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > expectedBytes) {
      fail("wakeflow-asset-source-too-large", at, "source grew while it was read");
    }
    if (offset !== expectedBytes) fail("wakeflow-asset-source-file", at, "source changed while it was read");
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    let afterPath;
    try {
      afterPath = lstatSync(file, { bigint: true });
    } catch {
      fail("wakeflow-asset-source-file", at, "source path changed while it was read");
    }
    if (!sameFileIdentity(opened, afterDescriptor) || !sameFileIdentity(opened, afterPath)) {
      fail("wakeflow-asset-source-file", at, "source identity changed while it was read");
    }
    return bytes.subarray(0, offset);
  } catch (cause) {
    if (cause instanceof WakeflowAssetBuildError) throw cause;
    fail("wakeflow-asset-source-file", at, "source file cannot be safely read");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return null;
}

// 模板和manifest共享严格UTF-8/LF/单尾换行字节合同，但各自保留独立容量预算。
function readCanonicalText(file, at, maxBytes, options) {
  const bytes = readStableFileBytes(file, at, maxBytes, options);
  let content;
  try {
    content = utf8Decoder.decode(bytes);
  } catch {
    fail("wakeflow-asset-source-bytes", at, "source must be valid canonical UTF-8 text");
  }
  if (
    content.charCodeAt(0) === 0xfeff
    || content.includes("\r")
    || !content.endsWith("\n")
    || content.endsWith("\n\n")
  ) {
    fail("wakeflow-asset-source-bytes", at, "source must be non-empty UTF-8 LF text with exactly one trailing newline");
  }
  return content;
}

function normalizedSourceRoot(value) {
  const root = nonEmptyString(value, "$/sourceRoot");
  if (!path.isAbsolute(root) || path.resolve(root) !== root || root.includes("\0")) {
    fail("wakeflow-asset-source-root", "$/sourceRoot", "sourceRoot must be one normalized absolute path");
  }
  let stat;
  try {
    stat = lstatSync(root);
  } catch {
    fail("wakeflow-asset-source-root", "$/sourceRoot", "sourceRoot is missing or unreadable");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("wakeflow-asset-source-root", "$/sourceRoot", "sourceRoot must be a real directory, not a symlink");
  }
  return root;
}

// 以流式目录句柄实施总项数与深度上限，避免先分配完整恶意目录清单。
function discoverSourceFiles(root) {
  const discovered = [];
  let entries = 0;
  const visit = (directory, depth) => {
    if (depth > ASSET_SOURCE_TREE_MAX_DEPTH) {
      fail("wakeflow-asset-source-inventory", "$/files", "source tree exceeds the maximum directory depth");
    }
    let handle;
    try {
      handle = opendirSync(directory);
      let entry;
      while ((entry = handle.readSync()) !== null) {
        entries += 1;
        if (entries > ASSET_SOURCE_TREE_MAX_ENTRIES) {
          fail("wakeflow-asset-source-inventory", "$/files", "source tree exceeds the maximum entry count");
        }
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        if (entry.isSymbolicLink()) {
          fail("wakeflow-asset-source-file", `$/files/${relative}`, "source tree cannot contain symlinks");
        }
        if (entry.isDirectory()) visit(absolute, depth + 1);
        else if (entry.isFile()) discovered.push(relative);
        else fail("wakeflow-asset-source-file", `$/files/${relative}`, "source tree contains an unsupported entry");
      }
    } catch (cause) {
      if (cause instanceof WakeflowAssetBuildError) throw cause;
      fail("wakeflow-asset-source-file", "$/files", "source tree cannot be safely enumerated");
    } finally {
      if (handle) handle.closeSync();
    }
  };
  visit(root, 0);
  return discovered;
}

/**
 * 读取并闭合canonical source inventory；返回按logical ID排序的内容与source ledger事实。
 */
export function readWakeflowAssetSources(operation) {
  const { sourceRoot } = exactObject(operation, "$", ["sourceRoot"]);
  const root = normalizedSourceRoot(sourceRoot);
  const manifestFile = path.join(root, "manifest.json");
  const manifestText = readCanonicalText(manifestFile, "$/manifest.json", ASSET_MANIFEST_MAX_BYTES, {
    missingCode: "wakeflow-asset-source-manifest",
  });
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    fail("wakeflow-asset-source-manifest", "$/manifest.json", `manifest is invalid JSON: ${error.message}`);
  }
  const sourceManifest = exactObject(manifest, "$", EXPECTED_MANIFEST_FIELDS);
  if (sourceManifest.schemaVersion !== WAKEFLOW_ASSET_SOURCE_VERSION) {
    fail("wakeflow-asset-source-version", "$/schemaVersion", `expected ${WAKEFLOW_ASSET_SOURCE_VERSION}`);
  }
  if (sourceManifest.artifactKind !== WAKEFLOW_ASSET_SOURCE_KIND) {
    fail("wakeflow-asset-source-kind", "$/artifactKind", `expected ${WAKEFLOW_ASSET_SOURCE_KIND}`);
  }
  if (sourceManifest.source !== WAKEFLOW_ASSET_SOURCE_LABEL) {
    fail("wakeflow-asset-source-label", "$/source", `expected ${WAKEFLOW_ASSET_SOURCE_LABEL}`);
  }
  if (!Array.isArray(sourceManifest.assets) || sourceManifest.assets.length === 0) {
    fail("wakeflow-asset-source-type", "$/assets", "assets must be a non-empty array");
  }
  const ids = new Set();
  const sourcePaths = new Set();
  const assets = sourceManifest.assets.map((entry, index) => {
    const at = `$/assets/${index}`;
    const item = exactObject(entry, at, EXPECTED_ASSET_FIELDS);
    const id = nonEmptyString(item.id, `${at}/id`);
    if (!/^[a-z][a-z0-9]*(?:[.-][A-Za-z0-9]+)+$/u.test(id)) {
      fail("wakeflow-asset-source-id", `${at}/id`, "invalid logical asset id", { id });
    }
    if (ids.has(id)) fail("wakeflow-asset-source-duplicate", `${at}/id`, `duplicate asset id ${id}`);
    ids.add(id);
    const source = safeSourcePath(item.source, `${at}/source`);
    if (sourcePaths.has(source)) {
      fail("wakeflow-asset-source-duplicate", `${at}/source`, `duplicate source path ${source}`);
    }
    sourcePaths.add(source);
    const content = readCanonicalText(
      path.join(root, ...source.split("/")),
      `${at}/source`,
      ASSET_SOURCE_FILE_MAX_BYTES,
    );
    return {
      id,
      kind: nonEmptyString(item.kind, `${at}/kind`),
      owner: nonEmptyString(item.owner, `${at}/owner`),
      consumers: sortedUniqueStrings(item.consumers, `${at}/consumers`),
      source,
      input: normalizeInput(item.input, `${at}/input`),
      sha256: contentDigest(content),
      content,
    };
  });
  const sorted = [...assets].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (assets.some((entry, index) => entry.id !== sorted[index].id)) {
    fail("wakeflow-asset-source-order", "$/assets", "assets must be sorted by logical id");
  }
  const discovered = discoverSourceFiles(root);
  const expectedFiles = ["manifest.json", ...sorted.map((entry) => entry.source)].sort();
  const actualFiles = discovered.sort();
  if (
    actualFiles.length !== expectedFiles.length
    || actualFiles.some((entry, index) => entry !== expectedFiles[index])
  ) {
    fail("wakeflow-asset-source-inventory", "$/files", "source tree contains a missing or unregistered file", {
      expected: expectedFiles,
      actual: actualFiles,
    });
  }
  return sorted;
}

function sourceLedger(assets) {
  return assets.map(({ content: _content, ...entry }) => entry);
}

// manifest是source ledger，renderer是安装期typed input合同；构建时必须证明两者逐asset同源。
function assertRuntimeSourceContract(sources) {
  const expectedIds = Object.keys(WAKEFLOW_ASSET_CONTRACTS);
  if (
    sources.length !== expectedIds.length
    || sources.some((source, index) => source.id !== expectedIds[index])
  ) {
    fail("wakeflow-asset-source-runtime-contract", "$/assets", "source assets do not match runtime asset contracts");
  }
  for (const source of sources) {
    const contract = WAKEFLOW_ASSET_CONTRACTS[source.id];
    const sourceKeys = Object.keys(source.input);
    const contractKeys = Object.keys(contract.input);
    if (
      source.kind !== contract.kind
      || sourceKeys.length !== contractKeys.length
      || sourceKeys.some((key, index) => key !== contractKeys[index] || source.input[key] !== contract.input[key])
    ) {
      fail(
        "wakeflow-asset-source-runtime-contract",
        `$/assets/${source.id}`,
        "source kind or typed input does not match the runtime asset contract",
      );
    }
  }
}

/**
 * 从完整source ledger生成可变的plain bundle，并以运行时parser的同一合同执行反向验收。
 */
export function buildWakeflowAssetBundle(operation) {
  const { sourceRoot } = exactObject(operation, "$", ["sourceRoot"]);
  const sources = readWakeflowAssetSources({ sourceRoot });
  assertRuntimeSourceContract(sources);
  const assets = Object.fromEntries(sources.map(({ id, kind, sha256, content }) => [id, {
    kind,
    sha256,
    content,
  }]));
  const withoutDigest = {
    schemaVersion: WAKEFLOW_ASSET_BUNDLE_SCHEMA_VERSION,
    artifactKind: WAKEFLOW_ASSET_BUNDLE_KIND,
    source: WAKEFLOW_ASSET_SOURCE_LABEL,
    sourceDigest: canonicalJsonDigest({
      schemaVersion: WAKEFLOW_ASSET_SOURCE_VERSION,
      artifactKind: WAKEFLOW_ASSET_SOURCE_KIND,
      source: WAKEFLOW_ASSET_SOURCE_LABEL,
      assets: sourceLedger(sources),
    }),
    assets,
  };
  const bundle = {
    ...withoutDigest,
    bundleDigest: canonicalJsonDigest(withoutDigest),
  };
  // 用运行时loader的同一asset/token/digest合同反验，阻止构建成功、安装后必失败的产物。
  parseWakeflowAssetBundle(structuredClone(bundle));
  return bundle;
}

/**
 * 生成确定性pretty JSON字节；产物超过安装loader预算时在写盘前失败。
 */
export function buildWakeflowAssetBundleBytes(operation) {
  const { sourceRoot } = exactObject(operation, "$", ["sourceRoot"]);
  const bytes = Buffer.from(`${JSON.stringify(buildWakeflowAssetBundle({ sourceRoot }), null, 2)}\n`, "utf8");
  if (bytes.length > WAKEFLOW_ASSET_BUNDLE_MAX_BYTES) {
    fail(
      "wakeflow-asset-bundle-too-large",
      "$/bundle",
      `generated bundle exceeds the ${WAKEFLOW_ASSET_BUNDLE_MAX_BYTES} byte installed-loader limit`,
    );
  }
  return bytes;
}

// CLI只接受两个各至多一次的带值flag；缺值、重复和未知参数不得静默降级到默认目录。
function parseCliArguments(args) {
  const values = Object.create(null);
  const allowed = new Set(["--output", "--source-root"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument : argument.slice(0, equals);
    if (!allowed.has(name)) {
      fail("wakeflow-asset-cli-argument", "$/argv", `unknown argument ${argument}`);
    }
    if (Object.hasOwn(values, name)) {
      fail("wakeflow-asset-cli-argument", "$/argv", `duplicate argument ${name}`);
    }
    const value = equals === -1 ? args[index + 1] : argument.slice(equals + 1);
    if (equals === -1) index += 1;
    if (typeof value !== "string" || !value || value.startsWith("--") || value.includes("\0")) {
      fail("wakeflow-asset-cli-argument", "$/argv", `${name} requires one non-empty path value`);
    }
    values[name] = value;
  }
  return Object.freeze(values);
}

// 显式output可以位于任意调用方指定目录，但最终文件不得是链接/硬链接；同目录
// 临时文件经rename替换，避免writeFileSync沿已有inode改写其他路径的内容。
function writeCliOutput(output, bytes) {
  const file = path.resolve(output);
  const parent = path.dirname(file);
  let parentStat;
  try {
    parentStat = lstatSync(parent);
  } catch {
    fail("wakeflow-asset-cli-output", "$/output", "output parent directory is missing or unreadable");
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    fail("wakeflow-asset-cli-output", "$/output", "output parent must be one real directory");
  }
  try {
    const current = lstatSync(file, { bigint: true });
    if (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1n) {
      fail("wakeflow-asset-cli-output", "$/output", "output must be absent or one regular non-symlink single-link file");
    }
  } catch (cause) {
    if (cause instanceof WakeflowAssetBuildError) throw cause;
    if (cause?.code !== "ENOENT") {
      fail("wakeflow-asset-cli-output", "$/output", "output cannot be safely inspected");
    }
  }

  const temporary = path.join(parent, `.${path.basename(file)}.wakeflow-asset-${process.pid}`);
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      0o644,
    );
    writeFileSync(descriptor, bytes);
    fchmodSync(descriptor, 0o644);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch (cause) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    if (cause instanceof WakeflowAssetBuildError) throw cause;
    fail("wakeflow-asset-cli-output", "$/output", "output cannot be atomically written");
  }
  return file;
}

// 命令行入口复用纯builder；双宿主复制仍必须由sync-core执行。
function main() {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const args = parseCliArguments(process.argv.slice(2));
  const sourceRoot = path.resolve(args["--source-root"] ?? path.join(repoRoot, "core/template-sources"));
  const output = args["--output"] ?? null;
  const bytes = buildWakeflowAssetBundleBytes({ sourceRoot });
  if (output) {
    const written = writeCliOutput(output, bytes);
    console.log(JSON.stringify({ ok: true, output: written, bytes: bytes.length }));
  } else {
    const bundle = JSON.parse(bytes.toString("utf8"));
    console.log(JSON.stringify({
      ok: true,
      assets: Object.keys(bundle.assets).length,
      sourceDigest: bundle.sourceDigest,
      bundleDigest: bundle.bundleDigest,
      bytes: bytes.length,
    }, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: typeof error?.code === "string" ? error.code : "wakeflow-asset-build-failed",
        path: typeof error?.path === "string" ? error.path : "$",
      },
    }));
    process.exitCode = 1;
  }
}
