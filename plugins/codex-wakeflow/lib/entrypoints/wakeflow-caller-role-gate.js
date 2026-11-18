import { realpathSync } from "node:fs";
import path from "node:path";
import { readWakeflowConfigAuthoritySnapshot } from "../configuration/wakeflow-config-authority-snapshot.js";
import { WAKEFLOW_ROLE_TOOL_ACCESS, } from "../contracts/vocabulary/wakeflow-role-tool-access.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { fail } from "../kernel/error.js";
import { matchingWorkspaces, resolveSubject } from "./wakeflow-hook-workspaces.js";
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
/**
 * 服务进程启动时认得出的窗口角色（ADR-0029：按角色的工具子集）。工具目录在连接建立时列一次，那时还没有
 * 任何请求带来工作区根，所以用 hook 的定位规则从工作目录找它所属的工作区，再问每个工作区的配置："执行根
 * 恰好是这个目录的窗口是什么角色"。
 *
 * 只在毫无歧义时收窄：找到的每个工作区都把这个目录认作同一种非 Controller 角色。找不到工作区、工作目录
 * 就是某个工作区的根、任何一个工作区认不出、或两个工作区说法不同，都返回 null——目录照旧列全部工具。
 * 这与 `createWakeflowCallerRoleGate` 是同一条规则的两个时刻：这里隐藏的工具，调用时本来也会被拒绝。
 */
export async function resolveWakeflowListedRole(options) {
    const cwd = realpathOrNull(options.cwd);
    if (cwd === null)
        return null;
    let roots;
    try {
        const subject = await resolveSubject(options.cwd, options.env);
        roots = subject === null ? [] : await matchingWorkspaces(subject);
    }
    catch {
        return null;
    }
    const roles = new Set();
    for (const root of roots) {
        if (root === cwd)
            return null;
        const model = await readModel(root, undefined);
        try {
            roles.add(model === null ? null : roleAt(cwd, root, options.executionRoots(model)));
        }
        catch {
            roles.add(null);
        }
    }
    const [role, ...others] = [...roles];
    if (role === undefined || role === null || role === "controller" || others.length > 0) {
        return null;
    }
    return role;
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
