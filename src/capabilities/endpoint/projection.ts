import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import { publishWakeflowWindowRuntimeProjectionDocument } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-document.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "./contract.js";

/**
 * Wakeflow Capabilities / Endpoint：窗口运行投影的写入与 `next` 派生。
 *
 * 投影是派生数据：登记、替换、退役都用当前权威重算一份文档并整体替换；
 * 文档由投影模块编译，落盘由 workspace 的投影文档 owner 完成（对账重建复用同一 owner），
 * 本模块只负责端点的回执形状与下一步。
 */

export interface ProjectionDocument {
  readonly resourceRef: PortableResourcePath;
  readonly document: string;
  readonly documentDigest: Sha256Digest;
  readonly projectionDigest: Sha256Digest;
}

export interface ProjectionReceipt {
  readonly resourceRef: PortableResourcePath;
  readonly projectionDigest: Sha256Digest;
  readonly documentDigest: Sha256Digest;
}

/** 让磁盘上的投影文档等于目标文档；已相等则不写。 */
export async function publishProjectionDocument(
  root: RootedDirectory,
  target: Readonly<ProjectionDocument>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ProjectionReceipt>> {
  const receipt = await publishWakeflowWindowRuntimeProjectionDocument(root, target, signal);
  return Object.freeze({
    resourceRef: receipt.resourceRef,
    projectionDigest: receipt.projectionDigest,
    documentDigest: receipt.documentDigest,
  });
}

export interface EndpointNextInput {
  readonly registered: boolean;
  readonly claimHeld: boolean;
  readonly claimExpired: boolean;
  /** 本宿主下仍未登记的其他窗口。 */
  readonly unregisteredWindowIds: readonly string[];
}

/** 端点切片对 `next` 的贡献：先登记本窗口，再恢复过期的工作声明，最后登记 pod 内其余窗口。 */
export function deriveEndpointNext(input: Readonly<EndpointNextInput>): Readonly<NextProjection> {
  if (!input.registered) {
    return Object.freeze({
      frontier: "window-registration",
      owner: "user",
      suggestedTool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([]),
    });
  }
  if (input.claimHeld && input.claimExpired) {
    return Object.freeze({
      frontier: "work-claim-recovery",
      owner: "controller",
      suggestedTool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([]),
    });
  }
  if (input.unregisteredWindowIds.length > 0) {
    return Object.freeze({
      frontier: "window-registration",
      owner: "user",
      suggestedTool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([...input.unregisteredWindowIds].slice(0, 32)),
    });
  }
  return Object.freeze({
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: Object.freeze([]),
  });
}
