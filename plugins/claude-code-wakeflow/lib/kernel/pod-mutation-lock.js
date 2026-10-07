import { parseWakeflowDurableIdOfKind } from "../contracts/identity/wakeflow-durable-id.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import { inspectRootedExclusiveFileLock, retireRootedExclusiveFileLockResidue, RootedExclusiveFileLockError, withRootedExclusiveFileLock, } from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import { fail } from "./error.js";
const ROOT_REF = parsePortableResourcePath(".wakeflow-local/runtime/pod-mutations");
async function materializeLockRoot(root, options) {
    try {
        await materializeDirectoryPath(root, ROOT_REF, { mode: 0o700, ...options });
    }
    catch (error) {
        if (!(error instanceof DurableDirectoryMaterializationError))
            throw error;
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        fail("io-failure", "pod-lock-directory", "$pod", { cause: error });
    }
}
/**
 * 只有等待类失败值得重试：超时、owner 在观察后又活了、残留在退役时变了。不安全的锁记录、
 * 父目录或根作用域问题与释放失败，重试也不会变好（§13.161 F6）。
 */
function mapLockError(error) {
    if (!(error instanceof RootedExclusiveFileLockError))
        throw error;
    if (error.reason === "aborted")
        fail("io-failure", "aborted", "$signal", { cause: error });
    fail("concurrency-conflict", `pod-lock-${error.reason}`, "$pod", {
        cause: error,
        retryable: error.reason === "timeout" ||
            error.reason === "owner-active" ||
            error.reason === "residue-changed",
    });
}
/** pod 占用与关闭的短临界区；不持有宿主/Agent 等待，不保存业务权威。 */
export async function withPodMutation(root, podIdValue, operation, signal) {
    const podId = parseWakeflowDurableIdOfKind(podIdValue, "pod");
    const ref = parsePortableResourcePath(`${ROOT_REF}/${podId}.lock`);
    const options = signal === undefined ? {} : { signal };
    if (signal?.aborted === true)
        fail("io-failure", "aborted", "$signal");
    await materializeLockRoot(root, options);
    try {
        const lock = await inspectRootedExclusiveFileLock(root, ref);
        if (lock.status === "held" && lock.ownerState === "inactive") {
            await retireRootedExclusiveFileLockResidue(root, ref, lock);
        }
        return await withRootedExclusiveFileLock(root, ref, operation, {
            acquireTimeoutMilliseconds: 10_000,
            ...options,
        });
    }
    catch (error) {
        mapLockError(error);
    }
}
