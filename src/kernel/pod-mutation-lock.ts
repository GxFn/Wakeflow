import { parseWakeflowDurableIdOfKind } from "../contracts/identity/wakeflow-durable-id.js";
import { materializeDirectoryPath } from "../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
  withRootedExclusiveFileLock,
} from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import { fail } from "./error.js";

const ROOT_REF = parsePortableResourcePath(".wakeflow-local/runtime/pod-mutations");

/** pod 占用与关闭的短临界区；不持有宿主/Agent 等待，不保存业务权威。 */
export async function withPodMutation<Result>(
  root: RootedDirectory,
  podIdValue: string,
  operation: () => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  const podId = parseWakeflowDurableIdOfKind(podIdValue, "pod");
  const ref = parsePortableResourcePath(`${ROOT_REF}/${podId}.lock`);
  const options = signal === undefined ? {} : { signal };
  await materializeDirectoryPath(root, ROOT_REF, { mode: 0o700, ...options });
  try {
    const lock = await inspectRootedExclusiveFileLock(root, ref);
    if (lock.status === "held" && lock.ownerState === "inactive") {
      await retireRootedExclusiveFileLockResidue(root, ref, lock);
    }
    return await withRootedExclusiveFileLock(root, ref, operation, {
      acquireTimeoutMilliseconds: 10_000,
      ...options,
    });
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("concurrency-conflict", `pod-lock-${error.reason}`, "$pod", {
        cause: error,
        retryable: true,
      });
    }
    throw error;
  }
}
