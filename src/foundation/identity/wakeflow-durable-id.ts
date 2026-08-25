import {
  WAKEFLOW_DURABLE_ID_KINDS,
  type WakeflowDurableIdKind,
} from "../../contracts/generated/foundation/wakeflow-durable-id-kind.generated.js";
import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4,
} from "./uuid-v4.js";

/**
 * Wakeflow Foundation / Identity：持久类型化身份。
 *
 * 本文件消费 JSON Schema 单向生成的 durable kind 词汇，并拥有
 * `<kind>_<lowercase UUIDv4>` 的生成、解析和 TypeScript 品牌合同。它只返回词法
 * 事实，不查找实体、状态或文件，也不判断引用权限和集合级完整 ID 唯一性。
 *
 * binding、lease、locator、Pod operation、workspace mutation 与临时身份具有
 * 不同生命周期和 owner，不会为了共享字符串外形被并入本 durable 词汇。
 */

/** 对外转交 Schema 派生词汇；本模块不保存第二份 kind 清单。 */
export { WAKEFLOW_DURABLE_ID_KINDS };
export type { WakeflowDurableIdKind };

const WAKEFLOW_DURABLE_ID_KIND_SET: ReadonlySet<string> =
  new Set(WAKEFLOW_DURABLE_ID_KINDS);

declare const WAKEFLOW_DURABLE_ID_BRAND: unique symbol;

/**
 * 已生成或严格解析的 Wakeflow 持久身份。
 *
 * 泛型参数保留 kind；例如 program ID 不能赋给 window ID。模板字符串类型让
 * 编辑器同时保留可读的 `<kind>_<uuid>` 外形，品牌阻止普通 string 绕过解析。
 */
export type WakeflowDurableId<
  K extends WakeflowDurableIdKind = WakeflowDurableIdKind,
> = `${K}_${string}` & {
  readonly [WAKEFLOW_DURABLE_ID_BRAND]: K;
};

/**
 * 一个持久身份的冻结词法事实。
 *
 * 条件类型让 kind 联合分配为判别联合；检查 `kind` 后，`value` 会同步收窄为
 * 对应的 WakeflowDurableId，而 uuid 始终保留底层 UuidV4 品牌。
 */
export type ParsedWakeflowDurableId<
  K extends WakeflowDurableIdKind = WakeflowDurableIdKind,
> = K extends WakeflowDurableIdKind
  ? Readonly<{
      kind: K;
      uuid: UuidV4;
      value: WakeflowDurableId<K>;
    }>
  : never;

/** Wakeflow 持久身份失败的稳定分类。 */
export type WakeflowDurableIdErrorReason =
  | "format"
  | "kind-unknown"
  | "uuid-format"
  | "kind-mismatch";

const ERROR_MESSAGES = {
  "format": "Wakeflow durable ID must match <known kind>_<canonical lowercase UUID v4>.",
  "kind-unknown": "Wakeflow durable ID kind is not part of the closed durable identity vocabulary.",
  "uuid-format": "Wakeflow durable ID contains an invalid UUID v4 component.",
  "kind-mismatch": "Wakeflow durable ID kind does not match the expected kind.",
} as const satisfies Readonly<Record<WakeflowDurableIdErrorReason, string>>;

/**
 * Wakeflow 持久身份词法失败的稳定错误。
 *
 * 错误不回显 ID、UUID 或未知 kind。底层随机源失败仍保持 UuidV4Error，不会被
 * 伪装成本层的格式错误。
 */
export class WakeflowDurableIdError extends Error {
  override readonly name = "WakeflowDurableIdError";
  readonly code = "wakeflow-durable-id" as const;
  readonly reason: WakeflowDurableIdErrorReason;
  readonly path: string;

  constructor(reason: WakeflowDurableIdErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(
  reason: WakeflowDurableIdErrorReason,
  path: string,
): never {
  throw new WakeflowDurableIdError(reason, path);
}

function isWakeflowDurableIdKind(
  value: unknown,
): value is WakeflowDurableIdKind {
  return typeof value === "string"
    && WAKEFLOW_DURABLE_ID_KIND_SET.has(value);
}

function parseWakeflowDurableIdKind(
  value: unknown,
  path: string,
): WakeflowDurableIdKind {
  if (!isWakeflowDurableIdKind(value)) fail("kind-unknown", path);
  return value;
}

function parseUuidComponent(value: unknown, path: string): UuidV4 {
  try {
    return parseUuidV4(value, path);
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("uuid-format", path);
    throw error;
  }
}

function parseDurableId(
  value: unknown,
  path: string,
): ParsedWakeflowDurableId {
  if (typeof value !== "string") fail("format", path);

  const separatorIndex = value.indexOf("_");
  if (
    separatorIndex <= 0
    || separatorIndex !== value.lastIndexOf("_")
  ) {
    fail("format", path);
  }

  const kind = parseWakeflowDurableIdKind(
    value.slice(0, separatorIndex),
    path,
  );
  const uuid = parseUuidComponent(value.slice(separatorIndex + 1), path);
  const typedValue = value as WakeflowDurableId<typeof kind>;

  // 记录只携带已验证的字符串事实；冻结避免调用方改写 kind/value 的关联。
  return Object.freeze({
    kind,
    uuid,
    value: typedValue,
  }) as ParsedWakeflowDurableId;
}

/**
 * 创建指定 kind 的 Wakeflow 持久身份。
 *
 * kind 会在生成随机数前完成运行时复验。省略 uuid 时使用 uuid-v4 的 Node.js
 * 随机源；确定性调用应显式传入已经由 createUuidV4 或 parseUuidV4 授予品牌的
 * UuidV4，不在本层重复暴露 uuidFactory。
 */
export function createWakeflowDurableId<
  K extends WakeflowDurableIdKind,
>(
  kind: K,
  uuid?: UuidV4,
): WakeflowDurableId<K> {
  const admittedKind = parseWakeflowDurableIdKind(kind, "$kind");
  const admittedUuid = uuid === undefined
    ? createUuidV4()
    : parseUuidComponent(uuid, "$uuid");

  return `${admittedKind}_${admittedUuid}` as WakeflowDurableId<K>;
}

/**
 * 解析任意已知 kind 的 Wakeflow 持久身份，返回冻结的判别词法事实。
 *
 * 本函数不执行字符串强制转换，也不会把 binding、lease 或 operation ID 当作
 * 未知 durable kind 的兼容别名。
 */
export function parseWakeflowDurableId(
  value: unknown,
  errorPath?: string,
): ParsedWakeflowDurableId {
  return parseDurableId(value, normalizeErrorPath(errorPath));
}

/**
 * 解析并收窄为调用方要求的唯一 kind，直接返回对应品牌字符串。
 *
 * 这是 record parser 最常用的入口；kind 不一致时不会返回宽泛 ID，也不查找
 * 目标实体是否存在。
 */
export function parseWakeflowDurableIdOfKind<
  K extends WakeflowDurableIdKind,
>(
  value: unknown,
  expectedKind: K,
  errorPath?: string,
): WakeflowDurableId<K> {
  const path = normalizeErrorPath(errorPath);
  const admittedExpectedKind = parseWakeflowDurableIdKind(
    expectedKind,
    "$expectedKind",
  );
  const parsed = parseDurableId(value, path);
  if (parsed.kind !== admittedExpectedKind) fail("kind-mismatch", path);

  return parsed.value as WakeflowDurableId<K>;
}
