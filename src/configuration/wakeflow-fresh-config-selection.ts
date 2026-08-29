import { types } from "node:util";

import {
  computeCanonicalJsonSha256Digest,
} from "../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  createWakeflowDurableId,
  type WakeflowDurableId,
} from "../foundation/identity/wakeflow-durable-id.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../foundation/identity/uuid-v4.js";
import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WAKEFLOW_CONFIG_V3_KIND,
  WAKEFLOW_CONFIG_V3_SCHEMA_ID,
  WAKEFLOW_CONFIG_V3_VERSION,
  WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "./wakeflow-config-v3.js";

/**
 * Wakeflow Configuration：Fresh用户选择到typed Config的纯编译边界。
 *
 * Repository、Support Surface与Window使用仅在本请求内有效的selectionKey；编译器一次
 * 分配全部durable IDs并解析逻辑根引用。selectionKey不会进入Config，显示文本和路径
 * 不参与身份生成；省略presentation.language时显式持久化默认`en`。
 */

export const WAKEFLOW_FRESH_SELECTION_KEY_PATTERN =
  /^[a-z][a-z0-9-]{0,63}$/u;
export const WAKEFLOW_FRESH_SELECTION_MAXIMUM_ENTITIES = 256;

export interface WakeflowFreshConfigSelection {
  readonly program: Readonly<Record<string, unknown>>;
  readonly presentation: Readonly<Record<string, unknown>>;
  readonly topology: Readonly<{
    readonly repositories: readonly Readonly<Record<string, unknown>>[];
    readonly supportSurfaces: readonly Readonly<Record<string, unknown>>[];
    readonly windows: readonly Readonly<Record<string, unknown>>[];
  }>;
  readonly storage: Readonly<Record<string, unknown>>;
  readonly governance: Readonly<Record<string, unknown>>;
  readonly hosts: Readonly<Record<string, unknown>>;
}

export interface WakeflowFreshConfigSelectionAllocation<
  Kind extends "repository" | "surface" | "window",
> {
  readonly selectionKey: string;
  readonly id: WakeflowDurableId<Kind>;
}

export interface WakeflowFreshConfigCompilation {
  readonly kind: "WakeflowFreshConfigCompilation";
  readonly schemaVersion: 1;
  readonly selectionDigest: Sha256Digest;
  readonly config: WakeflowConfigV3Model;
  readonly configDigest: Sha256Digest;
  readonly allocations: Readonly<{
    readonly programId: WakeflowDurableId<"program">;
    readonly repositories:
      readonly Readonly<WakeflowFreshConfigSelectionAllocation<"repository">>[];
    readonly supportSurfaces:
      readonly Readonly<WakeflowFreshConfigSelectionAllocation<"surface">>[];
    readonly windows:
      readonly Readonly<WakeflowFreshConfigSelectionAllocation<"window">>[];
  }>;
}

export interface CompileWakeflowFreshConfigSelectionOptions {
  readonly uuidFactory?: UuidV4Factory;
}

export type WakeflowFreshConfigSelectionErrorReason =
  | "input"
  | "shape"
  | "selection-key"
  | "reference"
  | "id-source"
  | "id-collision"
  | "config";

const ERROR_MESSAGES = {
  input: "Wakeflow Fresh Config selection input is invalid.",
  shape: "Wakeflow Fresh Config selection has an invalid shape.",
  "selection-key": "Wakeflow Fresh Config selection key is invalid or duplicated.",
  reference: "Wakeflow Fresh Config selection contains an unresolved logical reference.",
  "id-source": "Wakeflow Fresh Config durable identity source failed.",
  "id-collision": "Wakeflow Fresh Config generated duplicate UUID identities.",
  config: "Wakeflow Fresh Config selection does not form a valid Config v3 model.",
} as const satisfies Readonly<Record<
  WakeflowFreshConfigSelectionErrorReason,
  string
>>;

/** Fresh Config selection 编译失败的稳定、脱敏错误。 */
export class WakeflowFreshConfigSelectionError extends Error {
  override readonly name = "WakeflowFreshConfigSelectionError";
  readonly code = "wakeflow-fresh-config-selection" as const;
  readonly reason: WakeflowFreshConfigSelectionErrorReason;
  readonly path: string;

  constructor(reason: WakeflowFreshConfigSelectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly uuidFactory: UuidV4Factory | undefined;
}

const TOP_LEVEL_FIELDS = Object.freeze([
  "governance",
  "hosts",
  "presentation",
  "program",
  "storage",
  "topology",
]);

function fail(
  reason: WakeflowFreshConfigSelectionErrorReason,
  path: string,
): never {
  throw new WakeflowFreshConfigSelectionError(reason, path);
}

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
}

function array(value: unknown, path: string): readonly unknown[] {
  try {
    return parseDenseArray(
      value,
      WAKEFLOW_FRESH_SELECTION_MAXIMUM_ENTITIES,
      path,
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
}

function assertFields(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail("shape", path);
  }
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  const parsed = record(value, "$options");
  if (
    Object.keys(parsed).some((key) => key !== "uuidFactory")
    || (
      parsed.uuidFactory !== undefined
      && (
        typeof parsed.uuidFactory !== "function"
        || types.isProxy(parsed.uuidFactory)
      )
    )
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    uuidFactory: parsed.uuidFactory as UuidV4Factory | undefined,
  });
}

function selectionKey(
  value: unknown,
  path: string,
  seen: Set<string>,
): string {
  if (
    typeof value !== "string"
    || !WAKEFLOW_FRESH_SELECTION_KEY_PATTERN.test(value)
    || seen.has(value)
  ) {
    fail("selection-key", path);
  }
  seen.add(value);
  return value;
}

function optionalProperty(
  source: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  return source[key] === undefined ? {} : { [key]: source[key] };
}

function allocateId<Kind extends "program" | "repository" | "surface" | "window">(
  kind: Kind,
  options: Readonly<ParsedOptions>,
  seenUuid: Set<string>,
): WakeflowDurableId<Kind> {
  let uuid;
  try {
    uuid = options.uuidFactory === undefined
      ? createUuidV4()
      : createUuidV4(options.uuidFactory);
  } catch (error: unknown) {
    if (error instanceof UuidV4Error) fail("id-source", "$options.uuidFactory");
    throw error;
  }
  if (seenUuid.has(uuid)) fail("id-collision", "$options.uuidFactory");
  seenUuid.add(uuid);
  return createWakeflowDurableId(kind, uuid);
}

function sortedAllocations<Kind extends "repository" | "surface" | "window">(
  values: readonly Readonly<WakeflowFreshConfigSelectionAllocation<Kind>>[],
): readonly Readonly<WakeflowFreshConfigSelectionAllocation<Kind>>[] {
  return Object.freeze([...values].sort((left, right) => (
    left.selectionKey < right.selectionKey
      ? -1
      : left.selectionKey > right.selectionKey
        ? 1
        : 0
  )));
}

/** 把闭合Fresh selection编译为完整typed Config和可审查ID allocation。 */
export function compileWakeflowFreshConfigSelection(
  selectionValue: unknown,
  optionsValue: CompileWakeflowFreshConfigSelectionOptions = {},
): Readonly<WakeflowFreshConfigCompilation> {
  const options = parseOptions(optionsValue);
  const selection = record(selectionValue, "$selection");
  if (
    Object.keys(selection).sort().join("\u0000")
      !== TOP_LEVEL_FIELDS.join("\u0000")
  ) {
    fail("shape", "$selection");
  }
  const program = record(selection.program, "$/program");
  assertFields(program, ["displayName"], ["description"], "$/program");
  const presentation = record(selection.presentation, "$/presentation");
  assertFields(presentation, [], ["language"], "$/presentation");
  const topology = record(selection.topology, "$/topology");
  assertFields(
    topology,
    ["repositories", "supportSurfaces", "windows"],
    [],
    "$/topology",
  );
  const storage = record(selection.storage, "$/storage");
  const governance = record(selection.governance, "$/governance");
  const hosts = record(selection.hosts, "$/hosts");

  const seenKeys = new Set<string>();
  const seenUuid = new Set<string>();
  const programId = allocateId("program", options, seenUuid);
  const repositoryByKey = new Map<string, WakeflowDurableId<"repository">>();
  const repositoryAllocations: WakeflowFreshConfigSelectionAllocation<"repository">[] = [];
  const repositories = array(topology.repositories, "$/topology/repositories")
    .map((entry, index) => {
      const path = `$/topology/repositories/${index}`;
      const value = record(entry, path);
      assertFields(
        value,
        ["selectionKey", "path", "displayName", "instructionManagement"],
        ["description", "validation"],
        path,
      );
      const key = selectionKey(value.selectionKey, `${path}/selectionKey`, seenKeys);
      const repositoryId = allocateId("repository", options, seenUuid);
      repositoryByKey.set(key, repositoryId);
      repositoryAllocations.push(Object.freeze({
        selectionKey: key,
        id: repositoryId,
      }));
      return {
        repositoryId,
        path: value.path,
        displayName: value.displayName,
        ...optionalProperty(value, "description"),
        instructionManagement: value.instructionManagement,
        ...optionalProperty(value, "validation"),
      };
    });

  const surfaceByKey = new Map<string, WakeflowDurableId<"surface">>();
  const surfaceAllocations: WakeflowFreshConfigSelectionAllocation<"surface">[] = [];
  const supportSurfaces = array(
    topology.supportSurfaces,
    "$/topology/supportSurfaces",
  ).map((entry, index) => {
    const path = `$/topology/supportSurfaces/${index}`;
    const value = record(entry, path);
    assertFields(
      value,
      ["selectionKey", "capability", "path", "displayName", "ownership"],
      ["description", "instructionManagement"],
      path,
    );
    const key = selectionKey(value.selectionKey, `${path}/selectionKey`, seenKeys);
    const surfaceId = allocateId("surface", options, seenUuid);
    surfaceByKey.set(key, surfaceId);
    surfaceAllocations.push(Object.freeze({ selectionKey: key, id: surfaceId }));
    return {
      surfaceId,
      capability: value.capability,
      path: value.path,
      displayName: value.displayName,
      ...optionalProperty(value, "description"),
      ownership: value.ownership,
      ...optionalProperty(value, "instructionManagement"),
    };
  });

  const windowAllocations: WakeflowFreshConfigSelectionAllocation<"window">[] = [];
  const windows = array(topology.windows, "$/topology/windows")
    .map((entry, index) => {
      const path = `$/topology/windows/${index}`;
      const value = record(entry, path);
      assertFields(
        value,
        ["selectionKey", "role", "displayName", "root"],
        ["description"],
        path,
      );
      const key = selectionKey(value.selectionKey, `${path}/selectionKey`, seenKeys);
      const windowId = allocateId("window", options, seenUuid);
      windowAllocations.push(Object.freeze({ selectionKey: key, id: windowId }));
      const root = record(value.root, `${path}/root`);
      let resolvedRoot: Readonly<Record<string, unknown>>;
      if (root.kind === "program") {
        assertFields(root, ["kind"], [], `${path}/root`);
        resolvedRoot = Object.freeze({ kind: "program" });
      } else {
        assertFields(root, ["kind", "selectionKey"], [], `${path}/root`);
        if (
          typeof root.selectionKey !== "string"
          || !WAKEFLOW_FRESH_SELECTION_KEY_PATTERN.test(root.selectionKey)
        ) {
          fail("reference", `${path}/root/selectionKey`);
        }
        if (root.kind === "repository") {
          const repositoryId = repositoryByKey.get(root.selectionKey);
          if (repositoryId === undefined) {
            fail("reference", `${path}/root/selectionKey`);
          }
          resolvedRoot = Object.freeze({ kind: "repository", repositoryId });
        } else if (root.kind === "support-surface") {
          const surfaceId = surfaceByKey.get(root.selectionKey);
          if (surfaceId === undefined) {
            fail("reference", `${path}/root/selectionKey`);
          }
          resolvedRoot = Object.freeze({ kind: "support-surface", surfaceId });
        } else {
          fail("reference", `${path}/root/kind`);
        }
      }
      return {
        windowId,
        role: value.role,
        displayName: value.displayName,
        ...optionalProperty(value, "description"),
        root: resolvedRoot,
      };
    });

  const normalizedSelection = Object.freeze({
    program,
    presentation: Object.freeze({
      language: presentation.language ?? WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE,
    }),
    topology: Object.freeze({
      repositories: Object.freeze(array(topology.repositories, "$/topology/repositories")),
      supportSurfaces: Object.freeze(array(
        topology.supportSurfaces,
        "$/topology/supportSurfaces",
      )),
      windows: Object.freeze(array(topology.windows, "$/topology/windows")),
    }),
    storage,
    governance,
    hosts,
  });
  let config: WakeflowConfigV3Model;
  try {
    config = parseWakeflowConfigV3({
      $schema: WAKEFLOW_CONFIG_V3_SCHEMA_ID,
      kind: WAKEFLOW_CONFIG_V3_KIND,
      schemaVersion: WAKEFLOW_CONFIG_V3_VERSION,
      program: {
        programId,
        displayName: program.displayName,
        ...optionalProperty(program, "description"),
      },
      presentation: normalizedSelection.presentation,
      topology: { repositories, supportSurfaces, windows },
      storage,
      governance,
      hosts,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
  return Object.freeze({
    kind: "WakeflowFreshConfigCompilation",
    schemaVersion: 1,
    selectionDigest: computeCanonicalJsonSha256Digest(normalizedSelection),
    config,
    configDigest: computeWakeflowConfigV3Digest(config),
    allocations: Object.freeze({
      programId,
      repositories: sortedAllocations(repositoryAllocations),
      supportSurfaces: sortedAllocations(surfaceAllocations),
      windows: sortedAllocations(windowAllocations),
    }),
  });
}
