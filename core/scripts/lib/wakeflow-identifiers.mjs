import { randomUUID } from "node:crypto";

// 本模块拥有 durable typed ID 的词法、生成和跨类型 UUID 唯一性；它不决定实体生命周期或引用是否具有业务权限。

export const WAKEFLOW_ID_TYPES = Object.freeze([
  "archive",
  "confirmation",
  "demand",
  "delivery",
  "delivery-run",
  "dispatch-group",
  "dispatch-packet",
  "evidence",
  "pod",
  "pod-design-handoff",
  "pod-design-request",
  "program",
  "preservation",
  "repository",
  "requirement",
  "review-candidate",
  "surface",
  "target-result",
  "target-task",
  "task-package",
  "test-attempt",
  "test-card",
  "window",
]);

const TYPE_SET = new Set(WAKEFLOW_ID_TYPES);
const UUID_V4_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const WAKEFLOW_ID_RE = new RegExp(`^(${WAKEFLOW_ID_TYPES.join("|")})_(${UUID_V4_PATTERN})$`);
const IDENTIFIER_INDEXES = new WeakSet();

export class WakeflowIdentifierError extends Error {
  constructor(code, message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowIdentifierError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

function assertKnownType(type, path = "$") {
  if (!TYPE_SET.has(type)) {
    const actualType = typeof type;
    const display = actualType === "string" ? type : `<${actualType}>`;
    throw new WakeflowIdentifierError(
      "wakeflow-identifier-type-unknown",
      `unknown Wakeflow identifier type ${display}`,
      {
        path,
        details: {
          actualType,
          ...(actualType === "string" ? { type } : {}),
          allowedTypes: WAKEFLOW_ID_TYPES,
        },
      },
    );
  }
  return type;
}

function diagnosticPath(value) {
  return typeof value === "string" && value.length > 0 && !/[\r\n\0]/u.test(value) ? value : "$";
}

function failIndex(path, message, details = {}) {
  throw new WakeflowIdentifierError(
    "wakeflow-identifier-index-invalid",
    message,
    { path, details },
  );
}

// entries 是数据序列而不是可执行容器；只读取标准稠密数组自己的可枚举 data slot。
function passiveEntryArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    failIndex("$entries", "Wakeflow identifier index entries must be a standard array");
  }
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) {
      failIndex("$entries", "Wakeflow identifier index entries cannot carry additional properties");
    }
  }
  const entries = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      failIndex(`$entries/${index}`, "Wakeflow identifier index entries must be dense data slots");
    }
    entries.push(descriptor.value);
  }
  return Object.freeze(entries);
}

// 每个索引项只承载 id/type、诊断位置和领域值引用；领域值的冻结与生命周期仍归创建索引的领域 parser。
function passiveIndexEntry(value, index) {
  const fallbackPath = `$entries/${index}`;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    failIndex(fallbackPath, `Wakeflow identifier index entry at ${fallbackPath} must be a plain object`);
  }
  const allowed = new Set(["id", "type", "path", "value"]);
  const snapshot = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      failIndex(fallbackPath, "Wakeflow identifier index entry contains an unknown field");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      failIndex(`${fallbackPath}/${key}`, "Wakeflow identifier index entry fields must be enumerable data properties");
    }
    snapshot[key] = descriptor.value;
  }
  for (const required of ["id", "type", "value"]) {
    if (!Object.hasOwn(snapshot, required)) {
      failIndex(`${fallbackPath}/${required}`, `Wakeflow identifier index entry is missing ${required}`);
    }
  }
  if (
    Object.hasOwn(snapshot, "path")
    && (typeof snapshot.path !== "string" || !snapshot.path || /[\r\n\0]/u.test(snapshot.path))
  ) {
    failIndex(`${fallbackPath}/path`, "Wakeflow identifier index entry path must be a diagnostic string");
  }
  return Object.freeze({
    ...snapshot,
    path: Object.hasOwn(snapshot, "path") ? snapshot.path : fallbackPath,
  });
}

// 生成器是明确的依赖注入 seam；其结果仍必须是原始 lowercase UUID v4 字符串，不能触发对象强制转换。
export function generateWakeflowId(type, uuidFactory = randomUUID) {
  assertKnownType(type, "$type");
  if (typeof uuidFactory !== "function") {
    throw new WakeflowIdentifierError(
      "wakeflow-identifier-generator-invalid",
      "Wakeflow identifier UUID source must be a function",
      { path: "$uuidFactory" },
    );
  }
  const uuid = uuidFactory();
  if (typeof uuid !== "string") {
    throw new WakeflowIdentifierError(
      "wakeflow-identifier-generator-invalid",
      "Wakeflow identifier UUID source must return a string",
      { path: "$uuidFactory", details: { actualType: typeof uuid } },
    );
  }
  const value = `${type}_${uuid}`;
  return assertWakeflowId(value, type, "$generatedId");
}

// 拆解 typed ID 时只返回冻结的词法事实，不查找任何实体或状态。
export function parseWakeflowId(value, path = "$") {
  path = diagnosticPath(path);
  if (typeof value !== "string") {
    throw new WakeflowIdentifierError(
      "wakeflow-identifier-invalid",
      `Wakeflow identifier at ${path} must be a lowercase typed UUID v4 string`,
      { path, details: { valueType: typeof value } },
    );
  }
  const match = value.match(WAKEFLOW_ID_RE);
  if (!match) {
    throw new WakeflowIdentifierError(
      "wakeflow-identifier-invalid",
      `Wakeflow identifier at ${path} must match <${WAKEFLOW_ID_TYPES.join("|")}>_<lowercase UUID v4>`,
      { path, details: { value } },
    );
  }
  return Object.freeze({ type: match[1], uuid: match[2], value });
}

export function assertWakeflowId(value, expectedType = null, path = "$") {
  path = diagnosticPath(path);
  if (expectedType !== null) assertKnownType(expectedType, path);
  const parsed = parseWakeflowId(value, path);
  if (expectedType !== null && parsed.type !== expectedType) {
    throw new WakeflowIdentifierError(
      "wakeflow-identifier-type-mismatch",
      `Wakeflow identifier at ${path} has type ${parsed.type}; expected ${expectedType}`,
      { path, details: { value, actualType: parsed.type, expectedType } },
    );
  }
  return value;
}

export function createWakeflowIdIndex(entries = []) {
  entries = passiveEntryArray(entries);
  const records = new Map();
  const recordsByUuid = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = passiveIndexEntry(entries[index], index);
    const entryPath = entry.path;
    const type = assertKnownType(entry.type, entryPath);
    assertWakeflowId(entry.id, type, entryPath);
    const previous = records.get(entry.id);
    if (previous) {
      throw new WakeflowIdentifierError(
        "wakeflow-identifier-duplicate",
        `duplicate Wakeflow identifier ${entry.id} at ${entryPath}; first declared at ${previous.path}`,
        { path: entryPath, details: { id: entry.id, firstPath: previous.path } },
      );
    }
    const parsed = parseWakeflowId(entry.id, entryPath);
    const previousUuid = recordsByUuid.get(parsed.uuid);
    if (previousUuid) {
      throw new WakeflowIdentifierError(
        "wakeflow-identifier-uuid-collision",
        `Wakeflow identifier ${entry.id} at ${entryPath} reuses the UUID from ${previousUuid.id} at ${previousUuid.path}`,
        {
          path: entryPath,
          details: {
            id: entry.id,
            uuid: parsed.uuid,
            firstId: previousUuid.id,
            firstPath: previousUuid.path,
          },
        },
      );
    }
    records.set(entry.id, Object.freeze({
      id: entry.id,
      type,
      path: entryPath,
      value: entry.value,
    }));
    recordsByUuid.set(parsed.uuid, Object.freeze({ id: entry.id, path: entryPath }));
  }

  const identifierIndex = Object.freeze({
    size: records.size,
    has(id) {
      return records.has(id);
    },
    get(id) {
      return records.get(id)?.value;
    },
    record(id) {
      return records.get(id) ?? null;
    },
    ids() {
      return Object.freeze([...records.keys()]);
    },
  });
  IDENTIFIER_INDEXES.add(identifierIndex);
  return identifierIndex;
}

// 引用校验只接受本模块创建的封闭索引，避免调用任意 has/get getter 或伪造存在性。
export function assertWakeflowRef(value, expectedType, index, path = "$") {
  path = diagnosticPath(path);
  assertWakeflowId(value, expectedType, path);
  if (!index || (typeof index !== "object" && typeof index !== "function") || !IDENTIFIER_INDEXES.has(index)) {
    throw new WakeflowIdentifierError(
      "wakeflow-reference-index-invalid",
      "Wakeflow reference validation requires a typed identifier index",
      { path },
    );
  }
  if (!index.has(value)) {
    throw new WakeflowIdentifierError(
      "wakeflow-reference-missing",
      `Wakeflow reference at ${path} points to missing ${expectedType} ${value}`,
      { path, details: { value, expectedType } },
    );
  }
  return index.get(value);
}
