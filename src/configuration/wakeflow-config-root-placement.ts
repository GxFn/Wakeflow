import { types } from "node:util";
import nodePath from "node:path";

import {
  AbsoluteDirectoryPlacementError,
  inspectAbsoluteDirectoryPlacement,
  type AbsoluteDirectoryPlacementObservation,
} from "../foundation/filesystem/absolute-directory-placement.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import {
  WAKEFLOW_ACTIVE_ROOT,
  WAKEFLOW_LOCAL_ROOT,
  type WakeflowConfigPlacement,
  type WakeflowConfigV3Model,
} from "./wakeflow-config-v3.js";

/**
 * Wakeflow Configuration：v3 配置声明根目录的词法与物理位置准入。
 *
 * 本模块把固定的 Active、Local 根目录与配置中的 Ledger、Support、Repository 根目录
 * 编译成一组绝对路径。它先按可移植NFC/case-fold比较拒绝词法重叠，再复用
 * `AbsoluteDirectoryPlacement`逐项检查符号链接、目录类型和规范路径拼写，最后拒绝
 * 已有根目录的真实路径重叠。
 * 缺失根目录会作为未来位置明确记录，但本层绝不创建它们。
 *
 * 这只是配置快照的布局准入，不是完整的布局描述符，也不授予任何根目录写入权限。
 * 每个领域职责所有者仍需在自己的 `RootedDirectory`、互斥锁或比较并交换边界内打开
 * 并复验实际目标。
 */

export interface WakeflowConfigRootPlacementEntry {
  readonly key: string;
  readonly configuredPath: WakeflowConfigPlacement;
  readonly absolutePath: string;
  readonly state: "present" | "missing";
  readonly realPath: string | null;
}

export interface WakeflowConfigRootPlacementReport {
  readonly workspaceRoot: string;
  readonly roots: readonly Readonly<WakeflowConfigRootPlacementEntry>[];
  readonly missingRootKeys: readonly string[];
}

export type WakeflowConfigRootPlacementErrorReason =
  | "input"
  | "root-scope"
  | "lexical-overlap"
  | "symlink"
  | "not-directory"
  | "alias"
  | "physical-overlap"
  | "inspection-failure";

const ERROR_MESSAGES = {
  "input": "Wakeflow config placement input is invalid.",
  "root-scope": "Wakeflow workspace root changed during placement admission.",
  "lexical-overlap": "Wakeflow configured roots overlap lexically.",
  "symlink": "Wakeflow configured root contains a symbolic link.",
  "not-directory": "Wakeflow configured root contains a non-directory node.",
  "alias": "Wakeflow configured root does not use its canonical physical spelling.",
  "physical-overlap": "Wakeflow configured roots overlap physically.",
  "inspection-failure": "Wakeflow configured roots could not be inspected safely.",
} as const satisfies Readonly<Record<
  WakeflowConfigRootPlacementErrorReason,
  string
>>;

/** 配置根目录位置准入失败时返回的稳定、脱敏错误。 */
export class WakeflowConfigRootPlacementError extends Error {
  override readonly name = "WakeflowConfigRootPlacementError";
  readonly code = "wakeflow-config-root-placement" as const;
  readonly reason: WakeflowConfigRootPlacementErrorReason;
  readonly path: string;

  constructor(reason: WakeflowConfigRootPlacementErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface PlannedRoot {
  readonly key: string;
  readonly configuredPath: WakeflowConfigPlacement;
  readonly absolutePath: string;
}

function fail(
  reason: WakeflowConfigRootPlacementErrorReason,
  path: string,
): never {
  throw new WakeflowConfigRootPlacementError(reason, path);
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function portableComparisonPath(value: string): string {
  return nodePath.normalize(value).normalize("NFC").toLowerCase();
}

function asPlacement(value: string): WakeflowConfigPlacement {
  // 固定协议根由本模块常量提供；配置字段已由 WakeflowConfigV3Model parser 授予品牌。
  return value as WakeflowConfigPlacement;
}

function planRoots(
  workspaceRoot: string,
  model: WakeflowConfigV3Model,
): readonly Readonly<PlannedRoot>[] {
  const values = [
    { key: "active.root", configuredPath: asPlacement(WAKEFLOW_ACTIVE_ROOT) },
    { key: "local.root", configuredPath: asPlacement(WAKEFLOW_LOCAL_ROOT) },
    { key: "ledger.root", configuredPath: model.storage.ledgerRoot },
    ...model.topology.supportSurfaces.map((surface) => ({
      key: `support.${surface.surfaceId}.root`,
      configuredPath: surface.path,
    })),
    ...model.topology.repositories.map((repository) => ({
      key: `repository.${repository.repositoryId}.root`,
      configuredPath: repository.path,
    })),
  ];
  return Object.freeze(values.map((value) => Object.freeze({
    ...value,
    absolutePath: nodePath.resolve(
      workspaceRoot,
      ...value.configuredPath.split("/"),
    ),
  })));
}

function assertNoOverlap<Entry>(
  roots: readonly Entry[],
  pathOf: (entry: Entry) => string,
  reason: "lexical-overlap" | "physical-overlap",
): void {
  const indexByPath = new Map<string, number>();
  for (const [index, root] of roots.entries()) {
    const key = portableComparisonPath(pathOf(root));
    const duplicate = indexByPath.get(key);
    if (duplicate !== undefined) {
      fail(reason, `$placements/${duplicate}|${index}`);
    }
    indexByPath.set(key, index);
  }
  for (const [index, root] of roots.entries()) {
    let current = portableComparisonPath(pathOf(root));
    while (true) {
      const parent = nodePath.dirname(current);
      if (parent === current) break;
      const ancestor = indexByPath.get(parent);
      if (ancestor !== undefined) {
        const left = Math.min(ancestor, index);
        const right = Math.max(ancestor, index);
        fail(reason, `$placements/${left}|${right}`);
      }
      current = parent;
    }
  }
}

function mapInspectionError(
  error: AbsoluteDirectoryPlacementError,
  path: string,
): never {
  if (error.reason === "symlink") fail("symlink", path);
  if (error.reason === "not-directory") fail("not-directory", path);
  if (error.reason === "input") fail("input", path);
  fail("inspection-failure", path);
}

async function observeRoot(
  planned: Readonly<PlannedRoot>,
  index: number,
): Promise<Readonly<AbsoluteDirectoryPlacementObservation>> {
  const path = `$placements/${index}`;
  try {
    return await inspectAbsoluteDirectoryPlacement(planned.absolutePath, path);
  } catch (error: unknown) {
    if (error instanceof AbsoluteDirectoryPlacementError) {
      mapInspectionError(error, path);
    }
    throw error;
  }
}

async function assertCurrentRoot(root: RootedDirectory): Promise<void> {
  try {
    await root.assertCurrent("$root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

/** 验证配置声明根目录的确定性词法拓扑和当前物理位置。 */
export async function validateWakeflowConfigRootPlacements(
  root: RootedDirectory,
  model: WakeflowConfigV3Model,
): Promise<Readonly<WakeflowConfigRootPlacementReport>> {
  assertRoot(root);
  await assertCurrentRoot(root);
  const planned = planRoots(root.absolutePath, model);
  assertNoOverlap(
    planned,
    (entry) => entry.absolutePath,
    "lexical-overlap",
  );

  const observed: AbsoluteDirectoryPlacementObservation[] = [];
  for (const [index, entry] of planned.entries()) {
    const observation = await observeRoot(entry, index);
    if (
      observation.state === "present"
      && observation.spellingIsCanonical !== true
    ) {
      fail("alias", `$placements/${index}`);
    }
    if (observation.state === "missing") {
      if (observation.nearestExistingAncestor === null) {
        fail("inspection-failure", `$placements/${index}`);
      }
      if (
        observation.nearestExistingAncestor.spellingIsCanonical !== true
      ) {
        fail("alias", `$placements/${index}`);
      }
    }
    observed.push(observation);
  }

  const physicallyPresent = planned.flatMap((entry, index) => {
    const observation = observed[index];
    return observation?.state === "present" && observation.realPath !== null
      ? [Object.freeze({ ...entry, realPath: observation.realPath })]
      : [];
  });
  assertNoOverlap(
    physicallyPresent,
    (entry) => entry.realPath,
    "physical-overlap",
  );
  await assertCurrentRoot(root);

  const roots = Object.freeze(planned.map((entry, index) => {
    const observation = observed[index];
    if (observation === undefined) fail("inspection-failure", "$placements");
    return Object.freeze({
      key: entry.key,
      configuredPath: entry.configuredPath,
      absolutePath: entry.absolutePath,
      state: observation.state,
      realPath: observation.realPath,
    });
  }));
  return Object.freeze({
    workspaceRoot: root.absolutePath,
    roots,
    missingRootKeys: Object.freeze(
      roots.filter((entry) => entry.state === "missing")
        .map((entry) => entry.key),
    ),
  });
}
