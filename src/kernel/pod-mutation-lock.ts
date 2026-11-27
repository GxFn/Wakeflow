import { parseWakeflowDurableIdOfKind } from "../contracts/identity/wakeflow-durable-id.js";
import { KernelFileLockError } from "../foundation/filesystem/kernel-file-lock.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { throwIfAborted } from "../foundation/node/abort-signal.js";
import { fail } from "./error.js";
import { withWorkspaceLock } from "./workspace-locks.js";

/** 只有等到超时值得重试；锁文件不安全、卷不支持或重入，重试也不会变好（§13.161 F6）。 */
function mapLockError(error: unknown): never {
  if (!(error instanceof KernelFileLockError)) throw error;
  fail("concurrency-conflict", `pod-lock-${error.reason}`, "$pod", {
    cause: error,
    retryable: error.reason === "timeout",
  });
}

/**
 * pod 占用与关闭的短临界区；不持有宿主/Agent 等待，不保存业务权威。全部 pod 共用一把锁（ADR-0033
 * 决定 3）：两个 pod 的占用变化先后进行。`podIdValue` 只用来核对调用方给的是一个 pod 标识。
 */
export async function withPodMutation<Result>(
  root: RootedDirectory,
  podIdValue: string,
  operation: () => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  parseWakeflowDurableIdOfKind(podIdValue, "pod");
  throwIfAborted(signal);
  try {
    return await withWorkspaceLock(root, "pod-mutation", operation, {
      acquireTimeoutMilliseconds: 10_000,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    mapLockError(error);
  }
}
