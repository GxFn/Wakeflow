import { throwIfAborted } from "../node/abort-signal.js";
import { filesystemMutation } from "./filesystem-mutation.js";
import type { PortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
import { RootedResourceParentHandle } from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：删除根作用域内的一整棵目录树。
 *
 * Demand 归档后退役活动根、pod 关闭后退役回执目录，都是 Wakeflow 自己的私有树整棵消失；之前
 * 由切片与内核直接 `rm -r`。本端口把删除收进 foundation（§13.166 批次 1）：先经 `RootedDirectory`
 * 确认目标在根内且是目录，再删除；目标不在按 `missing` 选项返回 `absent` 或失败；删除失败带
 * errno 的 `removal-failure`。它不是 candidate 协议的替代：有计划的候选树仍走退役协议。
 * 1.4.1 第 1 段起，账本发布器删除同一条记录崩溃留下的暂存树也走这里。
 *
 * 持久性（1.4.1 第 1 段，清单 2.1“整目录删除”）：有三个调用方，各自需要删除持久的理由不同。
 * - Demand 根退役：之后持久删除 Demand 生命周期日志，这一步以删除已经持久为前提，否则掉电后
 *   可能日志已消失而 Demand 根又回来。
 * - pod 回执目录退役：之后没有以它为前提的持久步骤；同步只让已关闭 pod 的回执目录掉电后不再
 *   回来，同步之前留下或回来的回执目录是孤儿，由 pod recover 清掉。
 * - 账本发布器删除残留暂存（记录锁内、final 不在时）：删除在同一路径重建暂存之前已经持久，
 *   重建期间掉电只会留下这次重建的状态，旧残留不会回来；那些状态由同一个请求重发时重新判断。
 * 因此删除前总是打开被删树的父目录句柄，删除成功后经该句柄同步父目录恰好一次再关闭，
 * 调用在父目录同步之后才返回；删除失败时只关闭句柄。根的持久化级别仍然起作用：根以
 * `none` 打开时 `sync` 内部跳过 fsync。父目录句柄打不开是单独的 `parent-open-failure`，
 * 树原样留着；目标缺失且 `missing: "ignore"` 时在打开父目录之前返回。树内的文件与子目录
 * 不逐个同步：父目录项消失后它们不再可达。
 *
 * `durability-failure` 只在删除已经发生之后出现，覆盖两种情形：父目录同步失败（树已从命名
 * 空间消失、删除未必持久），或同步成功之后关闭父目录句柄失败（删除已经持久）。两者共用一个
 * 原因，由 `cause` 上 `RootedResourceParentHandleError` 的原因区分（`close-failure` 是后者）。
 * 句柄在每条路径上恰好关闭一次；多个失败时调用方收到第一个，后来的关闭失败不覆盖它。
 */

export type RootedDirectoryTreeRemovalErrorReason =
  | "input"
  | "not-found"
  | "not-directory"
  | "inspection-failure"
  | "parent-open-failure"
  | "removal-failure"
  | "durability-failure";

const ERROR_MESSAGES = {
  input: "Rooted directory tree removal input is invalid.",
  "not-found": "Rooted directory tree does not exist.",
  "not-directory": "Rooted directory tree target is not a directory.",
  "inspection-failure": "Rooted directory tree target could not be inspected.",
  "parent-open-failure": "Rooted directory tree parent could not be opened.",
  "removal-failure": "Rooted directory tree could not be removed.",
  "durability-failure":
    "Rooted directory tree was removed, but its parent could not be synchronized or closed.",
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

interface ParsedRemovalOptions {
  readonly missing: "fail" | "ignore";
  readonly signal: AbortSignal | undefined;
}

function fail(reason: RootedDirectoryTreeRemovalErrorReason, path: string, cause?: unknown): never {
  throw new RootedDirectoryTreeRemovalError(reason, path, cause);
}

function parseOptions(
  value: RootedDirectoryTreeRemovalOptions | undefined,
  path: string,
): Readonly<ParsedRemovalOptions> {
  if (value === undefined) {
    return Object.freeze({ missing: "fail", signal: undefined });
  }
  if (typeof value !== "object" || value === null) fail("input", path);
  const missing = value.missing ?? "fail";
  if (missing !== "fail" && missing !== "ignore") fail("input", path);
  const signal = value.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail("input", path);
  return Object.freeze({ missing, signal });
}

async function openRemovalParent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  errorPath: string,
): Promise<RootedResourceParentHandle> {
  try {
    return await RootedResourceParentHandle.open(root, resourcePath, errorPath);
  } catch (error: unknown) {
    fail("parent-open-failure", errorPath, error);
  }
}

/** 删除之后经父目录句柄同步一次并关闭句柄；删除已失败时只关闭。返回首个错误。 */
async function settleRemovalParent(
  parent: RootedResourceParentHandle,
  removed: boolean,
  errorPath: string,
): Promise<RootedDirectoryTreeRemovalError | undefined> {
  let primaryError: RootedDirectoryTreeRemovalError | undefined;
  if (removed) {
    try {
      await parent.sync();
    } catch (error: unknown) {
      primaryError = new RootedDirectoryTreeRemovalError("durability-failure", errorPath, error);
    }
  }
  try {
    await parent.close();
  } catch (error: unknown) {
    primaryError ??= new RootedDirectoryTreeRemovalError("durability-failure", errorPath, error);
  }
  return primaryError;
}

/**
 * 删除 `root` 下 `resourcePath` 这棵目录树并同步其父目录；返回 `removed` 或（`missing: "ignore"`
 * 时）`absent`。
 */
export async function removeRootedDirectoryTree(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  optionsValue?: RootedDirectoryTreeRemovalOptions,
  errorPath = "$directory",
): Promise<"removed" | "absent"> {
  if (!(root instanceof RootedDirectory)) fail("input", "$root");
  const options = parseOptions(optionsValue, errorPath);
  throwIfAborted(options.signal);
  let snapshot: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
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
  throwIfAborted(options.signal);
  // 删除之前绑定父目录句柄，删除之后经它同步一次，同步落在删除发生的那个目录上。
  const parent = await openRemovalParent(root, resourcePath, errorPath);
  let primaryError: RootedDirectoryTreeRemovalError | undefined;
  try {
    await filesystemMutation.removeTree(snapshot.physicalPath);
  } catch (error: unknown) {
    primaryError = new RootedDirectoryTreeRemovalError("removal-failure", errorPath, error);
  }
  const parentError = await settleRemovalParent(parent, primaryError === undefined, errorPath);
  primaryError ??= parentError;
  if (primaryError !== undefined) throw primaryError;
  return "removed";
}
