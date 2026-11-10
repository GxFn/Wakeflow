import { realpathSync } from "node:fs";
import path from "node:path";
import { readWakeflowConfigAuthoritySnapshot } from "../configuration/wakeflow-config-authority-snapshot.js";
import { WAKEFLOW_ROLE_TOOL_ACCESS, } from "../contracts/vocabulary/wakeflow-role-tool-access.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { fail } from "../kernel/error.js";
function realpathOrNull(target) {
    try {
        return realpathSync(target);
    }
    catch {
        return null;
    }
}
async function readModel(root, signal) {
    let rooted = null;
    try {
        rooted = await RootedDirectory.open(root);
        return (await readWakeflowConfigAuthoritySnapshot(rooted, signal === undefined ? {} : { signal })).model;
    }
    catch {
        return null;
    }
    finally {
        await rooted?.close().catch(() => undefined);
    }
}
/** 这份配置里，执行根恰好是 `cwd` 的窗口的角色；同一个目录属于不止一种角色时认不出是谁（null）。 */
function roleAt(cwd, root, entries) {
    const roles = new Set();
    for (const entry of entries) {
        if (realpathOrNull(path.resolve(root, entry.placement)) === cwd)
            roles.add(entry.role);
    }
    return roles.size === 1 ? ([...roles][0] ?? null) : null;
}
function requestRoot(request) {
    if (request === null || typeof request !== "object" || !("root" in request))
        return null;
    return typeof request.root === "string" ? request.root : null;
}
export function createWakeflowCallerRoleGate(options) {
    // 服务进程的工作目录在它的一生里不变：只解析一次。
    const cwd = realpathOrNull(options.cwd);
    async function callerRole(rootValue, signal) {
        if (cwd === null || !path.isAbsolute(rootValue))
            return null;
        const root = realpathOrNull(rootValue);
        // 在工作区根上起的服务：Controller，或窗口都从根启动的宿主——没有可以收窄的身份。
        if (root === null || root === cwd)
            return null;
        const model = await readModel(root, signal);
        if (model === null)
            return null;
        try {
            return roleAt(cwd, root, options.executionRoots(model));
        }
        catch {
            return null;
        }
    }
    return async (toolName, request, signal) => {
        const root = requestRoot(request);
        if (root === null)
            return;
        const role = await callerRole(root, signal);
        if (role === null || role === "controller")
            return;
        if (WAKEFLOW_ROLE_TOOL_ACCESS[role].includes(toolName))
            return;
        fail("precondition-failed", "tool-not-for-role", "$caller", {
            details: { role, tool: toolName },
        });
    };
}
