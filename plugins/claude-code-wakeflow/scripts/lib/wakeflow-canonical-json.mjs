import { createHash } from "node:crypto";

// 本模块只把无行为的 JSON 数据规范化为稳定字节与摘要；字段语义、记录容量和业务授权仍由调用方拥有。
// 规范化会拒绝 accessor、隐藏字段、Symbol、稀疏/扩张数组、外来原型、循环和过深结构，避免摘要忽略潜在 authority。

const MAX_CANONICAL_DEPTH = 128;

export class WakeflowCanonicalJsonError extends Error {
  constructor(message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowCanonicalJsonError";
    this.code = "wakeflow-canonical-json-domain";
    this.path = path;
    this.details = details;
  }
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function reject(at, message, details = {}) {
  throw new WakeflowCanonicalJsonError(`${message} at ${at}`, { path: at, details });
}

function dataPropertyValue(value, key, at) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable) {
    reject(at, "canonical JSON cannot ignore a non-enumerable property");
  }
  if (!Object.hasOwn(descriptor, "value")) {
    reject(at, "canonical JSON cannot evaluate an accessor property");
  }
  return descriptor.value;
}

// 直接生成 JSON 文本而不把规范化树再次交给 JSON.stringify；后者会查找继承的 toJSON 并执行外部行为。
function canonicalValue(value, at = "$", ancestors = new Set(), depth = 0) {
  if (depth > MAX_CANONICAL_DEPTH) {
    reject(at, "canonical JSON exceeds the structural depth limit", {
      maximumDepth: MAX_CANONICAL_DEPTH,
    });
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(at, "canonical JSON requires a finite number", { value });
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      reject(at, "canonical JSON requires a standard array prototype");
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string") {
        reject(at, "canonical JSON cannot ignore a symbol-keyed array property");
      }
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        reject(`${at}/${pointerSegment(key)}`, "canonical JSON cannot ignore an additional array property");
      }
      dataPropertyValue(value, key, `${at}/${index}`);
    }
    if (ancestors.has(value)) reject(at, "canonical JSON cannot contain a cycle");
    ancestors.add(value);
    const normalized = [];
    for (let index = 0; index < value.length; index += 1) {
      const childPath = `${at}/${index}`;
      if (!Object.hasOwn(value, index)) reject(childPath, "canonical JSON cannot contain a sparse array slot");
      normalized.push(canonicalValue(
        dataPropertyValue(value, String(index), childPath),
        childPath,
        ancestors,
        depth + 1,
      ));
    }
    ancestors.delete(value);
    return `[${normalized.join(",")}]`;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      // 拒绝外来原型时不能读取 value.constructor；该诊断本身也必须保持无行为。
      reject(at, "canonical JSON requires a plain object");
    }
    const keys = Reflect.ownKeys(value).map((key) => {
      if (typeof key !== "string") reject(at, "canonical JSON cannot ignore symbol-keyed properties");
      const childPath = `${at}/${pointerSegment(key)}`;
      return [key, dataPropertyValue(value, key, childPath)];
    });
    if (ancestors.has(value)) reject(at, "canonical JSON cannot contain a cycle");
    ancestors.add(value);
    const normalized = keys
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => (
        `${JSON.stringify(key)}:${canonicalValue(child, `${at}/${pointerSegment(key)}`, ancestors, depth + 1)}`
      ));
    ancestors.delete(value);
    return `{${normalized.join(",")}}`;
  }
  reject(at, `canonical JSON cannot represent ${typeof value}`, { actualType: typeof value });
}

export function canonicalJson(value) {
  return canonicalValue(value);
}

// 返回与 canonicalJson 完全同源的 UTF-8 字节，不接受调用方自定义编码或 pretty-print 选项。
export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function canonicalJsonDigestHex(value) {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

export function canonicalJsonDigest(value) {
  return `sha256:${canonicalJsonDigestHex(value)}`;
}
