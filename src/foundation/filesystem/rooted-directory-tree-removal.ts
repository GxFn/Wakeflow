import { rm } from "node:fs/promises";

import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";

/**
 * Wakeflow Foundation / Filesystem：删除根作用域内的一整棵目录树。
 *
 * Demand 归档后退役活动根、pod 关闭后退役回执目录，都是 Wakeflow 自己的私有树整棵消失；之前
 * 由切片与内核直接 `rm -r`。本端口把删除收进 foundation（§13.166 批次 1）：先经 `RootedDirectory`
 * 确认目标在根内且是目录，再删除；目标不在按 `missing` 选项返回 `absent` 或失败；删除失败带
 * errno 的 `removal-failure`。它不是 candidate 协议的替代：有计划的候选树仍走退役协议。
 */

export type RootedDirectoryTreeRemovalErrorReason =
  | "input"
  | "not-found"
  | "not-directory"
  | "inspection-failure"
  | "removal-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Rooted directory tree removal input is invalid.",
  "not-found": "Rooted directory tree does not exist.",
  "not-directory": "Rooted directory tree target is not a directory.",
  "inspection-failure": "Rooted directory tree target could not be inspected.",
  "removal-failure": "Rooted directory tree could not be removed.",
  aborted: "Rooted directory tree removal was aborted.",
} as const satisfies Readonly<Record<RootedDirectoryTreeRemovalErrorReason, string>>;

export class RootedDirectoryTreeRemovalError extends Error {
  override readonly name = "RootedDirectoryTreeRemovalError";
  readonly code = "wakeflow-rooted-directory-tree-removal" as const;
  readonly reason: RootedDirectoryTreeRemovalErrorReason;
  readonly path: string;

  constructor(reason: RootedDirectoryTreeRemovalErrorReason, path: string, cause?: unknown) {
    super(ERROR_MESSAGES[reason], cause === undefined ? undefined : { cause });
    this.reason = reason;
    this.path = path;
  }
}

export interface RootedDirectoryTreeRemovalOptions {
  /** 目标不存在时：`fail` 报 `not-found`（缺省），`ignore` 返回 `absent`。 */
  readonly missing?: "fail" | "ignore";
  readonly signal?: AbortSignal;
}

function fail(reason: RootedDirectoryTreeRemovalErrorReason, path: string, cause?: unknown): never {
  throw new RootedDirectoryTreeRemovalError(reason, path, cause);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function parseOptions(
  value: RootedDirectoryTreeRemovalOptions | undefined,
  path: string,
): Readonly<{ missing: "fail" | "ignore"; signal: AbortSignal | undefined }> {
  if (value === undefined) return Object.freeze({ missing: "fail" as const, signal: undefined });
  if (typeof value !== "object" || value === null) fail("input", path);
  const missing = value.missing ?? "fail";
  if (missing !== "fail" && missing !== "ignore") fail("input", path);
  const signal = value.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail("input", path);
  return Object.freeze({ missing, signal });
}

/** 删除 `root` 下 `resourcePath` 这棵目录树；返回 `removed` 或（`missing: "ignore"` 时）`absent`。 */
export async function removeRootedDirectoryTree(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  optionsValue?: RootedDirectoryTreeRemovalOptions,
  errorPath = "$directory",
): Promise<"removed" | "absent"> {
  if (!(root instanceof RootedDirectory)) fail("input", "$root");
  const options = parseOptions(optionsValue, errorPath);
  assertNotAborted(options.signal);
  let snapshot;
  try {
    snapshot = await root.inspectExistingResource(resourcePath, errorPath);
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
      if (options.missing === "ignore") return "absent";
      fail("not-found", errorPath, error);
    }
    fail("inspection-failure", errorPath, error);
  }
  if (snapshot.node.kind !== "directory") fail("not-directory", errorPath);
  assertNotAborted(options.signal);
  try {
    await rm(snapshot.physicalPath, { recursive: true, force: false });
  } catch (error: unknown) {
    fail("removal-failure", errorPath, error);
  }
  return "removed";
}
