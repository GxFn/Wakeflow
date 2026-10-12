/** 每张表的上限：转换层最多 8 个 current 目标，其中一个是当前渲染。 */
export const WAKEFLOW_MANAGED_TEXT_HISTORY_MAXIMUM = 7;
/** 程序指令块（工作区根的 CLAUDE.md / AGENTS.md）：输入同 `createWakeflowProgramInstructionBodyAuthority`。 */
export const WAKEFLOW_PROGRAM_INSTRUCTION_BODY_HISTORY = Object.freeze([]);
/** 外部指令块（managed-block 仓库与外部支撑面的指令文件）：输入同 `createWakeflowExternalInstructionBodyAuthority`。 */
export const WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_HISTORY = Object.freeze([]);
/** 仓库 `.gitignore` 托管块：输入同 `createWakeflowGitignoreBodyAuthority`。 */
export const WAKEFLOW_GITIGNORE_BODY_HISTORY = Object.freeze([]);
/** 支撑面 `.gitignore` 托管块：输入同 `createWakeflowSupportGitignoreBodyAuthority`。 */
export const WAKEFLOW_SUPPORT_GITIGNORE_BODY_HISTORY = Object.freeze([]);
/** 支撑面整文件记忆：输入同 `createWakeflowSupportMemoryAuthority`。 */
export const WAKEFLOW_SUPPORT_MEMORY_BODY_HISTORY = Object.freeze([]);
/**
 * 用相同输入重算历史正文：算不出的（抛错或 null）、与当前渲染相同的、彼此重复的都去掉，按表序返回。
 */
export function historicalWakeflowManagedTextBodies(history, currentBody, ...inputs) {
    const bodies = [];
    for (const entry of history) {
        let body;
        try {
            body = entry.render(...inputs);
        }
        catch {
            body = null;
        }
        if (body === null || body === currentBody || bodies.includes(body))
            continue;
        bodies.push(body);
    }
    return Object.freeze(bodies);
}
/**
 * 历史正文套上当前目标的 component 与 owner 作为额外 current 目标：转换层要求每个 current 目标与
 * desired 同 component、同 owner，历史正文只在正文上不同。
 */
export function historicalWakeflowManagedTextTargets(history, current, ...inputs) {
    return Object.freeze(historicalWakeflowManagedTextBodies(history, current.body, ...inputs).map((body) => Object.freeze({ component: current.component, owner: current.owner, body })));
}
