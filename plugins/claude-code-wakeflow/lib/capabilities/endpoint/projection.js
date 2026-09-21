import { publishWakeflowWindowRuntimeProjectionDocument } from "../../workspace/window-runtime/wakeflow-window-runtime-projection-document.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "./contract.js";
/** 让磁盘上的投影文档等于目标文档；已相等则不写。 */
export async function publishProjectionDocument(root, target, signal) {
    const receipt = await publishWakeflowWindowRuntimeProjectionDocument(root, target, signal);
    return Object.freeze({
        resourceRef: receipt.resourceRef,
        projectionDigest: receipt.projectionDigest,
        documentDigest: receipt.documentDigest,
    });
}
/** 端点切片对 `next` 的贡献：先登记完所有窗口，再处理过期的工作声明。 */
export function deriveEndpointNext(input) {
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
