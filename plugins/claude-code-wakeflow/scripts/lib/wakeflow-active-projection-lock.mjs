import path from "node:path";

import { withFileLock } from "./wakeflow-state-lock.mjs";

export const WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF = ".wakeflow-active/projector.lock";

// 锁位置固定在workspace Active根；调用方必须先完成workspace/config与父目录安全准入。
function activeProjectionLockFile(workspaceRoot) {
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
    ...WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF.split("/"),
  );
}

/**
 * 取得workspace级Active投影写锁。
 *
 * 这是普通projector与BusinessArchive共享的唯一投影协调gate，不持久化业务状态，也不创建
 * 第二套projection状态机。若同一临界区还需要identity/state锁，固定顺序只能是
 * active-projector → active-identity（如需要）→ state-root。底层withFileLock当前是同步
 * critical section，因此operation也必须同步完成；异步maintenance锁域需单独设计，不能把
 * Promise callback直接包进本入口后误认为锁仍被持有。
 */
export function withWakeflowActiveProjectionLock(
  workspaceRoot,
  operation,
  options = {},
) {
  if (typeof operation !== "function") {
    throw new TypeError("active projection lock operation must be a function");
  }
  return withFileLock(activeProjectionLockFile(workspaceRoot), operation, options);
}
