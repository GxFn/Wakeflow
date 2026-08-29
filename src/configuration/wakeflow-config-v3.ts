import {
  WAKEFLOW_CONFIG_V3_SCHEMA,
  type ControllerWindow as ControllerWindowWire,
  type DesignWindow as DesignWindowWire,
  type ExternalOwnedSurface as ExternalOwnedSurfaceWire,
  type Governance as GovernanceWire,
  type Hosts as HostsWire,
  type ProductWindow as ProductWindowWire,
  type Program as ProgramWire,
  type Presentation as PresentationWire,
  type Repository as RepositoryWire,
  type Storage as StorageWire,
  type TestWindow as TestWindowWire,
  type WakeflowConfigV3 as WakeflowConfigV3Wire,
  type WakeflowManagedSurface as WakeflowManagedSurfaceWire,
} from "../contracts/generated/configuration/wakeflow-config-v3.generated.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../foundation/data/json-value.js";
import {
  parseWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../foundation/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../foundation/schema/runtime-json-schema.js";

/**
 * Wakeflow Configuration：公开 v3 配置的 Schema 准入与跨字段领域模型。
 *
 * JSON Schema 2020-12 与 Ajv 严格校验器负责限制字段集合、值域、基数和词法。本模块
 * 只补充 Schema 无法表达的类型化标识全局冲突、实体引用、能力匹配、每个 Repository
 * 的 Product 职责所有者和重复残留路径。输入先转换为无副作用、与源容器解除引用关系
 * 并递归冻结的 JSON 树，因此校验器不会执行访问器、代理陷阱或自定义行为。
 *
 * 本层不读取文件、不解析工作区位置的物理状态、不缓存当前配置，也不注入宿主
 * 默认值。Config 权威快照负责组合配置文件字节和物理根目录权威事实；
 * 写入和比较并交换仍属于后续 Config 职责所有者。
 */

export const WAKEFLOW_CONFIG_V3_SCHEMA_ID =
  "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json" as const;
export const WAKEFLOW_CONFIG_V3_KIND = "WakeflowConfig" as const;
export const WAKEFLOW_CONFIG_V3_VERSION = 3 as const;
export const WAKEFLOW_ACTIVE_ROOT = ".wakeflow-active" as const;
export const WAKEFLOW_LOCAL_ROOT = ".wakeflow-local" as const;
export const WAKEFLOW_PRESENTATION_LANGUAGES = Object.freeze([
  "en",
  "zh-Hans",
] as const);
export type WakeflowPresentationLanguage =
  (typeof WAKEFLOW_PRESENTATION_LANGUAGES)[number];

/**
 * Fresh Config producer 在用户未选择语言时写入的显式值。
 * Parser 不会为缺失字段注入默认值，持久文档始终保存唯一语言权威。
 */
export const WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE:
  WakeflowPresentationLanguage = "en";

declare const CONFIG_PLACEMENT_BRAND: unique symbol;

/** 已通过配置位置词法和 Unicode 约束的相对路径。 */
export type WakeflowConfigPlacement = string & {
  readonly [CONFIG_PLACEMENT_BRAND]: "WakeflowConfigPlacement";
};

type DeepReadonly<Value> =
  Value extends string | number | boolean | null | undefined
    ? Value
    : Value extends readonly (infer Entry)[]
      ? readonly DeepReadonly<Entry>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

export type WakeflowConfigProgram = DeepReadonly<
  Omit<ProgramWire, "programId"> & {
    readonly programId: WakeflowDurableId<"program">;
  }
>;

export type WakeflowConfigPresentation = DeepReadonly<
  Omit<PresentationWire, "language"> & {
    readonly language: WakeflowPresentationLanguage;
  }
>;

export type WakeflowConfigRepository = DeepReadonly<
  Omit<RepositoryWire, "path" | "repositoryId"> & {
    readonly path: WakeflowConfigPlacement;
    readonly repositoryId: WakeflowDurableId<"repository">;
  }
>;

export type WakeflowManagedSupportSurface = DeepReadonly<
  Omit<WakeflowManagedSurfaceWire, "path" | "surfaceId"> & {
    readonly path: WakeflowConfigPlacement;
    readonly surfaceId: WakeflowDurableId<"surface">;
  }
>;

export type WakeflowExternalSupportSurface = DeepReadonly<
  Omit<ExternalOwnedSurfaceWire, "path" | "surfaceId"> & {
    readonly path: WakeflowConfigPlacement;
    readonly surfaceId: WakeflowDurableId<"surface">;
  }
>;

export type WakeflowConfigSupportSurface =
  | WakeflowManagedSupportSurface
  | WakeflowExternalSupportSurface;

export type WakeflowControllerWindow = DeepReadonly<
  Omit<ControllerWindowWire, "windowId"> & {
    readonly windowId: WakeflowDurableId<"window">;
  }
>;

export type WakeflowDesignWindow = DeepReadonly<
  Omit<DesignWindowWire, "root" | "windowId"> & {
    readonly root: {
      readonly kind: "support-surface";
      readonly surfaceId: WakeflowDurableId<"surface">;
    };
    readonly windowId: WakeflowDurableId<"window">;
  }
>;

export type WakeflowTestWindow = DeepReadonly<
  Omit<TestWindowWire, "root" | "windowId"> & {
    readonly root: {
      readonly kind: "support-surface";
      readonly surfaceId: WakeflowDurableId<"surface">;
    };
    readonly windowId: WakeflowDurableId<"window">;
  }
>;

export type WakeflowProductWindow = DeepReadonly<
  Omit<ProductWindowWire, "root" | "windowId"> & {
    readonly root: {
      readonly kind: "repository";
      readonly repositoryId: WakeflowDurableId<"repository">;
    };
    readonly windowId: WakeflowDurableId<"window">;
  }
>;

export type WakeflowConfigWindow =
  | WakeflowControllerWindow
  | WakeflowDesignWindow
  | WakeflowTestWindow
  | WakeflowProductWindow;

export type WakeflowConfigStorage = DeepReadonly<
  Omit<StorageWire, "ledgerRoot"> & {
    readonly ledgerRoot: WakeflowConfigPlacement;
  }
>;

/** Schema、类型化引用与跨实体关系均已验证的递归冻结配置模型。 */
export type WakeflowConfigV3Model = DeepReadonly<
  Omit<
    WakeflowConfigV3Wire,
    | "governance"
    | "hosts"
    | "presentation"
    | "program"
    | "storage"
    | "topology"
  > & {
    readonly program: WakeflowConfigProgram;
    readonly presentation: WakeflowConfigPresentation;
    readonly topology: {
      readonly repositories: readonly [
        WakeflowConfigRepository,
        ...WakeflowConfigRepository[],
      ];
      readonly supportSurfaces: readonly [
        WakeflowConfigSupportSurface,
        WakeflowConfigSupportSurface,
      ];
      readonly windows: readonly [
        WakeflowConfigWindow,
        WakeflowConfigWindow,
        WakeflowConfigWindow,
        WakeflowConfigWindow,
        ...WakeflowConfigWindow[],
      ];
    };
    readonly storage: WakeflowConfigStorage;
    readonly governance: DeepReadonly<GovernanceWire>;
    readonly hosts: DeepReadonly<HostsWire>;
  }
>;

export interface WakeflowConfigV3Indexes {
  readonly repositoryById: Readonly<Record<
    WakeflowDurableId<"repository">,
    WakeflowConfigRepository
  >>;
  readonly surfaceById: Readonly<Record<
    WakeflowDurableId<"surface">,
    WakeflowConfigSupportSurface
  >>;
  readonly windowById: Readonly<Record<
    WakeflowDurableId<"window">,
    WakeflowConfigWindow
  >>;
  readonly windowsByRepositoryId: Readonly<Record<
    WakeflowDurableId<"repository">,
    readonly WakeflowProductWindow[]
  >>;
  readonly controllerWindow: WakeflowControllerWindow;
  readonly designWindow: WakeflowDesignWindow;
  readonly testWindow: WakeflowTestWindow;
  readonly productWindows: readonly WakeflowProductWindow[];
}

export type WakeflowConfigV3ErrorReason =
  | "json-value"
  | "schema"
  | "identifier"
  | "identifier-collision"
  | "reference"
  | "topology"
  | "placement";

const ERROR_MESSAGES = {
  "json-value": "Wakeflow config input is not passive JSON data.",
  "schema": "Wakeflow config does not satisfy the public v3 Schema.",
  "identifier": "Wakeflow config contains an invalid typed identifier.",
  "identifier-collision": "Wakeflow config durable identifiers collide.",
  "reference": "Wakeflow config contains an unresolved typed reference.",
  "topology": "Wakeflow config topology relationships are inconsistent.",
  "placement": "Wakeflow config contains a non-canonical placement.",
} as const satisfies Readonly<Record<WakeflowConfigV3ErrorReason, string>>;

/** 配置内存模型失败的稳定、脱敏错误。 */
export class WakeflowConfigV3Error extends Error {
  override readonly name = "WakeflowConfigV3Error";
  readonly code = "wakeflow-config-v3" as const;
  readonly reason: WakeflowConfigV3ErrorReason;
  readonly path: string;

  constructor(reason: WakeflowConfigV3ErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function fail(reason: WakeflowConfigV3ErrorReason, path: string): never {
  throw new WakeflowConfigV3Error(reason, path);
}

const validateWireConfig = createRuntimeJsonSchemaValidator<WakeflowConfigV3Wire>(
  WAKEFLOW_CONFIG_V3_SCHEMA,
);

function parsePlacement(
  value: string,
  path: string,
  childOnly = false,
): WakeflowConfigPlacement {
  if (
    !value.isWellFormed()
    || value.normalize("NFC") !== value
    || CONTROL_PATTERN.test(value)
  ) {
    fail("placement", path);
  }
  const segments = value.split("/");
  let parentSegments = 0;
  while (segments[parentSegments] === "..") parentSegments += 1;
  if (childOnly && parentSegments > 0) fail("placement", path);
  if (
    parentSegments === segments.length
    || segments.slice(parentSegments).some(
      (segment) => segment.length === 0
        || segment === "."
        || segment === ".."
        || segment.trim() !== segment,
    )
  ) {
    fail("placement", path);
  }
  return value as WakeflowConfigPlacement;
}

/** 将单个相对位置值准入为 Config 使用的规范 placement；不检查物理存在性。 */
export function parseWakeflowConfigPlacement(
  value: unknown,
  path = "$placement",
): WakeflowConfigPlacement {
  if (typeof value !== "string") fail("placement", path);
  return parsePlacement(value, path);
}

function parseIdentity<K extends "program" | "repository" | "surface" | "window">(
  value: string,
  kind: K,
  path: string,
): WakeflowDurableId<K> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function registerIdentity(
  value: string,
  kind: "program" | "repository" | "surface" | "window",
  path: string,
  uuidOwners: Map<string, string>,
): void {
  parseIdentity(value, kind, path);
  let uuid: string;
  try {
    uuid = parseWakeflowDurableId(value, path).uuid;
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
  if (uuidOwners.has(uuid)) fail("identifier-collision", path);
  uuidOwners.set(uuid, path);
}

function validatePlacements(model: WakeflowConfigV3Wire): void {
  parsePlacement(model.storage.ledgerRoot, "$/storage/ledgerRoot");
  for (const [index, repository] of model.topology.repositories.entries()) {
    parsePlacement(
      repository.path,
      `$/topology/repositories/${index}/path`,
    );
    for (const [residueIndex, residue] of
      (repository.validation?.residueExceptions ?? []).entries()) {
      parsePlacement(
        residue.path,
        `$/topology/repositories/${index}/validation/residueExceptions/${residueIndex}/path`,
        true,
      );
    }
  }
  for (const [index, surface] of model.topology.supportSurfaces.entries()) {
    parsePlacement(
      surface.path,
      `$/topology/supportSurfaces/${index}/path`,
    );
  }
}

function validateResidueUniqueness(model: WakeflowConfigV3Wire): void {
  for (const [repositoryIndex, repository] of
    model.topology.repositories.entries()) {
    const seen = new Set<string>();
    for (const [residueIndex, residue] of
      (repository.validation?.residueExceptions ?? []).entries()) {
      if (seen.has(residue.path)) {
        fail(
          "topology",
          `$/topology/repositories/${repositoryIndex}/validation/residueExceptions/${residueIndex}/path`,
        );
      }
      seen.add(residue.path);
    }
  }
}

function validateTopology(model: WakeflowConfigV3Wire): void {
  const uuids = new Map<string, string>();
  registerIdentity(model.program.programId, "program", "$/program/programId", uuids);

  const repositories = new Map<string, RepositoryWire>();
  for (const [index, repository] of model.topology.repositories.entries()) {
    const at = `$/topology/repositories/${index}/repositoryId`;
    registerIdentity(repository.repositoryId, "repository", at, uuids);
    repositories.set(repository.repositoryId, repository);
  }

  const surfaces = new Map<string, WakeflowManagedSurfaceWire | ExternalOwnedSurfaceWire>();
  for (const [index, surface] of model.topology.supportSurfaces.entries()) {
    const at = `$/topology/supportSurfaces/${index}/surfaceId`;
    registerIdentity(surface.surfaceId, "surface", at, uuids);
    surfaces.set(surface.surfaceId, surface);
  }

  const repositoriesWithProductWindow = new Set<string>();
  for (const [index, window] of model.topology.windows.entries()) {
    registerIdentity(
      window.windowId,
      "window",
      `$/topology/windows/${index}/windowId`,
      uuids,
    );
    if (window.role === "design" || window.role === "test") {
      const at = `$/topology/windows/${index}/root/surfaceId`;
      const ref = parseIdentity(window.root.surfaceId, "surface", at);
      const surface = surfaces.get(ref);
      if (surface === undefined) fail("reference", at);
      if (surface.capability !== window.role) fail("topology", at);
    } else if (window.role === "product") {
      const at = `$/topology/windows/${index}/root/repositoryId`;
      const ref = parseIdentity(window.root.repositoryId, "repository", at);
      if (!repositories.has(ref)) fail("reference", at);
      repositoriesWithProductWindow.add(ref);
    }
  }
  for (const [index, repository] of model.topology.repositories.entries()) {
    if (!repositoriesWithProductWindow.has(repository.repositoryId)) {
      fail("topology", `$/topology/repositories/${index}/repositoryId`);
    }
  }
  validateResidueUniqueness(model);
}

/** 把任意内存值解析为严格、递归冻结的公开 v3 配置领域模型。 */
export function parseWakeflowConfigV3(value: unknown): WakeflowConfigV3Model {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$config");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json-value", error.path);
    throw error;
  }
  const result = validateWireConfig(json);
  if (!result.ok) fail("schema", result.path);
  validatePlacements(result.value);
  validateTopology(result.value);

  // Ajv、位置和类型化引用校验已经恢复 Schema 无法表达的领域类型品牌。
  return result.value as unknown as WakeflowConfigV3Model;
}

/** 基于规范化 JSON 语义计算配置时效性摘要，不绑定空白或键顺序。 */
export function computeWakeflowConfigV3Digest(
  model: WakeflowConfigV3Model,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(model as unknown as JsonValue);
}

function frozenRecord<Value>(
  entries: readonly (readonly [string, Value])[],
): Readonly<Record<string, Value>> {
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<string, Value>>;
}

/** 为已验证模型建立冻结的常用实体索引；索引不会反向成为配置权威事实。 */
export function buildWakeflowConfigV3Indexes(
  model: WakeflowConfigV3Model,
): Readonly<WakeflowConfigV3Indexes> {
  const repositoryById = frozenRecord(
    model.topology.repositories.map((repository) => [
      repository.repositoryId,
      repository,
    ] as const),
  );
  const surfaceById = frozenRecord(
    model.topology.supportSurfaces.map((surface) => [
      surface.surfaceId,
      surface,
    ] as const),
  );
  const windowById = frozenRecord(
    model.topology.windows.map((window) => [window.windowId, window] as const),
  );
  const productWindows = Object.freeze(
    model.topology.windows.filter(
      (window): window is WakeflowProductWindow => window.role === "product",
    ),
  );
  const windowsByRepositoryId = frozenRecord(
    model.topology.repositories.map((repository) => [
      repository.repositoryId,
      Object.freeze(productWindows.filter(
        (window) => window.root.repositoryId === repository.repositoryId,
      )),
    ] as const),
  );
  const controllerWindow = model.topology.windows.find(
    (window): window is WakeflowControllerWindow => window.role === "controller",
  );
  const designWindow = model.topology.windows.find(
    (window): window is WakeflowDesignWindow => window.role === "design",
  );
  const testWindow = model.topology.windows.find(
    (window): window is WakeflowTestWindow => window.role === "test",
  );
  if (
    controllerWindow === undefined
    || designWindow === undefined
    || testWindow === undefined
  ) {
    fail("topology", "$/topology/windows");
  }
  return Object.freeze({
    repositoryById: repositoryById as WakeflowConfigV3Indexes["repositoryById"],
    surfaceById: surfaceById as WakeflowConfigV3Indexes["surfaceById"],
    windowById: windowById as WakeflowConfigV3Indexes["windowById"],
    windowsByRepositoryId: windowsByRepositoryId as WakeflowConfigV3Indexes["windowsByRepositoryId"],
    controllerWindow,
    designWindow,
    testWindow,
    productWindows,
  });
}
