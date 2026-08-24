import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import path from "node:path";

import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";

/**
 * 安装资产bundle的唯一strict loader与纯模板替换器。
 *
 * 职责导航：
 * 1. 固定安装资产ID、token输入合同及bundle自摘要闭包。
 * 2. 从明确的插件根稳定、有界地读取唯一bundle文件，不回退到loose template。
 * 3. 把已验证的typed fragment逐token替换并返回内容摘要；不解释fragment的Markdown语义。
 * 4. 以私有brand区分“已经在组合边界完整验证并冻结”的bundle。
 *
 * 本模块不拥有模板源构建、领域投影选择、Markdown上下文转义、文件写入或宿主激活。
 */

export const WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH = "templates/wakeflow-asset-bundle.json";
export const WAKEFLOW_ASSET_BUNDLE_SCHEMA_VERSION = 2;
export const WAKEFLOW_ASSET_BUNDLE_KIND = "wakeflow-install-assets";
export const WAKEFLOW_ASSET_SOURCE_LABEL = "core/template-sources";
export const WAKEFLOW_ASSET_BUNDLE_MAX_BYTES = 1024 * 1024;

export const WAKEFLOW_ASSET_CONTRACTS = Object.freeze({
  "progress.demand.en": Object.freeze({
    kind: "projection-template",
    input: Object.freeze({
      authority: "string",
      completionDefinition: "string",
      currentState: "string",
      demand: "string",
      events: "string",
      goal: "string",
      projectionMarker: "string",
      source: "string",
      title: "string",
    }),
  }),
  "progress.demand.zh-CN": Object.freeze({
    kind: "projection-template",
    input: Object.freeze({
      authority: "string",
      completionDefinition: "string",
      currentState: "string",
      demand: "string",
      events: "string",
      goal: "string",
      projectionMarker: "string",
      source: "string",
      title: "string",
    }),
  }),
});

const EXPECTED_ASSET_IDS = Object.freeze(Object.keys(WAKEFLOW_ASSET_CONTRACTS));
const parsedBundles = new WeakSet();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class WakeflowTemplateError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowTemplateError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

function fail(code, errorPath, message, details = {}) {
  throw new WakeflowTemplateError(code, `${message} at ${errorPath}`, {
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
  if (!isPlainObject(value)) fail("wakeflow-template-type", at, "expected an object");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail("wakeflow-template-unknown", at, "symbol-keyed fields are not allowed");
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) {
      fail("wakeflow-template-unknown", `${at}/${key}`, `non-enumerable field ${key} is not allowed`);
    }
    if (!Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-template-type", `${at}/${key}`, `accessor field ${key} is not allowed`);
    }
  }
  const allowed = new Set(fields);
  const unknown = ownKeys.find((key) => !allowed.has(key));
  if (unknown) fail("wakeflow-template-unknown", `${at}/${unknown}`, `unknown field ${unknown}`);
  for (const field of fields) {
    if (!ownKeys.includes(field)) {
      fail("wakeflow-template-missing", `${at}/${field}`, `missing field ${field}`);
    }
  }
  const snapshot = Object.create(null);
  for (const field of fields) {
    snapshot[field] = Object.getOwnPropertyDescriptor(value, field).value;
  }
  return Object.freeze(snapshot);
}

function contentDigest(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

function sameOrderedStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateAsset(id, value) {
  const at = `$/assets/${id}`;
  const asset = exactObject(value, at, ["kind", "sha256", "content"]);
  const contract = WAKEFLOW_ASSET_CONTRACTS[id];
  if (!contract) fail("wakeflow-template-asset-id", at, `unknown asset ${id}`);
  if (asset.kind !== contract.kind) {
    fail("wakeflow-template-contract", `${at}/kind`, "kind does not match the installed contract");
  }
  if (
    typeof asset.content !== "string"
    || !asset.content
    || asset.content.includes("\r")
    || !asset.content.endsWith("\n")
    || asset.content.endsWith("\n\n")
  ) {
    fail("wakeflow-template-content", `${at}/content`, "content must be canonical LF text with exactly one trailing newline");
  }
  if (asset.sha256 !== contentDigest(asset.content)) {
    fail("wakeflow-template-entry-digest", `${at}/sha256`, "asset content digest mismatch");
  }
  const tokens = [];
  const contentWithoutValidTokens = asset.content.replace(
    /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu,
    (_match, token) => {
      tokens.push(token);
      return "";
    },
  );
  if (contentWithoutValidTokens.includes("{{") || contentWithoutValidTokens.includes("}}")) {
    fail(
      "wakeflow-template-token-contract",
      `${at}/content`,
      "template contains a malformed or unsupported token marker",
    );
  }
  const uniqueTokens = [...new Set(tokens)].sort();
  const expectedTokens = Object.keys(contract.input).sort();
  if (!sameOrderedStrings(uniqueTokens, expectedTokens)) {
    fail("wakeflow-template-token-contract", `${at}/content`, "template tokens do not match the typed input contract", {
      tokens: uniqueTokens,
      expectedTokens,
    });
  }
  return asset;
}

// 先按descriptor读取assets映射，确保选择entry之前不会执行调用方getter。
function validateAssets(value) {
  if (!isPlainObject(value)) fail("wakeflow-template-type", "$/assets", "assets must be an object");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("wakeflow-template-asset-set", "$/assets", "symbol-keyed assets are not allowed");
  }
  if (!sameOrderedStrings(keys, EXPECTED_ASSET_IDS)) {
    fail("wakeflow-template-asset-set", "$/assets", "asset set or ordering does not match the installed contract", {
      expected: EXPECTED_ASSET_IDS,
      actual: keys,
    });
  }
  const assets = Object.create(null);
  for (const id of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, id);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-template-asset-set", `$/assets/${id}`, `asset ${id} must be an enumerable data property`);
    }
    assets[id] = validateAsset(id, descriptor.value);
  }
  return Object.freeze(assets);
}

/**
 * 校验完整bundle、重算entry/bundle摘要，并冻结及标记调用方提供的被动数据树。
 */
export function parseWakeflowAssetBundle(value) {
  const bundle = exactObject(value, "$", ["schemaVersion", "artifactKind", "source", "sourceDigest", "assets", "bundleDigest"]);
  if (bundle.schemaVersion !== WAKEFLOW_ASSET_BUNDLE_SCHEMA_VERSION) {
    fail("wakeflow-template-version", "$/schemaVersion", `expected ${WAKEFLOW_ASSET_BUNDLE_SCHEMA_VERSION}`);
  }
  if (bundle.artifactKind !== WAKEFLOW_ASSET_BUNDLE_KIND) {
    fail("wakeflow-template-kind", "$/artifactKind", `expected ${WAKEFLOW_ASSET_BUNDLE_KIND}`);
  }
  if (bundle.source !== WAKEFLOW_ASSET_SOURCE_LABEL) {
    fail("wakeflow-template-source", "$/source", `expected ${WAKEFLOW_ASSET_SOURCE_LABEL}`);
  }
  const assets = validateAssets(bundle.assets);
  if (!/^sha256:[0-9a-f]{64}$/u.test(bundle.sourceDigest)) {
    fail("wakeflow-template-source-digest", "$/sourceDigest", "source digest must be a canonical SHA-256 value");
  }
  const withoutDigest = {
    schemaVersion: bundle.schemaVersion,
    artifactKind: bundle.artifactKind,
    source: bundle.source,
    sourceDigest: bundle.sourceDigest,
    assets,
  };
  if (bundle.bundleDigest !== canonicalJsonDigest(withoutDigest)) {
    fail("wakeflow-template-bundle-digest", "$/bundleDigest", "bundle digest mismatch");
  }
  deepFreeze(value);
  parsedBundles.add(value);
  return value;
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

// bundle只有数KiB；固定1 MiB硬预算可在分配前拒绝错误安装物或增长竞态。
function readInstalledBundle(file) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      fail("wakeflow-template-bundle-missing", "$/bundle", `${WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH} is missing`);
    }
    fail("wakeflow-template-bundle-unsafe", "$/bundle", "asset bundle cannot be safely inspected");
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    fail("wakeflow-template-bundle-unsafe", "$/bundle", "asset bundle must be one regular single-link file");
  }
  if (before.size < 1n || before.size > BigInt(WAKEFLOW_ASSET_BUNDLE_MAX_BYTES)) {
    fail(
      "wakeflow-template-bundle-too-large",
      "$/bundle",
      `asset bundle must be between 1 and ${WAKEFLOW_ASSET_BUNDLE_MAX_BYTES} bytes`,
    );
  }

  let descriptor;
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      fail("wakeflow-template-bundle-unsafe", "$/bundle", "asset bundle changed before it was opened");
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
      fail("wakeflow-template-bundle-too-large", "$/bundle", "asset bundle grew while it was read");
    }
    if (offset !== expectedBytes) {
      fail("wakeflow-template-bundle-unsafe", "$/bundle", "asset bundle changed while it was read");
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    let afterPath;
    try {
      afterPath = lstatSync(file, { bigint: true });
    } catch {
      fail("wakeflow-template-bundle-unsafe", "$/bundle", "asset bundle path changed while it was read");
    }
    if (!sameFileIdentity(opened, afterDescriptor) || !sameFileIdentity(opened, afterPath)) {
      fail("wakeflow-template-bundle-unsafe", "$/bundle", "asset bundle identity changed while it was read");
    }
    try {
      return utf8Decoder.decode(bytes.subarray(0, offset));
    } catch {
      fail("wakeflow-template-bundle-json", "$/bundle", "asset bundle is not canonical UTF-8 JSON");
    }
  } catch (cause) {
    if (cause instanceof WakeflowTemplateError) throw cause;
    fail("wakeflow-template-bundle-unsafe", "$/bundle", "asset bundle cannot be safely read");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return null;
}

/**
 * 从插件根读取唯一安装bundle；拒绝symlink、hardlink、非稳定身份、超限和非法UTF-8。
 */
export function loadWakeflowAssetBundle(operation) {
  let input;
  try {
    input = exactObject(operation, "$", ["wakeflowRoot"]);
  } catch (cause) {
    if (cause instanceof WakeflowTemplateError) {
      fail("wakeflow-template-root", "$/wakeflowRoot", "loader input must contain one passive wakeflowRoot field");
    }
    throw cause;
  }
  const { wakeflowRoot } = input;
  if (typeof wakeflowRoot !== "string" || !wakeflowRoot.trim()) {
    fail("wakeflow-template-root", "$/wakeflowRoot", "wakeflowRoot must be a non-empty string");
  }
  if (wakeflowRoot.includes("\0")) {
    fail("wakeflow-template-root", "$/wakeflowRoot", "wakeflowRoot cannot contain NUL");
  }
  const file = path.join(path.resolve(wakeflowRoot), WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH);
  try {
    return parseWakeflowAssetBundle(JSON.parse(readInstalledBundle(file)));
  } catch (error) {
    if (error instanceof WakeflowTemplateError) throw error;
    fail("wakeflow-template-bundle-json", "$/bundle", `asset bundle is invalid JSON: ${error.message}`);
  }
  return null;
}

export function assertParsedWakeflowAssetBundle(bundle) {
  if (!parsedBundles.has(bundle)) {
    fail(
      "wakeflow-template-bundle-unparsed",
      "$/bundle",
      "asset bundle must be validated and frozen at the composition boundary before pure rendering",
    );
  }
  return bundle;
}

function validateInput(input, contract, assetId) {
  const at = `$/input`;
  if (!isPlainObject(input)) fail("wakeflow-template-input", at, "input must be an object");
  const expected = Object.keys(contract.input);
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail("wakeflow-template-input-unknown", at, "symbol-keyed inputs are not allowed", { assetId });
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable) {
      fail("wakeflow-template-input-unknown", `${at}/${key}`, `non-enumerable input ${key} is not allowed`, { assetId });
    }
    if (!Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-template-input-type", `${at}/${key}`, `accessor input ${key} is not allowed`, { assetId });
    }
  }
  const actual = ownKeys;
  const unknown = actual.find((key) => !expected.includes(key));
  if (unknown) fail("wakeflow-template-input-unknown", `${at}/${unknown}`, `unknown input ${unknown}`, { assetId });
  const missing = expected.find((key) => !Object.hasOwn(input, key));
  if (missing) fail("wakeflow-template-input-missing", `${at}/${missing}`, `missing input ${missing}`, { assetId });
  const snapshot = Object.create(null);
  for (const key of expected) {
    const expectedType = contract.input[key];
    const value = Object.getOwnPropertyDescriptor(input, key).value;
    const valid = expectedType === "string"
      ? typeof value === "string" && value.length > 0
      : Number.isSafeInteger(value) && value >= 1;
    if (!valid) {
      fail("wakeflow-template-input-type", `${at}/${key}`, `expected ${expectedType}`, { assetId });
    }
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}

/**
 * 按一个已安装asset的typed token合同执行一次纯文本替换。
 */
export function renderWakeflowAsset(operation) {
  const { bundle, assetId, input } = exactObject(operation, "$", ["bundle", "assetId", "input"]);
  if (!parsedBundles.has(bundle)) parseWakeflowAssetBundle(bundle);
  if (typeof assetId !== "string") fail("wakeflow-template-asset-id", "$/assetId", "assetId must be a string");
  const contract = WAKEFLOW_ASSET_CONTRACTS[assetId];
  if (!contract) fail("wakeflow-template-asset-id", "$/assetId", `unknown asset ${assetId}`);
  const values = validateInput(input, contract, assetId);
  const content = bundle.assets[assetId].content.replace(
    /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu,
    (_match, key) => values[key],
  );
  return Object.freeze({
    assetId,
    content,
    sha256: contentDigest(content),
    sourceDigest: bundle.assets[assetId].sha256,
    bundleDigest: bundle.bundleDigest,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}
