import nodePath from "node:path";

import { type Fail, failWith, ModuleError } from "../error/module-error.js";
import {
  AbsoluteDirectoryPlacementError,
  inspectAbsoluteDirectoryPlacement,
} from "./absolute-directory-placement.js";
import {
  type DirectoryMaterializationDisposition,
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "./durable-directory-materialization.js";
import { type FileNodeSnapshot, sameFileNodeIdentity } from "./file-node-snapshot.js";
import { PortableResourcePathError, parsePortableResourcePath } from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
import { throwIfAborted } from "../node/abort-signal.js";

/**
 * Wakeflow Foundation / Filesystem：规范绝对目录位置的持久化逐级物化。
 *
 * 本能力先消费 AbsoluteDirectoryPlacement 在单次逐段观察中固定的最近规范真实祖先，
 * 再将该祖先作为一次 RootedDirectory，复用根内 DurableDirectoryMaterialization 逐段创建。
 * 已有目录只观察不改权限；新目录使用调用方显式 mode。最终重新从绝对路径检查目标
 * 与刚物化节点仍为同一身份。
 *
 * 最近祖先若只能退到文件系统根则拒绝，避免以 `/` 为宽泛写入根。整条路径不是原子
 * 事务：已耐久创建的安全前缀在中途失败后保留，供领域 owner 的 confirmed plan 重试
 * 或恢复。Node.js 未暴露 openat/openat2，路径名竞态边界与 RootedDirectory 相同。
 */

interface AbsoluteDirectoryMaterializationOptions {
  readonly mode: number;
  readonly signal?: AbortSignal;
}

interface AbsoluteDirectoryMaterializationEntry {
  readonly absolutePath: string;
  readonly disposition: DirectoryMaterializationDisposition;
  readonly node: Readonly<FileNodeSnapshot>;
}

interface AbsoluteDirectoryMaterializationResult {
  readonly absolutePath: string;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly segments: readonly Readonly<AbsoluteDirectoryMaterializationEntry>[];
}

export type AbsoluteDirectoryMaterializationErrorReason =
  | "input"
  | "scope"
  | "symlink"
  | "not-directory"
  | "alias"
  | "root-open"
  | "materialization"
  | "path-changed"
  | "close-failure";

/** 绝对目录位置物化失败的稳定、脱敏错误。 */
export class AbsoluteDirectoryMaterializationError extends ModuleError<AbsoluteDirectoryMaterializationErrorReason> {
  static override readonly code = "wakeflow-absolute-directory-materialization";
}

const fail: Fail<AbsoluteDirectoryMaterializationErrorReason> = failWith(
  AbsoluteDirectoryMaterializationError,
);

async function inspect(value: string, path: string) {
  try {
    return await inspectAbsoluteDirectoryPlacement(value, path);
  } catch (error: unknown) {
    if (error instanceof AbsoluteDirectoryPlacementError) {
      if (error.reason === "input") fail("input", path, error);
      if (error.reason === "symlink") fail("symlink", path, error);
      if (error.reason === "not-directory") fail("not-directory", path, error);
      fail("path-changed", path, error);
    }
    throw error;
  }
}

function relativeResourcePath(ancestor: string, target: string) {
  const relative = nodePath.relative(ancestor, target);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    fail("scope", "$absolutePath");
  }
  try {
    return parsePortableResourcePath(relative.split(nodePath.sep).join("/"), "$absolutePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$absolutePath", error);
    }
    throw error;
  }
}

function mapMaterializationError(error: DurableDirectoryMaterializationError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "target-symlink" || error.reason === "parent-symlink") {
    fail("symlink", "$absolutePath");
  }
  if (error.reason === "target-not-directory" || error.reason === "parent-not-directory") {
    fail("not-directory", "$absolutePath");
  }
  if (error.reason === "close-failure") fail("close-failure", "$root");
  if (
    error.reason === "root-scope" ||
    error.reason === "parent-changed" ||
    error.reason === "path-changed"
  ) {
    fail("path-changed", "$absolutePath");
  }
  fail("materialization", "$absolutePath");
}

/**
 * 在最近的已有祖先下把目录路径建出来：打开祖先的句柄、物化、关闭句柄。物化的错误先于关闭的错误报告；
 * 物化成功而句柄关不上是 close-failure。
 */
async function materializeUnderAncestor(
  ancestor: string,
  resourcePath: Parameters<typeof materializeDirectoryPath>[1],
  options: AbsoluteDirectoryMaterializationOptions,
): Promise<Awaited<ReturnType<typeof materializeDirectoryPath>>> {
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(ancestor, "$ancestor");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-open", "$ancestor", error);
    throw error;
  }
  let materialized: Awaited<ReturnType<typeof materializeDirectoryPath>> | undefined;
  let primaryError: unknown;
  try {
    materialized = await materializeDirectoryPath(root, resourcePath, {
      mode: options.mode,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error: unknown) {
    primaryError = error;
  }
  let closeError: unknown;
  try {
    await root.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof DurableDirectoryMaterializationError) {
      mapMaterializationError(primaryError);
    }
    throw primaryError;
  }
  if (closeError !== undefined) fail("close-failure", "$root");
  if (materialized === undefined) fail("materialization", "$absolutePath");
  return materialized;
}

/** 从最近安全祖先开始，持久且幂等地物化一个规范绝对目录位置。 */
export async function materializeAbsoluteDirectoryPlacement(
  value: string,
  options: AbsoluteDirectoryMaterializationOptions,
): Promise<Readonly<AbsoluteDirectoryMaterializationResult>> {
  throwIfAborted(options.signal);
  const initial = await inspect(value, "$absolutePath");
  const absolutePath = initial.absolutePath;
  if (initial.state === "present") {
    if (initial.spellingIsCanonical !== true || initial.node === null) {
      fail("alias", "$absolutePath");
    }
    return Object.freeze({
      absolutePath,
      node: initial.node,
      segments: Object.freeze([
        Object.freeze({
          absolutePath,
          disposition: "existing" as const,
          node: initial.node,
        }),
      ]),
    });
  }

  const nearestAncestor = initial.nearestExistingAncestor;
  if (nearestAncestor === null) fail("scope", "$absolutePath");
  if (nearestAncestor.spellingIsCanonical !== true) {
    fail("alias", "$ancestor");
  }
  const ancestor = nearestAncestor.absolutePath;
  // 先证明相对路径可移植，再打开句柄，避免 input 失败泄漏 root。
  const resourcePath = relativeResourcePath(ancestor, absolutePath);
  throwIfAborted(options.signal);
  const materialized = await materializeUnderAncestor(ancestor, resourcePath, options);

  const final = await inspect(absolutePath, "$absolutePath");
  if (
    final.state !== "present" ||
    final.spellingIsCanonical !== true ||
    final.node === null ||
    !sameFileNodeIdentity(materialized.node, final.node)
  ) {
    fail("path-changed", "$absolutePath");
  }
  const segments = Object.freeze(
    materialized.segments.map((entry) =>
      Object.freeze({
        absolutePath: nodePath.join(ancestor, ...entry.resourcePath.split("/")),
        disposition: entry.disposition,
        node: entry.node,
      }),
    ),
  );
  return Object.freeze({ absolutePath, node: final.node, segments });
}
