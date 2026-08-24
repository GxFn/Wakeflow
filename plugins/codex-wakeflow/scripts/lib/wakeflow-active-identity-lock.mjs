import path from "node:path";

import { withFileLock } from "./wakeflow-state-lock.mjs";

export const WAKEFLOW_ACTIVE_IDENTITY_LOCK_REF = ".wakeflow-active/current.identity-lock";

// 锁位置固定在Active根，专门保护current下typed demand identity的发布与移除竞争。
function activeIdentityLockFile(workspaceRoot) {
  if (
    typeof workspaceRoot !== "string"
    || !workspaceRoot.trim()
    || workspaceRoot !== workspaceRoot.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(workspaceRoot)
  ) {
    throw new TypeError("workspaceRoot must be one trimmed control-free path");
  }
  return path.join(
    path.resolve(workspaceRoot),
    ...WAKEFLOW_ACTIVE_IDENTITY_LOCK_REF.split("/"),
  );
}

/**
 * 串行化`.wakeflow-active/current`下typed demand identity的publication与archive detach。
 *
 * 本锁不保护单个demand内部state transition，也不替代per-demand create/state lock。需要同时
 * 持有多把锁时固定顺序为active-projector → active-identity → state-root；普通publication只取
 * per-demand create → active-identity，不能反向取得projector/state。operation必须保持同步，
 * 原因与projection lock相同：底层withFileLock不会跨Promise生命周期持锁。
 */
export function withWakeflowActiveIdentityLock(workspaceRoot, operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("active identity lock operation must be a function");
  }
  return withFileLock(activeIdentityLockFile(workspaceRoot), operation, options);
}
