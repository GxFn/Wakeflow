import { type Fail, failWith } from "../error/module-error.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  parsePortableResourcePath,
} from "./portable-resource-path.js";
import type { RootedDirectory } from "./rooted-directory.js";
import {
  closeExactResourceHandle,
  type RootedExactResourceHandle,
  translateExactResourceHandleError,
} from "./rooted-exact-resource-handle.js";
import {
  closeParentHandle,
  parentOpenRefusal,
  RootedResourceParentHandle,
  type RootedResourceParentHandleError,
  translateParentHandleError,
} from "./rooted-resource-parent-handle.js";

/**
 * Wakeflow Foundation / Filesystem：不替换目标的硬链接与持久化重命名共用的父目录与源步骤
 * （写一次，1.4.5）。
 *
 * 两个原语都核对同样的资源路径，打开源与目标两个父目录和一个精确源句柄，提交前后复验它们，提交后
 * 同步父目录，最后关闭句柄。这里的每一步与两者原来各自的一份逐字相同：同样的句柄调用、同样的
 * 原因、路径与 cause，只是错误由调用方的错误类（`Failure`）构造。这里只放各步本身：步骤的先后、
 * 同步哪个父目录、关闭的顺序，仍写在两个原语里。打开源句柄与提交本身也各写各的：链接只准入
 * 普通文件并报 `source-not-file`，重命名准入文件或目录并报 `source-not-supported`。
 */

/** 两个原语的原因都有、这里会报出的那些。 */
type SourceTransitionReason =
  | "input"
  | "root-scope"
  | "parent-not-found"
  | "parent-symlink"
  | "parent-not-directory"
  | "parent-open-failure"
  | "parent-changed"
  | "source-changed"
  | "destination-inspection-failure"
  | "commit-uncertain"
  | "durability-failure"
  | "close-failure";

type ResourceErrorPath = "$sourceResourcePath" | "$destinationResourcePath";

/** 绑定到调用方错误类的共用步骤；调用方在模块顶层取一次。 */
export function sourceTransitionSteps<E extends Error>(
  Failure: new (reason: SourceTransitionReason, path: string, options?: ErrorOptions) => E,
) {
  const fail: Fail<SourceTransitionReason> = failWith(Failure);

  function parseResourcePath(value: unknown, path: ResourceErrorPath): PortableResourcePath {
    try {
      return parsePortableResourcePath(value, path);
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) fail("input", path, error);
      throw error;
    }
  }

  function mapParentHandleError(
    error: RootedResourceParentHandleError,
    operation: "open" | "current" | "inspect" | "sync",
    errorPath: ResourceErrorPath,
    inspectionReason?: "destination-inspection-failure" | "commit-uncertain",
  ): never {
    if (operation === "sync" && error.reason === "sync-failure") {
      fail("durability-failure", errorPath);
    }
    if (operation === "inspect" && error.reason === "target-inspection-failure") {
      fail(inspectionReason ?? "destination-inspection-failure", errorPath);
    }
    const refusal = operation === "open" ? parentOpenRefusal(error) : undefined;
    if (refusal !== undefined) fail(refusal, errorPath);
    // 提交后的 inspect 与 sync 遇到父目录漂移时，不能读作干净的提交前拒绝。
    if (
      (operation === "inspect" && inspectionReason === "commit-uncertain") ||
      operation === "sync"
    ) {
      fail("commit-uncertain", errorPath);
    }
    fail("parent-changed", errorPath);
  }

  function openResourceParent(
    root: RootedDirectory,
    resourcePath: PortableResourcePath,
    errorPath: ResourceErrorPath,
  ): Promise<RootedResourceParentHandle> {
    return translateParentHandleError(
      () => RootedResourceParentHandle.open(root, resourcePath, errorPath),
      (error) => mapParentHandleError(error, "open", errorPath),
    );
  }

  function assertParentCurrent(
    parent: RootedResourceParentHandle,
    errorPath: ResourceErrorPath,
    afterCommit = false,
  ): Promise<Readonly<FileNodeSnapshot>> {
    return translateParentHandleError(
      () => parent.assertCurrent(),
      (error) => {
        if (afterCommit) fail("commit-uncertain", errorPath, error);
        mapParentHandleError(error, "current", errorPath);
      },
    );
  }

  function inspectParentTarget(
    parent: RootedResourceParentHandle,
    errorPath: ResourceErrorPath,
    reason: "destination-inspection-failure" | "commit-uncertain",
  ): Promise<Readonly<FileNodeSnapshot> | null> {
    return translateParentHandleError(
      () => parent.inspectTarget(),
      (error) => mapParentHandleError(error, "inspect", errorPath, reason),
    );
  }

  function syncParent(
    parent: RootedResourceParentHandle,
    errorPath: ResourceErrorPath,
  ): Promise<Readonly<FileNodeSnapshot>> {
    return translateParentHandleError(
      () => parent.sync(),
      (error) => mapParentHandleError(error, "sync", errorPath),
    );
  }

  function closeParent(
    parent: RootedResourceParentHandle,
    errorPath: ResourceErrorPath,
  ): Promise<E | undefined> {
    return closeParentHandle(
      parent,
      (error) =>
        new Failure(
          error.reason === "close-failure" ? "close-failure" : "parent-changed",
          errorPath,
        ),
    );
  }

  function assertSourceCurrent(
    source: RootedExactResourceHandle,
  ): Promise<Readonly<FileNodeSnapshot>> {
    return translateExactResourceHandleError(
      () => source.assertPathCurrent(),
      () => fail("source-changed", "$sourceResourcePath"),
    );
  }

  function inspectCommittedSource(
    source: RootedExactResourceHandle,
  ): Promise<Readonly<FileNodeSnapshot>> {
    return translateExactResourceHandleError(
      () => source.inspectOpenedNode(),
      () => fail("commit-uncertain", "$destinationResourcePath"),
    );
  }

  function closeSource(source: RootedExactResourceHandle): Promise<E | undefined> {
    return closeExactResourceHandle(
      source,
      () => new Failure("close-failure", "$sourceResourcePath"),
    );
  }

  return Object.freeze({
    parseResourcePath,
    openResourceParent,
    assertParentCurrent,
    inspectParentTarget,
    syncParent,
    closeParent,
    assertSourceCurrent,
    inspectCommittedSource,
    closeSource,
  });
}
