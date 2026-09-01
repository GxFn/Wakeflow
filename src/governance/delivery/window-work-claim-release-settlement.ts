import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WindowWorkClaim } from "./window-work-claim.js";
import {
  inspectWindowWorkClaim,
  releaseWindowWorkClaimInStore,
  WindowWorkClaimStoreError,
} from "./window-work-claim-store.js";

/**
 * 在领域owner已经持有持久释放授权后，精确结算一份WindowWorkClaim。
 *
 * 本函数不判断谁可以释放；调用方必须先提交自己的授权Event。它只把并发重试中的
 * `exact release`与随后可证明的`absent`收敛为同一物理结果，其他状态继续失败。
 */
export async function settleAuthorizedWindowWorkClaimRelease(
  workspaceRoot: RootedDirectory,
  claim: Readonly<WindowWorkClaim>,
): Promise<"released"> {
  try {
    await releaseWindowWorkClaimInStore(workspaceRoot, claim);
    return "released";
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimStoreError) {
      try {
        const current = await inspectWindowWorkClaim(
          workspaceRoot,
          claim.route.windowId,
        );
        if (current.status === "absent") return "released";
      } catch {
        // 保留首个release错误及其authority分类。
      }
    }
    throw error;
  }
}
